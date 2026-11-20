import { Router }       from 'express';
import multer           from 'multer';
import path             from 'path';
import fs               from 'fs';
import { fileURLToPath } from 'url';
import { Music, Track, Stream, Download } from '../db/models.js';
import { requireAuth, requireArtist, optionalAuth } from '../middleware/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router    = Router();

// ── Audio upload ──────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../uploads');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname)}`),
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    ['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac'].includes(path.extname(file.originalname).toLowerCase())
      ? cb(null, true)
      : cb(new Error('Audio files only'));
  },
});

// ── Serialisers ────────────────────────────────────────────────
function serializeTrack(t) {
  return {
    id:           t._id.toString(),
    music_id:     t.music_id.toString(),
    track_number: t.track_number,
    title:        t.title,
    duration:     t.duration,
    filename:     t.filename ?? null,
  };
}

function serializeMusic(m, { tracks = [], trackCount = 0, streamCount = 0 } = {}) {
  return {
    id:             m._id.toString(),
    type:           m.type,
    title:          m.title,
    genre:          m.genre,
    year:           m.year,
    emoji:          m.emoji,
    description:    m.description,
    allow_download: m.allow_download,
    artist_id:      m.artist_id._id?.toString() ?? m.artist_id.toString(),
    artist_name:    m.artist_id.username ?? '',
    artist_avatar:  m.artist_id.avatar  ?? '',
    track_count:    trackCount,
    stream_count:   streamCount,
    tracks:         tracks.map(serializeTrack),
    created_at:     m.created_at,
  };
}

// ── GET /api/music ────────────────────────────────────────────
router.get('/', optionalAuth, async (req, res) => {
  try {
    const filter = req.query.type ? { type: req.query.type } : {};
    const music  = await Music.find(filter)
      .populate('artist_id', 'username avatar')
      .sort({ created_at: -1 })
      .lean();

    const ids = music.map(m => m._id);

    const allTracks = await Track.find({ music_id: { $in: ids } }).sort({ track_number: 1 }).lean();
    const streamAgg = allTracks.length ? await Stream.aggregate([
      { $match: { track_id: { $in: allTracks.map(t => t._id) } } },
      { $group: { _id: '$track_id', count: { $sum: 1 } } },
    ]) : [];
    const tracksByMusic = Object.groupBy(allTracks, t => t.music_id.toString());
    const trackMusic = new Map(allTracks.map(t => [t._id.toString(), t.music_id.toString()]));
    const streamsByMusic = {};
    for (const stream of streamAgg) {
      const musicId = trackMusic.get(stream._id.toString());
      streamsByMusic[musicId] = (streamsByMusic[musicId] || 0) + stream.count;
    }

    res.json({
      music: music.map(m => serializeMusic(m, {
        tracks:      (tracksByMusic[m._id.toString()] ?? []).map(t => ({ ...t, id: t._id.toString(), music_id: t.music_id.toString() })),
        trackCount:  (tracksByMusic[m._id.toString()] ?? []).length,
        streamCount: streamsByMusic[m._id.toString()] ?? 0,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load music' });
  }
});

// ── GET /api/music/stats/artist ───────────────────────────────
router.get('/stats/artist', requireArtist, async (req, res) => {
  try {
    const artistId = req.user.id;
    const musicIds = (await Music.find({ artist_id: artistId }, '_id')).map(m => m._id);
    const trackIds = (await Track.find({ music_id: { $in: musicIds } }, '_id')).map(t => t._id);

    const [tracks, albums, streams, downloads] = await Promise.all([
      Track.countDocuments({ music_id: { $in: musicIds } }),
      Music.countDocuments({ artist_id: artistId, type: 'album' }),
      Stream.countDocuments({ track_id: { $in: trackIds } }),
      Download.countDocuments({ music_id: { $in: musicIds } }),
    ]);

    res.json({ tracks, albums, streams, downloads });
  } catch {
    res.status(500).json({ error: 'Failed to load stats' });
  }
});

// ── GET /api/music/:id ────────────────────────────────────────
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const m = await Music.findById(req.params.id).populate('artist_id', 'username avatar').lean();
    if (!m) return res.status(404).json({ error: 'Not found' });
    const tracks = await Track.find({ music_id: m._id }).sort({ track_number: 1 }).lean();
    res.json({ music: serializeMusic(m, { tracks, trackCount: tracks.length }) });
  } catch {
    res.status(404).json({ error: 'Not found' });
  }
});

// ── POST /api/music ───────────────────────────────────────────
router.post('/', requireArtist, upload.array('audio', 20), async (req, res) => {
  try {
    const { type, title, genre, year, emoji, description, allow_download, tracks: tracksJSON } = req.body;
    if (!type || !title) return res.status(400).json({ error: 'type and title are required' });

    const music = await Music.create({
      type, title,
      genre:          genre || '',
      year:           year ? parseInt(year, 10) : undefined,
      emoji:          emoji || (type === 'album' ? '💿' : '🎵'),
      description:    description || '',
      allow_download: allow_download !== 'false',
      artist_id:      req.user.id,
    });

    const files = req.files ?? [];

    if (type === 'single') {
      await Track.create({
        music_id: music._id, track_number: 1, title,
        filename: files[0]?.filename ?? null,
      });
    } else {
      const trackList = tracksJSON ? JSON.parse(tracksJSON) : [];
      await Track.insertMany(
        trackList.map((t, i) => ({
          music_id:     music._id,
          track_number: i + 1,
          title:        t.title || `Track ${i + 1}`,
          duration:     t.duration || '0:00',
          filename:     files[i]?.filename ?? null,
        }))
      );
    }

    const populated = await Music.findById(music._id).populate('artist_id', 'username avatar').lean();
    const tracks    = await Track.find({ music_id: music._id }).sort({ track_number: 1 }).lean();

    res.status(201).json({ music: serializeMusic(populated, { tracks, trackCount: tracks.length }) });
  } catch (err) {
    console.error('Publish error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/music/:id ─────────────────────────────────────
router.delete('/:id', requireArtist, async (req, res) => {
  try {
    const m = await Music.findById(req.params.id);
    if (!m) return res.status(404).json({ error: 'Not found' });
    if (m.artist_id.toString() !== req.user.id)
      return res.status(403).json({ error: 'Not your music' });

    await Track.deleteMany({ music_id: m._id });
    await m.deleteOne();
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Delete failed' });
  }
});

// ── POST /api/music/stream/:trackId ──────────────────────────
router.post('/stream/:trackId', optionalAuth, async (req, res) => {
  try {
    const track = await Track.findById(req.params.trackId);
    if (!track) return res.status(404).json({ error: 'Track not found' });
    await Stream.create({ track_id: track._id, user_id: req.user?.id ?? null });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to log stream' });
  }
});

// ── POST /api/music/download/:id ──────────────────────────────
router.post('/download/:id', requireAuth, async (req, res) => {
  try {
    const m = await Music.findOne({ _id: req.params.id, allow_download: true });
    if (!m) return res.status(404).json({ error: 'Not found or download not allowed' });
    await Download.create({ music_id: m._id, user_id: req.user.id });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to log download' });
  }
});

export default router;
