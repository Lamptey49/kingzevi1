import { Router } from 'express';
import multer      from 'multer';
import { User }    from '../db/models.js';
import { Post, PostLike, Follow } from '../db/models.js';
import { requireAuth, optionalAuth }    from '../middleware/auth.js';
import { uploadAvatar, deleteImage } from '../lib/cloudinary.js';

const router = Router();

// ── Avatar upload — memory only, no disk ──────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 5 * 1024 * 1024 },   // 5 MB cap for avatars
  fileFilter: (req, file, cb) => {
    ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.mimetype)
      ? cb(null, true)
      : cb(new Error('Profile picture must be jpg, png, gif or webp'));
  },
});

// ── Serialise a public user object ─────────────────────────────
function serializeUser(user) {
  return {
    id:         user._id?.toString() ?? user.id,
    username:   user.username,
    role:       user.role,
    avatar:     user.avatar,
    avatar_url: user.avatar_url ?? null,
    bio:        user.bio ?? '',
    created_at: user.created_at,
  };
}

// ── Serialise a post for the profile feed ─────────────────────
function serializePost(post) {
  return {
    id:            post._id.toString(),
    content:       post.post_type === 'repost' ? (post.original_post_id?.content ?? 'Original post is no longer available') : post.content,
    original_author: post.original_post_id?.user_id?.username ?? null,
    image_url:     (post.post_type === 'repost' ? post.original_post_id?.image_url : post.image_url) ?? null,
    post_type:     post.post_type,
    like_count:    post.like_count,
    comment_count: post.comment_count,
    created_at:    post.created_at,
  };
}

// ── GET /api/profile/:username ─────────────────────────────────
// Public profile — anyone can view
router.get('/:username', optionalAuth, async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username })
      .select('-password_hash -email -avatar_public_id');
    if (!user) return res.status(404).json({ error: 'User not found' });

    const userPosts = await Post.find({ user_id: user._id })
      .populate({ path: 'original_post_id', populate: { path: 'user_id', select: 'username' } })
      .sort({ created_at: -1, _id: -1 })
      .limit(24)
      .lean();

    const likes = await Post.aggregate([{ $match: { user_id: user._id } }, { $group: { _id: null, total: { $sum: '$like_count' } } }]);
    const likesReceived = likes[0]?.total || 0;

    const [followers, following, isFollowing, postCount, followerRows, followingRows] = await Promise.all([
      Follow.countDocuments({ following_id: user._id }),
      Follow.countDocuments({ follower_id: user._id }),
      req.user ? Follow.exists({ follower_id: req.user.id, following_id: user._id }) : false,
      Post.countDocuments({ user_id: user._id }),
      Follow.find({ following_id: user._id })
        .populate('follower_id', 'username avatar avatar_url role')
        .sort({ created_at: -1 })
        .limit(50)
        .lean(),
      Follow.find({ follower_id: user._id })
        .populate('following_id', 'username avatar avatar_url role')
        .sort({ created_at: -1 })
        .limit(50)
        .lean(),
    ]);
    res.json({
      following: !!isFollowing,
      user:  serializeUser(user),
      stats: { posts: postCount, likes_received: likesReceived, followers, following },
      followers: followerRows.map(row => row.follower_id && serializeUser(row.follower_id)).filter(Boolean),
      following_users: followingRows.map(row => row.following_id && serializeUser(row.following_id)).filter(Boolean),
      posts: userPosts.map(serializePost),
    });
  } catch (err) {
    console.error('GET /profile/:username error:', err);
    res.status(500).json({ error: 'Failed to load profile' });
  }
});

// ── PUT /api/profile/me ────────────────────────────────────────
// Update bio and/or username
router.put('/me', requireAuth, async (req, res) => {
  try {
    const { bio, username } = req.body;
    const updates = {};

    if (bio !== undefined) {
      if (bio.length > 200) return res.status(400).json({ error: 'Bio must be under 200 characters' });
      updates.bio = bio.trim();
    }

    if (username !== undefined) {
      const trimmed = username.trim();
      if (!trimmed)         return res.status(400).json({ error: 'Username cannot be empty' });
      if (trimmed.length < 2) return res.status(400).json({ error: 'Username must be at least 2 characters' });
      if (!/^[a-zA-Z0-9_]+$/.test(trimmed))
        return res.status(400).json({ error: 'Username may only contain letters, numbers and underscores' });

      // Check uniqueness (excluding self)
      const conflict = await User.findOne({ username: trimmed, _id: { $ne: req.user.id } });
      if (conflict) return res.status(409).json({ error: 'Username already taken' });
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
    console.error('PUT /profile/me error:', err);
    res.status(500).json({ error: err.message ?? 'Update failed' });
  }
});

// ── POST /api/profile/me/avatar ────────────────────────────────
// Upload / replace profile picture
router.post('/me/avatar', requireAuth, upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image file provided' });

    const user = await User.findById(req.user.id);
    if (!user)  return res.status(404).json({ error: 'User not found' });

    // Keep the current picture available until its replacement is saved.
    const previousAvatar = user.avatar_public_id;

    const result = await uploadAvatar(req.file.buffer);

    const updated = await User.findByIdAndUpdate(
      req.user.id,
      { $set: { avatar_url: result.secure_url, avatar_public_id: result.public_id } },
      { new: true },
    ).select('-password_hash -avatar_public_id');

    await deleteImage(previousAvatar);

    res.json({ user: serializeUser(updated) });
  } catch (err) {
    console.error('POST /profile/me/avatar error:', err);
    res.status(500).json({ error: err.message ?? 'Avatar upload failed' });
  }
});

// ── DELETE /api/profile/me/avatar ─────────────────────────────
// Remove profile picture and fall back to emoji
router.delete('/me/avatar', requireAuth, async (req, res) => {
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
