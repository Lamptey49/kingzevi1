/**
 * node test.js
 * Runs full API test suite against an in-memory MongoDB instance.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import http     from 'http';
import 'dotenv/config';

// ── Boot in-memory MongoDB ────────────────────────────────────
const mongod = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_NAME     = 'solace_test';
process.env.JWT_SECRET  = 'test_secret';
process.env.NODE_ENV    = 'test';

// ── Start the app server ──────────────────────────────────────
// Dynamic import AFTER env vars are set
const { default: app } = await import('./server.js').catch(() => {
  // server.js calls app.listen directly; we need to capture the port
});

// Give the server a moment to bind
await new Promise(r => setTimeout(r, 2000));

// ── HTTP helper ───────────────────────────────────────────────
function req(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data    = body && !(body instanceof FormData) ? JSON.stringify(body) : null;
    const headers = {
      ...(data              ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
      ...(token             ? { Authorization: 'Bearer ' + token } : {}),
    };
    const r = http.request(
      { hostname: 'localhost', port: 3000, path: '/api' + path, method, headers },
      (res) => { let s = ''; res.on('data', c => s += c); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(s) })); },
    );
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

// ── Test suite ────────────────────────────────────────────────
let pass = 0; let fail = 0;
function assert(label, condition, got) {
  if (condition) { console.log(`  ✅ ${label}`); pass++; }
  else           { console.error(`  ❌ ${label}`, got ?? ''); fail++; }
}

console.log('\n── Auth ─────────────────────────────────────────────────');
const r1 = await req('POST', '/auth/register', { username: 'test_artist', email: 'artist@test.com', password: 'pass123', role: 'artist' });
assert('Artist register 201',  r1.status === 201, r1.body);
assert('Token returned',       !!r1.body.token,   r1.body);
const artTok = r1.body.token;

const r2 = await req('POST', '/auth/register', { username: 'test_fan', email: 'fan@test.com', password: 'pass123', role: 'fan' });
assert('Fan register 201',     r2.status === 201, r2.body);
const fanTok = r2.body.token;

const r3 = await req('POST', '/auth/login', { email: 'artist@test.com', password: 'pass123' });
assert('Login 200',            r3.status === 200, r3.body);
assert('Role is artist',       r3.body.user.role === 'artist', r3.body.user);

const r3b = await req('POST', '/auth/login', { email: 'artist@test.com', password: 'wrong' });
assert('Wrong password → 401', r3b.status === 401, r3b.body);

const r4 = await req('GET', '/auth/me', null, artTok);
assert('/me returns user',     r4.status === 200 && r4.body.user.username === 'test_artist', r4.body);

const r4b = await req('GET', '/auth/me');
assert('/me without token → 401', r4b.status === 401, r4b.body);

console.log('\n── Music ────────────────────────────────────────────────');
const r5 = await req('POST', '/music', { type: 'single', title: 'Test Single', genre: 'Afrobeats', year: 2026, emoji: '🎵' }, artTok);
assert('Artist publishes single 201', r5.status === 201, r5.body);
const musicId   = r5.body.music?.id;
const trackId   = r5.body.music?.tracks?.[0]?.id;
assert('Music has id',         !!musicId,  r5.body.music);
assert('Single has 1 track',   r5.body.music?.track_count === 1, r5.body.music);

const r6 = await req('POST', '/music', { type: 'single', title: 'Blocked' }, fanTok);
assert('Fan cannot publish → 403', r6.status === 403, r6.body);

const r7 = await req('GET', '/music?type=single');
assert('Music list returns 200',   r7.status === 200, r7.body);
assert('1 single in list',         r7.body.music?.length === 1, r7.body.music);

const r8 = await req('POST', `/music/stream/${trackId}`, {}, fanTok);
assert('Stream logged',            r8.status === 200, r8.body);

const r9 = await req('POST', `/music/download/${musicId}`, {}, fanTok);
assert('Download logged',          r9.status === 200, r9.body);

const r10 = await req('GET', '/music/stats/artist', null, artTok);
assert('Artist stats 200',         r10.status === 200, r10.body);
assert('1 track in stats',         r10.body.tracks === 1, r10.body);
assert('1 stream in stats',        r10.body.streams === 1, r10.body);

const r10b = await req('GET', '/music/stats/artist', null, fanTok);
assert('Fan stats → 403',          r10b.status === 403, r10b.body);

console.log('\n── Social ───────────────────────────────────────────────');
const r11 = await req('POST', '/social/posts', { content: 'Hello KINGZEVI community!' }, fanTok);
assert('Fan creates post 201',     r11.status === 201, r11.body);
const postId = r11.body.post?.id;
assert('Post has id',              !!postId, r11.body.post);

const r11b = await req('POST', '/social/posts', { content: 'No auth' });
assert('Post without auth → 401',  r11b.status === 401, r11b.body);

const r12 = await req('GET', '/social/posts');
assert('Feed loads 200',           r12.status === 200, r12.body);
assert('1 post in feed',           r12.body.posts?.length === 1, r12.body.posts);
assert('liked_by_me is false (guest)', r12.body.posts?.[0]?.liked_by_me === false, r12.body.posts?.[0]);

const r13 = await req('POST', `/social/posts/${postId}/like`, {}, artTok);
assert('Like post',                r13.status === 200 && r13.body.liked === true,  r13.body);
assert('Like count is 1',          r13.body.like_count === 1, r13.body);

const r14 = await req('POST', `/social/posts/${postId}/like`, {}, artTok);
assert('Unlike (toggle)',          r14.status === 200 && r14.body.liked === false, r14.body);
assert('Like count back to 0',     r14.body.like_count === 0, r14.body);

const r15 = await req('POST', `/social/posts/${postId}/comments`, { content: 'Great post!' }, artTok);
assert('Comment created 201',      r15.status === 201, r15.body);
const commentId = r15.body.comment?.id;

const r16 = await req('GET', `/social/posts/${postId}/comments`);
assert('Comments load 200',        r16.status === 200, r16.body);
assert('1 comment returned',       r16.body.comments?.length === 1, r16.body.comments);

const r17 = await req('DELETE', `/social/posts/${postId}`, {}, artTok);
assert('Cannot delete other post → 403', r17.status === 403, r17.body);

const r18 = await req('DELETE', `/social/comments/${commentId}`, {}, artTok);
assert('Delete own comment',       r18.status === 200 && r18.body.success, r18.body);

const r19 = await req('DELETE', `/social/posts/${postId}`, {}, fanTok);
assert('Delete own post',          r19.status === 200 && r19.body.success, r19.body);

const r20 = await req('GET', '/social/stats');
assert('Stats endpoint 200',       r20.status === 200, r20.body);

const r21 = await req('GET', '/health');
assert('Health check → MongoDB',   r21.status === 200 && r21.body.db === 'mongodb', r21.body);

// ── Summary ───────────────────────────────────────────────────
console.log(`\n${'─'.repeat(52)}`);
console.log(`  ${pass} passed · ${fail} failed`);
if (fail > 0) { console.error('  ❌ Some tests failed'); process.exit(1); }
else          { console.log('  🎉 All tests passed — MongoDB migration verified!'); }

await mongoose.disconnect();
await mongod.stop();
process.exit(0);
