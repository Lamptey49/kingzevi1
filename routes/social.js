import mongoose from 'mongoose';
import { Router }        from 'express';
import multer            from 'multer';
import { Post, PostLike, Comment, Follow, User } from '../db/models.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';
import { uploadBuffer, deleteImage } from '../lib/cloudinary.js';

const router = Router();

// ── Image upload ───────────────────────────────────────────────
// memoryStorage keeps the file in RAM as a Buffer — no local disk
// involved at all. The buffer goes straight to Cloudinary.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },  // 8 MB cap
  fileFilter: (req, file, cb) => {
    const ok = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    ok.includes(file.mimetype)
      ? cb(null, true)
      : cb(new Error('Images only — jpg, png, gif or webp'));
  },
});

// ── Serialisers ────────────────────────────────────────────────
export function serializePost(post, likedByMe = false) {
  const original = post.post_type === 'repost' ? post.original_post_id : null;
  const source = post.post_type === 'repost' ? original : post;
  const u = post.user_id;
  return {
    id:            post._id.toString(),
    user_id:       u?._id?.toString() ?? post.user_id?.toString(),
    content:       source?.content ?? null,
    image_url:     source?.image_url ?? null,
    post_type:     post.post_type,
    like_count:    post.like_count,
    comment_count: post.comment_count,
    created_at:    post.created_at,
    liked_by_me:   likedByMe,
    original_post_id: original?._id?.toString() ?? null,
    original_author: original?.user_id?.username ?? null,
    original_unavailable: post.post_type === 'repost' && !original,
    share_count: 0,
    shared_by_me: false,
    username:      u?.username   ?? '',
    avatar:        u?.avatar     ?? '🎧',
    avatar_url:    u?.avatar_url ?? null,
    role:          u?.role       ?? 'fan',
  };
}

function serializeComment(c) {
  return {
    id:         c._id.toString(),
    post_id:    c.post_id.toString(),
    user_id:    c.user_id?._id?.toString(),
    content:    c.content,
    created_at: c.created_at,
    username:   c.user_id?.username   ?? '',
    avatar:     c.user_id?.avatar     ?? '🎧',
    avatar_url: c.user_id?.avatar_url ?? null,
    role:       c.user_id?.role       ?? 'fan',
  };
}

// ── GET /api/social/posts ──────────────────────────────────────
router.get('/posts', optionalAuth, async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || 20, 50));
    const page  = Math.max(parseInt(req.query.page,  10) || 1,  1);

    const follows = req.user ? await Follow.find({ follower_id: req.user.id }).select('following_id').lean() : [];
    const followedIds = follows.map(f => f.following_id);
    const followedSet = new Set(followedIds.map(String));
    const baseFilter = req.query.feed === 'following' ? { user_id: { $in: followedIds } } : {};
    if (req.query.feed === 'following' && !req.user) return res.status(401).json({ error: 'Sign in to view your following feed' });
    let filter = baseFilter;
    if (req.query.cursor) {
      try {
        const cursor = JSON.parse(Buffer.from(req.query.cursor, 'base64url').toString());
        const date = new Date(cursor.created_at);
        if (!mongoose.isValidObjectId(cursor.id) || !Number.isFinite(date.getTime())) throw new Error();
        filter = { ...baseFilter, $or: [{ created_at: { $lt: date } }, { created_at: date, _id: { $lt: cursor.id } }] };
      } catch { return res.status(400).json({ error: 'Invalid posts cursor' }); }
    }
    const [rows, total] = await Promise.all([
      Post.find(filter)
        .populate('user_id', 'username avatar avatar_url role')
        .populate({ path: 'original_post_id', populate: { path: 'user_id', select: 'username avatar avatar_url role' } })
        .sort({ created_at: -1, _id: -1 })
        .skip(req.query.cursor ? 0 : (page - 1) * limit)
        .limit(limit + 1)
        .lean(),
      Post.countDocuments(baseFilter),
    ]);

    const posts = rows.slice(0, limit);
    const hasMore = rows.length > limit;
    const last = posts.at(-1);
    let likedSet = new Set();
    if (req.user) {
      const likes = await PostLike.find({
        post_id: { $in: posts.map(p => p._id) },
        user_id: req.user.id,
      }).select('post_id').lean();
      likedSet = new Set(likes.map(l => l.post_id.toString()));
    }

    const originalIds = posts.map(p => p.post_type === 'repost' ? p.original_post_id?._id : p._id).filter(Boolean);
    const [shares, myShares] = await Promise.all([
      Post.aggregate([{ $match: { original_post_id: { $in: originalIds } } }, { $group: { _id: '$original_post_id', count: { $sum: 1 } } }]),
      req.user ? Post.find({ user_id: req.user.id, original_post_id: { $in: originalIds } }).select('original_post_id').lean() : [],
    ]);
    const shareCounts = new Map(shares.map(s => [String(s._id), s.count]));
    const sharedSet = new Set(myShares.map(s => String(s.original_post_id)));
    res.json({
      posts: posts.map(p => {
        const id = String(p.post_type === 'repost' ? p.original_post_id?._id : p._id);
        return { ...serializePost(p, likedSet.has(String(p._id))), following_author: followedSet.has(String(p.user_id?._id)), share_count: shareCounts.get(id) || 0, shared_by_me: sharedSet.has(id) };
      }),
      total,
      has_more: hasMore,
      next_cursor: hasMore && last ? Buffer.from(JSON.stringify({ created_at: last.created_at, id: last._id })).toString('base64url') : null,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error('GET /posts error:', err);
    res.status(500).json({ error: 'Failed to load posts' });
  }
});

// ── POST /api/social/posts ─────────────────────────────────────
router.post('/posts', requireAuth, upload.single('image'), async (req, res) => {
  try {
    const { content } = req.body;
    const file = req.file;

    if (!content?.trim() && !file)
      return res.status(400).json({ error: 'Post must have text or an image' });
    if (content && content.length > 1000)
      return res.status(400).json({ error: 'Post text must be under 1000 characters' });

    let image_url       = null;
    let image_public_id = null;

    if (file) {
      // Upload buffer directly to Cloudinary — zero disk I/O
      const result = await uploadBuffer(file.buffer, {
        // Eager transform: cap at 1200px wide, auto quality, auto format
        eager: [{ width: 1200, crop: 'limit', quality: 'auto', fetch_format: 'auto' }],
      });
      image_url       = result.eager?.[0]?.secure_url ?? result.secure_url;
      image_public_id = result.public_id;
    }

    const post = await Post.create({
      user_id:         req.user.id,
      content:         content?.trim() || null,
      image_url,
      image_public_id,
      post_type:       file ? 'image' : 'text',
    });

    const populated = await Post.findById(post._id)
      .populate('user_id', 'username avatar avatar_url role')
      .lean();

    res.status(201).json({ post: serializePost(populated, false) });
  } catch (err) {
    console.error('POST /posts error:', err);
    res.status(500).json({ error: err.message ?? 'Failed to create post' });
  }
});

// ── DELETE /api/social/posts/:id ──────────────────────────────
router.delete('/posts/:id', requireAuth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post)                                    return res.status(404).json({ error: 'Post not found' });
    if (post.user_id.toString() !== req.user.id)  return res.status(403).json({ error: 'Not your post' });

    // Delete image from Cloudinary (safe no-op if no image or already gone)
    await deleteImage(post.image_public_id);

    await Promise.all([
      Comment.deleteMany(  { post_id: post._id }),
      PostLike.deleteMany( { post_id: post._id }),
      post.deleteOne(),
    ]);

    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /posts error:', err);
    res.status(500).json({ error: 'Delete failed' });
  }
});

// ── POST /api/social/posts/:id/like ───────────────────────────
router.post('/posts/:id/like', requireAuth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const existing = await PostLike.findOne({ post_id: post._id, user_id: req.user.id });

    if (existing) {
      await existing.deleteOne();
      const updated = await Post.findByIdAndUpdate(post._id, { $inc: { like_count: -1 } }, { new: true });
      res.json({ liked: false, like_count: Math.max(0, updated.like_count) });
    } else {
      await PostLike.create({ post_id: post._id, user_id: req.user.id });
      const updated = await Post.findByIdAndUpdate(post._id, { $inc: { like_count: 1  } }, { new: true });
      res.json({ liked: true, like_count: updated.like_count });
    }
  } catch {
    res.status(500).json({ error: 'Failed to toggle like' });
  }
});

// ── GET /api/social/posts/:id/comments ────────────────────────
router.get('/posts/:id/comments', optionalAuth, async (req, res) => {
  try {
    const comments = await Comment.find({ post_id: req.params.id })
      .populate('user_id', 'username avatar avatar_url role')
      .sort({ created_at: 1 })
      .lean();
    res.json({ comments: comments.map(serializeComment) });
  } catch {
    res.status(500).json({ error: 'Failed to load comments' });
  }
});

// ── POST /api/social/posts/:id/comments ───────────────────────
router.post('/posts/:id/comments', requireAuth, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content?.trim())      return res.status(400).json({ error: 'Comment cannot be empty' });
    if (content.length > 500)  return res.status(400).json({ error: 'Comment must be under 500 characters' });

    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const comment   = await Comment.create({ post_id: post._id, user_id: req.user.id, content: content.trim() });
    await Post.findByIdAndUpdate(post._id, { $inc: { comment_count: 1 } });

    const populated = await Comment.findById(comment._id)
      .populate('user_id', 'username avatar avatar_url role')
      .lean();

    res.status(201).json({ comment: serializeComment(populated) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/social/comments/:id ───────────────────────────
router.delete('/comments/:id', requireAuth, async (req, res) => {
  try {
    const comment = await Comment.findById(req.params.id);
    if (!comment)                                       return res.status(404).json({ error: 'Comment not found' });
    if (comment.user_id.toString() !== req.user.id)    return res.status(403).json({ error: 'Not your comment' });

    await Post.findByIdAndUpdate(comment.post_id, { $inc: { comment_count: -1 } });
    await comment.deleteOne();
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Delete failed' });
  }
});

// ── GET /api/social/stats ──────────────────────────────────────
router.get('/stats', optionalAuth, async (req, res) => {
  try {
    const [total_posts, total_comments, total_likes, active_fans] = await Promise.all([
      Post.countDocuments(),
      Comment.countDocuments(),
      PostLike.countDocuments(),
      Post.distinct('user_id').then(ids => ids.length),
    ]);
    res.json({ total_posts, total_comments, total_likes, active_fans });
  } catch {
    res.status(500).json({ error: 'Failed to load stats' });
  }
});


router.get('/users/suggestions', optionalAuth, async (req, res) => {
  const follows = req.user ? await Follow.find({ follower_id: req.user.id }).select('following_id').lean() : [];
  const excluded = follows.map(f => f.following_id);
  if (req.user) excluded.push(req.user.id);
  const users = await User.find({ _id: { $nin: excluded } }).select('username avatar avatar_url role').sort({ _id: -1 }).limit(6).lean();
  res.json({ users: users.map(u => ({ id: String(u._id), username: u.username, avatar: u.avatar, avatar_url: u.avatar_url, role: u.role })) });
});

// Idempotent follow controls prevent duplicate relationships on repeated clicks.
router.route('/users/:id/follow')
  .all(requireAuth, (req, res, next) => {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid user' });
    if (req.params.id.toLowerCase() === req.user.id.toLowerCase()) return res.status(400).json({ error: 'You cannot follow yourself' });
    next();
  })
  .put(async (req, res) => {
    if (!await User.exists({ _id: req.params.id })) return res.status(404).json({ error: 'User not found' });
    try {
      await Follow.updateOne({ follower_id: req.user.id, following_id: req.params.id }, { $setOnInsert: { follower_id: req.user.id, following_id: req.params.id } }, { upsert: true });
    } catch (error) { if (error.code !== 11000) throw error; }
    res.json({ following: true });
  })
  .delete(async (req, res) => {
    await Follow.deleteOne({ follower_id: req.user.id, following_id: req.params.id });
    res.json({ following: false });
  });

router.route('/posts/:id/share')
  .all(requireAuth, async (req, res, next) => {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid post' });
    const post = await Post.findById(req.params.id).lean();
    const original = post?.post_type === 'repost' ? await Post.findById(post.original_post_id).lean() : post;
    if (!original) return res.status(404).json({ error: 'Original post is no longer available' });
    if (String(original.user_id) === req.user.id) return res.status(400).json({ error: 'This is your own post' });
    req.originalPost = original;
    next();
  })
  .put(async (req, res) => {
    const filter = { user_id: req.user.id, original_post_id: req.originalPost._id };
    try { await Post.updateOne(filter, { $setOnInsert: { ...filter, post_type: 'repost' } }, { upsert: true }); }
    catch (error) { if (error.code !== 11000) throw error; }
    res.json({ shared: true, share_count: await Post.countDocuments({ original_post_id: req.originalPost._id }) });
  })
  .delete(async (req, res) => {
    const repost = await Post.findOneAndDelete({ user_id: req.user.id, original_post_id: req.originalPost._id });
    if (repost) await Promise.all([Comment.deleteMany({ post_id: repost._id }), PostLike.deleteMany({ post_id: repost._id })]);
    res.json({ shared: false, share_count: await Post.countDocuments({ original_post_id: req.originalPost._id }) });
  });

export default router;
