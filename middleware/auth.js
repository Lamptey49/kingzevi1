import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET ?? 'solace_dev_secret_change_in_prod';

export const signToken = (payload) => jwt.sign(payload, SECRET, { expiresIn: '7d' });

export function requireAuth(req, res, next) {
  const header = req.headers['authorization'];
  const token  = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try   { req.user = jwt.verify(token, SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid or expired token' }); }
}

export function requireArtist(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'artist')
      return res.status(403).json({ error: 'Artist access required' });
    next();
  });
}

export function optionalAuth(req, res, next) {
  const header = req.headers['authorization'];
  const token  = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) { try { req.user = jwt.verify(token, SECRET); } catch { /* ignored */ } }
  next();
}
