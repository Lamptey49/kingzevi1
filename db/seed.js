/**
 * npm run seed
 * Populates the database with demo users, music and social posts.
 * Safe to re-run — skips if data already exists.
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { connect } from './connection.js';
import { User, Music, Track, Post, PostLike, Comment } from './models.js';

await connect();

// ── Skip if already seeded ────────────────────────────────────
const existing = await User.countDocuments();
if (existing > 0) {
  console.log('⏭️  Database already seeded — skipping.');
  process.exit(0);
}

// ── Users ─────────────────────────────────────────────────────
const hash = await bcrypt.hash('password123', 12);

const [artist, fan1, fan2] = await User.insertMany([
  { username: 'solace_artist', email: 'artist@solace.music', password_hash: hash, role: 'artist', avatar: '🎤', bio: 'The sound of midnight.' },
  { username: 'ama_gh',        email: 'fan@example.com',    password_hash: hash, role: 'fan',    avatar: '🌟' },
  { username: 'kwame_vibes',   email: 'fan2@example.com',   password_hash: hash, role: 'fan',    avatar: '🔥' },
]);
console.log('✅ Users created:', [artist, fan1, fan2].map(u => u.username).join(', '));

// ── Music ─────────────────────────────────────────────────────
const [golden, neon, still] = await Music.insertMany([
  { type: 'single', title: 'Golden Hour', genre: 'Afrobeats',  year: 2026, emoji: '☀️', allow_download: true,  artist_id: artist._id },
  { type: 'single', title: 'Neon Rain',   genre: 'R&B / Soul', year: 2025, emoji: '🌧️', allow_download: true,  artist_id: artist._id },
  { type: 'single', title: 'Still Waters',genre: 'Jazz',       year: 2025, emoji: '🌊', allow_download: false, artist_id: artist._id },
]);

const album = await Music.create({
  type: 'album', title: 'Midnight Reverie', genre: 'R&B / Soul',
  year: 2024, emoji: '🌙', allow_download: true, artist_id: artist._id,
  description: 'A journey through the hours after midnight.',
});

await Track.insertMany([
  { music_id: golden._id, track_number: 1, title: 'Golden Hour',  duration: '3:42' },
  { music_id: neon._id,   track_number: 1, title: 'Neon Rain',    duration: '4:08' },
  { music_id: still._id,  track_number: 1, title: 'Still Waters', duration: '3:55' },
  { music_id: album._id,  track_number: 1, title: 'Intro (3AM)',   duration: '1:12' },
  { music_id: album._id,  track_number: 2, title: 'Fade Into You', duration: '3:45' },
  { music_id: album._id,  track_number: 3, title: 'Empty Streets', duration: '4:02' },
  { music_id: album._id,  track_number: 4, title: 'Candle Light',  duration: '3:28' },
  { music_id: album._id,  track_number: 5, title: 'Reverie',       duration: '5:14' },
]);
console.log('✅ Music + tracks created');

// ── Social posts ──────────────────────────────────────────────
const [p1, p2, p3] = await Post.insertMany([
  { user_id: fan1._id,   post_type: 'text', content: 'Just discovered Golden Hour and cannot stop listening 🔁☀️ Who else is obsessed??' },
  { user_id: fan2._id,   post_type: 'text', content: 'Still Waters is one of the most calming tracks I have heard in years 🌊🎶' },
  { user_id: artist._id, post_type: 'text', content: 'Midnight Reverie is finally out 🌙 This album took 2 years — every track is a chapter. Drop a 💿 if you are listening!' },
]);

// Likes
await PostLike.insertMany([
  { post_id: p1._id, user_id: artist._id },
  { post_id: p2._id, user_id: artist._id },
  { post_id: p3._id, user_id: artist._id },
  { post_id: p3._id, user_id: fan1._id   },
  { post_id: p3._id, user_id: fan2._id   },
]);
await Post.findByIdAndUpdate(p1._id, { like_count: 1 });
await Post.findByIdAndUpdate(p2._id, { like_count: 1 });
await Post.findByIdAndUpdate(p3._id, { like_count: 3 });

// Comments
await Comment.create({ post_id: p1._id, user_id: fan2._id, content: 'Same!! I have had it on repeat since yesterday 😭🔥' });
await Comment.create({ post_id: p1._id, user_id: artist._id, content: 'Thank you so much, this means everything 🙏☀️' });
await Comment.create({ post_id: p3._id, user_id: fan1._id,   content: 'Candle Light is my favourite track. Incredible work!' });
await Post.findByIdAndUpdate(p1._id, { comment_count: 2 });
await Post.findByIdAndUpdate(p3._id, { comment_count: 1 });

console.log('✅ Social posts, likes, comments created');
console.log('\n🔑 Test credentials:');
console.log('   Artist  →  artist@solace.music  /  password123');
console.log('   Fan 1   →  fan@example.com      /  password123');
console.log('   Fan 2   →  fan2@example.com     /  password123');
process.exit(0);
