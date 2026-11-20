import { Router } from 'express';
import bcrypt      from 'bcryptjs';
import multer      from 'multer';
import { User }    from '../db/models.js';
import { signToken, requireAuth } from '../middleware/auth.js';
import { uploadAvatar, deleteImage } from '../lib/cloudinary.js';

const router = Router();

// Avatar uploads stay in RAM — never touch the disk
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.mimetype)
      ? cb(null, true)
      : cb(new Error('Profile picture must be jpg, png, gif or webp'));
  },
});

// Consistent public shape — used by every endpoint in this file
function serializeUser(user) {
  return {
    id:         user._id?.toString() ?? user.id,
    username:   user.username,
    email:      user.email,
    role:       user.role,
    avatar:     user.avatar,
    avatar_url: user.avatar_url  ?? null,
    bio:        user.bio         ?? '',
    created_at: user.created_at,
  };
}

// ── POST /api/auth/register ───────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { username, email, password, role, avatar } = req.body;

    if (!username || !email || !password)
      return res.status(400).json({ error: 'Username, email, and password are required' });
    if (password.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const conflict = await User.findOne({ $or: [{ email: email.toLowerCase() }, { username }] });
    if (conflict?.email === email.toLowerCase())
      return res.status(409).json({ error: 'Email already in use' });
    if (conflict?.username === username)
      return res.status(409).json({ error: 'Username already taken' });

    const userRole   = role === 'artist' ? 'artist' : 'fan';
    const userAvatar = avatar ?? (userRole === 'artist' ? '🎤' : '🎧');
    const hash       = await bcrypt.hash(password, 12);

    const user  = await User.create({ username, email, password_hash: hash, role: userRole, avatar: userAvatar });
    const token = signToken({ id: user.id, username, email, role: userRole, avatar: userAvatar });
    res.status(201).json({ token, user: serializeUser(user) });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ── POST /api/auth/login ──────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'Email and password required' });

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user || !(await bcrypt.compare(password, user.password_hash)))
      return res.status(401).json({ error: 'Invalid email or password' });

    const token = signToken({ id: user.id, username: user.username, email: user.email, role: user.role, avatar: user.avatar });
    res.json({ token, user: serializeUser(user) });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ── GET /api/auth/me ──────────────────────────────────────────
router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password_hash -avatar_public_id');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user: serializeUser(user) });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── PUT /api/auth/profile ─────────────────────────────────────
// Update the logged-in user's username and/or bio
router.put('/profile', requireAuth, async (req, res) => {
  try {
    const { bio, username } = req.body;
    const updates = {};

    if (bio !== undefined) {
      if (bio.length > 200)
        return res.status(400).json({ error: 'Bio must be under 200 characters' });
      updates.bio = bio.trim();
    }

    if (username !== undefined) {
      const trimmed = username.trim();
      if (!trimmed)
        return res.status(400).json({ error: 'Username cannot be empty' });
      if (trimmed.length < 2)
        return res.status(400).json({ error: 'Username must be at least 2 characters' });
      if (!/^[a-zA-Z0-9_]+$/.test(trimmed))
        return res.status(400).json({ error: 'Username may only contain letters, numbers and underscores' });

      const conflict = await User.findOne({ username: trimmed, _id: { $ne: req.user.id } });
      if (conflict)
        return res.status(409).json({ error: 'Username already taken' });

      updates.username = trimmed;
    }

    if (!Object.keys(updates).length)
      return res.status(400).json({ error: 'Nothing to update' });

    const updated = await User.findByIdAndUpdate(
      req.user.id,
      { $set: updates },
      { new: true, runValidators: true },
    ).select('-password_hash -avatar_public_id');

    res.json({ user: serializeUser(updated) });
  } catch (err) {
    console.error('PUT /auth/profile error:', err);
    res.status(500).json({ error: err.message ?? 'Update failed' });
  }
});

// ── POST /api/auth/avatar ─────────────────────────────────────
// Upload or replace the logged-in user's profile picture
router.post('/avatar', requireAuth, upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file)
      return res.status(400).json({ error: 'No image file provided' });

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Keep the current picture available until its replacement is saved.
    const previousAvatar = user.avatar_public_id;

    const result  = await uploadAvatar(req.file.buffer);
    const updated = await User.findByIdAndUpdate(
      req.user.id,
      { $set: { avatar_url: result.secure_url, avatar_public_id: result.public_id } },
      { new: true },
    ).select('-password_hash -avatar_public_id');

    await deleteImage(previousAvatar);

    res.json({ user: serializeUser(updated) });
  } catch (err) {
    console.error('POST /auth/avatar error:', err);
    res.status(500).json({ error: err.message ?? 'Avatar upload failed' });
  }
});

// ── DELETE /api/auth/avatar ───────────────────────────────────
// Remove profile picture and fall back to emoji
router.delete('/avatar', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    await deleteImage(user.avatar_public_id);

    const updated = await User.findByIdAndUpdate(
      req.user.id,
      { $set: { avatar_url: null, avatar_public_id: null } },
      { new: true },
    ).select('-password_hash -avatar_public_id');

    res.json({ user: serializeUser(updated) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove avatar' });
  }
});

export default router;
