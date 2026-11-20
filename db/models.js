import mongoose from 'mongoose';

const { Schema, model } = mongoose;

// ── Shared transform ──────────────────────────────────────────
// Converts _id → id, removes __v from every model's JSON output
const toJSON = {
  virtuals: true,
  transform: (_, ret) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
};

// ── USER ──────────────────────────────────────────────────────
const userSchema = new Schema({
  username:         { type: String, required: true, unique: true, trim: true },
  email:            { type: String, required: true, unique: true, lowercase: true, trim: true },
  password_hash:    { type: String, required: true },
  role:             { type: String, enum: ['fan', 'artist'], default: 'fan' },
  avatar:           { type: String, default: '🎧' },       // emoji fallback
  avatar_url:       { type: String, default: null },        // Cloudinary profile picture
  avatar_public_id: { type: String, default: null },        // for deletion
  bio:              { type: String, default: '', maxlength: 200 },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }, toJSON });

export const User = model('User', userSchema);

// ── MUSIC ─────────────────────────────────────────────────────
const musicSchema = new Schema({
  type:           { type: String, enum: ['single', 'album'], required: true },
  title:          { type: String, required: true, trim: true },
  genre:          { type: String, default: '' },
  year:           { type: Number },
  emoji:          { type: String, default: '🎵' },
  description:    { type: String, default: '' },
  allow_download: { type: Boolean, default: true },
  artist_id:      { type: Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: { createdAt: 'created_at', updatedAt: false }, toJSON });

musicSchema.index({ type: 1, created_at: -1 });

export const Music = model('Music', musicSchema);

// ── TRACK ─────────────────────────────────────────────────────
const trackSchema = new Schema({
  music_id:     { type: Schema.Types.ObjectId, ref: 'Music', required: true },
  track_number: { type: Number, required: true },
  title:        { type: String, required: true, trim: true },
  duration:     { type: String, default: '0:00' },
  filename:     { type: String, default: null },
}, { toJSON });

trackSchema.index({ music_id: 1, track_number: 1 });

export const Track = model('Track', trackSchema);

// ── STREAM ────────────────────────────────────────────────────
const streamSchema = new Schema({
  user_id:  { type: Schema.Types.ObjectId, ref: 'User', default: null },
  track_id: { type: Schema.Types.ObjectId, ref: 'Track', required: true },
}, { timestamps: { createdAt: 'streamed_at', updatedAt: false } });

streamSchema.index({ track_id: 1 });

export const Stream = model('Stream', streamSchema);

// ── DOWNLOAD ──────────────────────────────────────────────────
const downloadSchema = new Schema({
  user_id:  { type: Schema.Types.ObjectId, ref: 'User', required: true },
  music_id: { type: Schema.Types.ObjectId, ref: 'Music', required: true },
}, { timestamps: { createdAt: 'downloaded_at', updatedAt: false } });

export const Download = model('Download', downloadSchema);

// ── POST ──────────────────────────────────────────────────────
const postSchema = new Schema({
  user_id:          { type: Schema.Types.ObjectId, ref: 'User', required: true },
  content:          { type: String, default: null },
  image_url:        { type: String, default: null },   // Cloudinary secure_url
  original_post_id: { type: Schema.Types.ObjectId, ref: 'Post', default: null },
  image_public_id:  { type: String, default: null },   // Cloudinary public_id (for deletion)
  post_type:        { type: String, enum: ['text', 'image', 'repost'], default: 'text' },
  like_count:       { type: Number, default: 0 },
  comment_count:    { type: Number, default: 0 },
}, { timestamps: { createdAt: 'created_at', updatedAt: false }, toJSON });

postSchema.index({ user_id: 1, original_post_id: 1 }, { unique: true, partialFilterExpression: { original_post_id: { $type: 'objectId' } } });
postSchema.index({ original_post_id: 1 });
postSchema.index({ created_at: -1, _id: -1 });
postSchema.index({ user_id: 1, created_at: -1, _id: -1 });

export const Post = model('Post', postSchema);

// ── POST LIKE ─────────────────────────────────────────────────
const postLikeSchema = new Schema({
  post_id: { type: Schema.Types.ObjectId, ref: 'Post', required: true },
  user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: { createdAt: 'created_at', updatedAt: false } });

// Enforce one like per user per post
postLikeSchema.index({ post_id: 1, user_id: 1 }, { unique: true });

export const PostLike = model('PostLike', postLikeSchema);

// ── COMMENT ───────────────────────────────────────────────────
const commentSchema = new Schema({
  post_id: { type: Schema.Types.ObjectId, ref: 'Post', required: true },
  user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  content: { type: String, required: true, maxlength: 500, trim: true },
}, { timestamps: { createdAt: 'created_at', updatedAt: false }, toJSON });

commentSchema.index({ post_id: 1, created_at: 1 });

export const Comment = model('Comment', commentSchema);

const followSchema = new Schema({
  follower_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  following_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: { createdAt: 'created_at', updatedAt: false } });
followSchema.index({ follower_id: 1, following_id: 1 }, { unique: true });
followSchema.index({ following_id: 1 });
export const Follow = model('Follow', followSchema);
