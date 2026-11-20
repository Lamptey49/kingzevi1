import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken'
import { v4 as uuidv4 } from 'uuid';
import path from 'path'
const { getDb, get, run, all } = require('../../db/database').default;

const SECRET = process.env.JWT_SECRET || 'solace_secret_2026';
let dbReady = null;

async function ensureDb() {
  if (!dbReady) dbReady = await getDb();
  return dbReady;
}

function jsonResponse(statusCode, payload, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      ...extraHeaders
    },
    body: JSON.stringify(payload)
  };
}

function parseBody(event) {
  if (!event.body) return {};
  if (event.headers['content-type']?.includes('application/json') || event.headers['Content-Type']?.includes('application/json')) {
    try { return JSON.parse(event.body); } catch { return {}; }
  }
  if (event.headers['content-type']?.includes('application/x-www-form-urlencoded') || event.headers['Content-Type']?.includes('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams(event.body);
    const result = {};
    params.forEach((value, key) => { result[key] = value; });
    return result;
  }
  return {};
}

function getAuthUser(event) {
  const header = event.headers.authorization || event.headers.Authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  try { return jwt.verify(token, SECRET); } catch { return null; }
}

function getRoute(event) {
  const rawPath = event.path || '/';
  const normalized = rawPath.replace(/^\/+/, '');
  if (normalized.startsWith('api/')) return '/' + normalized.slice(4);
  if (normalized.startsWith('api')) return '/' + normalized.slice(3);
  return '/' + normalized;
}

function getQuery(event) {
  const search = event.rawQueryString || '';
  const params = new URLSearchParams(search);
  return Object.fromEntries(params.entries());
}

function isTruthy(value) {
  return String(value).toLowerCase() === 'true';
}

function makeUserPayload(user) {
  return user ? {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    avatar: user.avatar,
    bio: user.bio,
    created_at: user.created_at
  } : null;
}

async function handleAuth(event, route) {
  await ensureDb();
  const body = parseBody(event);

  
  if (route === '/register' && event.httpMethod === 'POST') {
    const username = String(body.username || body.name || '').trim();
    const email = String(body.email || '').trim();
    const password = String(body.password || '');
    const role = body.role === 'artist' ? 'artist' : 'fan';

    if (!username || !email || !password) return jsonResponse(400, { error: 'Username, email, and password are required' });
    if (password.length < 6) return jsonResponse(400, { error: 'Password must be at least 6 characters' });
    if (get('SELECT id FROM users WHERE email = ?', [email])) return jsonResponse(409, { error: 'Email already in use' });
    if (get('SELECT id FROM users WHERE username = ?', [username])) return jsonResponse(409, { error: 'Username already taken' });

    const hash = await bcrypt.hash(password, 12);
    const id = uuid();
    const avatar = body.avatar || (role === 'artist' ? '🎤' : '🎧');
    run('INSERT INTO users (id,username,email,password_hash,role,avatar) VALUES (?,?,?,?,?,?)', [id, username, email, hash, role, avatar]);

    const token = jwt.sign({ id, username, email, role, avatar }, SECRET, { expiresIn: '7d' });
    return jsonResponse(201, { token, user: makeUserPayload(get('SELECT * FROM users WHERE id = ?', [id])) });
  }

  if (route === '/login' && event.httpMethod === 'POST') {
    const email = String(body.email || '').trim();
    const password = String(body.password || '');
    if (!email || !password) return jsonResponse(400, { error: 'Email and password required' });

    const user = get('SELECT * FROM users WHERE email = ?', [email]);
    if (!user || !(await bcrypt.compare(password, user.password_hash))) return jsonResponse(401, { error: 'Invalid email or password' });

    const token = jwt.sign({ id: user.id, username: user.username, email: user.email, role: user.role, avatar: user.avatar }, SECRET, { expiresIn: '7d' });
    return jsonResponse(200, { token, user: makeUserPayload(user) });
  }

  if (route === '/me' && event.httpMethod === 'GET') {
    const user = getAuthUser(event);
    if (!user) return jsonResponse(401, { error: 'Authentication required' });
    const profile = get('SELECT id,username,email,role,avatar,bio,created_at FROM users WHERE id = ?', [user.id]);
    if (!profile) return jsonResponse(404, { error: 'User not found' });
    return jsonResponse(200, { user: makeUserPayload(profile) });
  }

  if (route === '/profile' && event.httpMethod === 'PUT') {
    const user = getAuthUser(event);
    if (!user) return jsonResponse(401, { error: 'Authentication required' });

    const current = get('SELECT * FROM users WHERE id = ?', [user.id]);
    if (!current) return jsonResponse(404, { error: 'User not found' });

    const username = String(body.username || body.name || current.username || '').trim();
    const email = String(body.email || current.email || '').trim();
    const bio = String(body.bio ?? current.bio ?? '');
    const currentPassword = String(body.currentPassword || '');
    const newPassword = String(body.newPassword || '');

    if (!username || !email) return jsonResponse(400, { error: 'Username and email are required' });
    const existing = get('SELECT id FROM users WHERE (email = ? OR username = ?) AND id != ?', [email, username, current.id]);
    if (existing) return jsonResponse(409, { error: 'Email or username is already taken' });

    if (currentPassword || newPassword) {
      if (!currentPassword) return jsonResponse(400, { error: 'Current password is required to change your password' });
      const valid = await bcrypt.compare(currentPassword, current.password_hash);
      if (!valid) return jsonResponse(401, { error: 'Current password is incorrect' });
      if (!newPassword || newPassword.length < 6) return jsonResponse(400, { error: 'New password must be at least 6 characters' });
      const hash = await bcrypt.hash(newPassword, 12);
      run('UPDATE users SET password_hash = ? WHERE id = ?', [hash, current.id]);
    }

    let avatar = current.avatar;
    if (body.avatar) avatar = body.avatar;

    run('UPDATE users SET username = ?, email = ?, bio = ?, avatar = ? WHERE id = ?', [username, email, bio, avatar, current.id]);
    const updated = get('SELECT id,username,email,role,avatar,bio,created_at FROM users WHERE id = ?', [current.id]);
    const token = jwt.sign({ id: updated.id, username: updated.username, email: updated.email, role: updated.role, avatar: updated.avatar }, SECRET, { expiresIn: '7d' });
    return jsonResponse(200, { token, user: makeUserPayload(updated) });
  }

  if (route === '/logout' && event.httpMethod === 'POST') {
    return jsonResponse(200, { success: true });
  }

  return jsonResponse(404, { error: 'Auth route not found' });
}

async function handleMusic(event, route) {
  await ensureDb();
  const query = getQuery(event);
  const user = getAuthUser(event);

  if (route === '/' && event.httpMethod === 'GET') {
    const type = query.type || 'single';
    const rows = all('SELECT * FROM music WHERE type = ? ORDER BY created_at DESC', [type]);
    const result = [];
    for (const item of rows) {
      const tracks = all('SELECT * FROM tracks WHERE music_id = ? ORDER BY track_number ASC', [item.id]);
      result.push({
        ...item,
        allow_download: item.allow_download === 1 || item.allow_download === '1',
        tracks,
        track_count: tracks.length,
        stream_count: 0
      });
    }
    return jsonResponse(200, { music: result });
  }

  if (route === '/' && event.httpMethod === 'POST') {
    const body = parseBody(event);
    const type = body.type || 'single';
    const title = String(body.title || '').trim();
    if (!title || !user) return jsonResponse(400, { error: 'Title and authentication are required' });
    const id = uuidv4();
    run('INSERT INTO music (id,type,title,genre,year,emoji,description,allow_download,artist_id) VALUES (?,?,?,?,?,?,?,?,?)', [id, type, title, body.genre || '', body.year || new Date().getFullYear(), body.emoji || (type === 'album' ? '💿' : '🎵'), body.description || '', isTruthy(body.allow_download) ? 1 : 0, user.id]);
    if (type === 'album') {
      const tracks = body.tracks ? JSON.parse(body.tracks) : [];
      tracks.forEach((track, index) => run('INSERT INTO tracks (id,music_id,track_number,title,duration,filename) VALUES (?,?,?,?,?,?)', [uuidv4(), id, index + 1, track.title || `Track ${index + 1}`, track.duration || '3:00', null]));
    }
    const item = get('SELECT * FROM music WHERE id = ?', [id]);
    const tracks = all('SELECT * FROM tracks WHERE music_id = ? ORDER BY track_number ASC', [id]);
    return jsonResponse(201, { music: { ...item, allow_download: item.allow_download === 1, tracks, track_count: tracks.length, stream_count: 0 } });
  }

  if (route.startsWith('/') && event.httpMethod === 'POST' && route.includes('/download/')) {
    const id = route.split('/download/').pop();
    if (!user) return jsonResponse(401, { error: 'Authentication required' });
    run('INSERT INTO downloads (id,user_id,music_id) VALUES (?,?,?)', [uuidv4(), user.id, id]);
    return jsonResponse(200, { success: true });
  }

  if (route.startsWith('/') && event.httpMethod === 'POST' && route.includes('/stream/')) {
    const id = route.split('/stream/').pop();
    run('INSERT INTO streams (id,user_id,track_id) VALUES (?,?,?)', [uuidv4(), user ? user.id : null, id]);
    return jsonResponse(200, { success: true });
  }

  if (route.startsWith('/') && event.httpMethod === 'DELETE') {
    const id = route.replace(/^\//, '');
    run('DELETE FROM tracks WHERE music_id = ?', [id]);
    run('DELETE FROM music WHERE id = ?', [id]);
    return jsonResponse(200, { success: true });
  }

  return jsonResponse(404, { error: 'Music route not found' });
}

async function handleSocial(event, route) {
  await ensureDb();
  const user = getAuthUser(event);
  const query = getQuery(event);
  const body = parseBody(event);

  if (route === '/stats' && event.httpMethod === 'GET') {
    const totalPosts = all('SELECT COUNT(*) as count FROM posts').length ? all('SELECT COUNT(*) as count FROM posts')[0].count : 0;
    const totalComments = all('SELECT COUNT(*) as count FROM comments').length ? all('SELECT COUNT(*) as count FROM comments')[0].count : 0;
    const totalLikes = all('SELECT COUNT(*) as count FROM post_likes').length ? all('SELECT COUNT(*) as count FROM post_likes')[0].count : 0;
    const activeFans = all('SELECT COUNT(*) as count FROM users WHERE role = ?', ['fan']).length ? all('SELECT COUNT(*) as count FROM users WHERE role = ?', ['fan'])[0].count : 0;
    return jsonResponse(200, { total_posts: totalPosts, total_comments: totalComments, total_likes: totalLikes, active_fans: activeFans });
  }

  if (route === '/posts' && event.httpMethod === 'GET') {
    const page = parseInt(query.page || '1', 10);
    const limit = parseInt(query.limit || '10', 10);
    const posts = all('SELECT * FROM posts ORDER BY created_at DESC');
    const start = (page - 1) * limit;
    const pagePosts = posts.slice(start, start + limit);
    const result = pagePosts.map(post => ({
      ...post,
      avatar: get('SELECT avatar FROM users WHERE id = ?', [post.user_id])?.avatar || '🎧',
      username: get('SELECT username FROM users WHERE id = ?', [post.user_id])?.username || 'User',
      role: get('SELECT role FROM users WHERE id = ?', [post.user_id])?.role || 'fan',
      liked_by_me: !!(user && get('SELECT id FROM post_likes WHERE post_id = ? AND user_id = ?', [post.id, user.id])),
      like_count: get('SELECT COUNT(*) as count FROM post_likes WHERE post_id = ?', [post.id])?.count || 0,
      comment_count: get('SELECT COUNT(*) as count FROM comments WHERE post_id = ?', [post.id])?.count || 0
    }));
    return jsonResponse(200, { posts: result, page, pages: Math.max(1, Math.ceil(posts.length / limit)) });
  }

  if (route === '/posts' && event.httpMethod === 'POST') {
    if (!user) return jsonResponse(401, { error: 'Authentication required' });
    const content = String(body.content || '').trim();
    const id = uuidv4();
    run('INSERT INTO posts (id,user_id,content,image_filename,image_url,post_type,like_count,comment_count) VALUES (?,?,?,?,?,?,?,?)', [id, user.id, content, null, null, 'text', 0, 0]);
    const post = get('SELECT * FROM posts WHERE id = ?', [id]);
    return jsonResponse(201, { post: { ...post, avatar: user.avatar || '🎧', username: user.username, role: user.role, liked_by_me: false, like_count: 0, comment_count: 0 } });
  }

  if (route.startsWith('/posts/') && event.httpMethod === 'POST' && route.endsWith('/like')) {
    const postId = route.split('/')[2];
    if (!user) return jsonResponse(401, { error: 'Authentication required' });
    const existing = get('SELECT id FROM post_likes WHERE post_id = ? AND user_id = ?', [postId, user.id]);
    if (existing) {
      run('DELETE FROM post_likes WHERE post_id = ? AND user_id = ?', [postId, user.id]);
    } else {
      run('INSERT INTO post_likes (id,post_id,user_id) VALUES (?,?,?)', [uuidv4(), postId, user.id]);
    }
    const likeCount = get('SELECT COUNT(*) as count FROM post_likes WHERE post_id = ?', [postId])?.count || 0;
    return jsonResponse(200, { liked: !existing, like_count: likeCount });
  }

  if (route.startsWith('/posts/') && event.httpMethod === 'GET' && route.endsWith('/comments')) {
    const postId = route.split('/')[2];
    const comments = all('SELECT * FROM comments WHERE post_id = ? ORDER BY created_at ASC', [postId]);
    const result = comments.map(comment => ({
      ...comment,
      avatar: get('SELECT avatar FROM users WHERE id = ?', [comment.user_id])?.avatar || '🎧',
      username: get('SELECT username FROM users WHERE id = ?', [comment.user_id])?.username || 'User',
      role: get('SELECT role FROM users WHERE id = ?', [comment.user_id])?.role || 'fan'
    }));
    return jsonResponse(200, { comments: result });
  }

  if (route.startsWith('/posts/') && event.httpMethod === 'POST' && route.endsWith('/comments')) {
    if (!user) return jsonResponse(401, { error: 'Authentication required' });
    const postId = route.split('/')[2];
    const content = String(body.content || '').trim();
    if (!content) return jsonResponse(400, { error: 'Comment content is required' });
    const id = uuidv4();
    run('INSERT INTO comments (id,post_id,user_id,content) VALUES (?,?,?,?)', [id, postId, user.id, content]);
    const comment = get('SELECT * FROM comments WHERE id = ?', [id]);
    return jsonResponse(201, { comment: { ...comment, avatar: user.avatar || '🎧', username: user.username, role: user.role } });
  }

  if (route.startsWith('/posts/') && event.httpMethod === 'DELETE') {
    const postId = route.split('/')[2];
    if (!user) return jsonResponse(401, { error: 'Authentication required' });
    run('DELETE FROM comments WHERE post_id = ?', [postId]);
    run('DELETE FROM post_likes WHERE post_id = ?', [postId]);
    run('DELETE FROM posts WHERE id = ?', [postId]);
    return jsonResponse(200, { success: true });
  }

  if (route.startsWith('/comments/') && event.httpMethod === 'DELETE') {
    if (!user) return jsonResponse(401, { error: 'Authentication required' });
    const commentId = route.split('/').pop();
    run('DELETE FROM comments WHERE id = ?', [commentId]);
    return jsonResponse(200, { success: true });
  }

  return jsonResponse(404, { error: 'Social route not found' });
}

async function handleAdmin(event, route) {
  await ensureDb();
  const user = getAuthUser(event);
  if (!user) return jsonResponse(401, { error: 'Authentication required' });

  const totalUsers = get('SELECT COUNT(*) as count FROM users')?.count || 0;
  const totalSingles = get('SELECT COUNT(*) as count FROM music WHERE type = ?', ['single'])?.count || 0;
  const totalAlbums = get('SELECT COUNT(*) as count FROM music WHERE type = ?', ['album'])?.count || 0;
  const users = all('SELECT id,username,email,role,avatar,bio,created_at FROM users ORDER BY created_at DESC');
  const singles = all('SELECT * FROM music WHERE type = ? ORDER BY created_at DESC', ['single']);
  const albums = all('SELECT * FROM music WHERE type = ? ORDER BY created_at DESC', ['album']);
  return jsonResponse(200, { stats: { totalUsers, totalSingles, totalAlbums }, users, music: { singles, albums } });
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return jsonResponse(200, { ok: true });
  const route = getRoute(event);

  if (route.startsWith('/auth/')) return handleAuth(event, route.replace('/auth', ''));
  if (route.startsWith('/music')) return handleMusic(event, route.replace('/music', '') || '/');
  if (route.startsWith('/social')) return handleSocial(event, route.replace('/social', '') || '/');
  if (route.startsWith('/admin')) return handleAdmin(event, route.replace('/admin', '') || '/');
  if (route === '/health') return jsonResponse(200, { status: 'ok' });

  return jsonResponse(404, { error: 'Route not found' });
};
