import { createHash, randomBytes } from 'crypto';
import { hash, compare } from 'bcryptjs';
import { get, run } from './db';

const COOKIE_NAME = 'solace_session';
const DEFAULT_SESSION_DAYS = Number(process.env.SESSION_DAYS || 7);

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role
  };
}

function setSessionCookie(res, token, expiresAt) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    expires: expiresAt
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production'
  });
}

async function createSession(res, userId) {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + DEFAULT_SESSION_DAYS * 24 * 60 * 60 * 1000);

  await run(
    'INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
    [userId, hashToken(token), expiresAt.toISOString()]
  );

  setSessionCookie(res, token, expiresAt);
}

async function currentUser(req) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return null;

  const row = await get(
    `SELECT users.id, users.name, users.email, users.role, sessions.expires_at
     FROM sessions
     JOIN users ON users.id = sessions.user_id
     WHERE sessions.token_hash = ?`,
    [hashToken(token)]
  );

  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await run('DELETE FROM sessions WHERE token_hash = ?', [hashToken(token)]);
    return null;
  }

  return publicUser(row);
}

async function requireAuth(req, res, next) {
  try {
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: 'Authentication required.' });

    req.user = user;
    return next();
  } catch (error) {
    return next(error);
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required.' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You are not authorized to perform this action.' });
    }
    return next();
  };
}

async function registerUser({ name, email, password, requestedRole }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const displayName = String(name || '').trim();

  if (!displayName) throw Object.assign(new Error('Name is required.'), { status: 400 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw Object.assign(new Error('A valid email is required.'), { status: 400 });
  }
  if (String(password || '').length < 8) {
    throw Object.assign(new Error('Password must be at least 8 characters.'), { status: 400 });
  }

  const existing = await get('SELECT id FROM users WHERE email = ?', [normalizedEmail]);
  if (existing) throw Object.assign(new Error('An account with that email already exists.'), { status: 409 });

  const userCount = await get('SELECT COUNT(*) AS count FROM users');
  const role = userCount.count === 0 ? 'admin' : requestedRole === 'artist' ? 'artist' : 'fan';
  const passwordHash = await hash(password, 12);

  const result = await run(
    'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
    [displayName, normalizedEmail, passwordHash, role]
  );

  return get('SELECT id, name, email, role FROM users WHERE id = ?', [result.id]);
}

async function authenticateUser({ email, password }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const user = await get('SELECT * FROM users WHERE email = ?', [normalizedEmail]);

  if (!user) throw Object.assign(new Error('Invalid email or password.'), { status: 401 });

  const valid = await compare(String(password || ''), user.password_hash);
  if (!valid) throw Object.assign(new Error('Invalid email or password.'), { status: 401 });

  return publicUser(user);
}

async function logout(req, res) {
  const token = req.cookies?.[COOKIE_NAME];
  if (token) await run('DELETE FROM sessions WHERE token_hash = ?', [hashToken(token)]);
  clearSessionCookie(res);
}

export default {
  authenticateUser,
  createSession,
  currentUser,
  logout,
  publicUser,
  registerUser,
  requireAuth,
  requireRole
};
