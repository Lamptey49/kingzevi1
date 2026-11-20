import { Router } from 'express';
import { Music, Track, User, serializeMusic, serializeTrack } from '../db/database.js';
import { requireArtist } from '../middleware/auth.js';

const router = Router();

router.get('/dashboard', requireArtist, async (req, res) => {
  const users = await User.find({}).sort({ createdAt: -1 }).lean();
  const musicDocs = await Music.find({}).sort({ createdAt: -1 });
  const music = [];

  for (const item of musicDocs) {
    const artist = await User.findOne({ id: item.artistId });
    const tracks = await Track.find({ musicId: item.id }).sort({ trackNumber: 1 });
    music.push({
      ...serializeMusic(item, tracks),
      artistName: artist?.username ?? null,
      audioPath: tracks[0]?.filename ? `/uploads/${tracks[0].filename}` : null,
    });
  }

  res.json({
    stats: {
      totalUsers: users.length,
      totalSingles: music.filter((item) => item.type === 'single').length,
      totalAlbums: music.filter((item) => item.type === 'album').length,
    },
    users: users.map((user) => ({
      id: user.id,
      name: user.username,
      username: user.username,
      email: user.email,
      role: user.role,
      avatar: user.avatar,
      createdAt: user.createdAt,
    })),
    music: {
      singles: music.filter((item) => item.type === 'single'),
      albums: music.filter((item) => item.type === 'album'),
    },
  });
});

export default router;
