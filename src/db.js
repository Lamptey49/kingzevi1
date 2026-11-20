import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { resolve, join } from 'path';
import initSqlJs from 'sql.js';

const dataDir = process.env.DATA_DIR
  ? resolve(process.env.DATA_DIR)
  : join(__dirname, '..', '/');
const dbPath = join(dataDir, 'solace.db');

mkdirSync(dataDir, { recursive: true });

let SQL;
let db;
let writeQueue = Promise.resolve();

function persist() {
  const data = db.export();
  writeFileSync(dbPath, Buffer.from(data));
}

function bindParams(statement, params = []) {
  if (params.length) statement.bind(params);
}

function rowFromStatement(statement) {
  const columns = statement.getColumnNames();
  const values = statement.get();
  return Object.fromEntries(columns.map((column, index) => [column, values[index]]));
}

async function run(sql, params = []) {
  return enqueueWrite(() => {
    const statement = db.prepare(sql);
    try {
      bindParams(statement, params);
      statement.step();
      const changes = db.getRowsModified();
      const idRow = db.exec('SELECT last_insert_rowid() AS id')[0];
      persist();
      return { id: idRow?.values?.[0]?.[0] ?? null, changes };
    } finally {
      statement.free();
    }
  });
}

async function get(sql, params = []) {
  const statement = db.prepare(sql);
  try {
    bindParams(statement, params);
    return statement.step() ? rowFromStatement(statement) : undefined;
  } finally {
    statement.free();
  }
}

async function all(sql, params = []) {
  const statement = db.prepare(sql);
  const rows = [];
  try {
    bindParams(statement, params);
    while (statement.step()) rows.push(rowFromStatement(statement));
    return rows;
  } finally {
    statement.free();
  }
}

function enqueueWrite(operation) {
  writeQueue = writeQueue.then(operation, operation);
  return writeQueue;
}

async function initDb() {
  SQL = await initSqlJs();
  db = existsSync(dbPath)
    ? new SQL.Database(readFileSync(dbPath))
    : new SQL.Database();

  await run('PRAGMA foreign_keys = ON');

  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('fan', 'artist', 'admin')) DEFAULT 'fan',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS singles (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      genre TEXT NOT NULL DEFAULT 'Other',
      release_year INTEGER NOT NULL,
      emoji TEXT NOT NULL DEFAULT '🎵',
      description TEXT,
      allow_download INTEGER NOT NULL DEFAULT 1,
      audio_path TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS albums (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      genre TEXT NOT NULL DEFAULT 'Other',
      release_year INTEGER NOT NULL,
      emoji TEXT NOT NULL DEFAULT '💿',
      description TEXT,
      allow_download INTEGER NOT NULL DEFAULT 1,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS album_tracks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      album_id TEXT NOT NULL,
      title TEXT NOT NULL,
      duration TEXT NOT NULL DEFAULT '3:00',
      track_order INTEGER NOT NULL,
      audio_path TEXT,
      FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE
    )
  `);

  await seedMusic();
}

async function seedMusic() {
  const existingSingles = await get('SELECT COUNT(*) AS count FROM singles');
  const existingAlbums = await get('SELECT COUNT(*) AS count FROM albums');

  if (existingSingles.count === 0) {
    await run(
      `INSERT INTO singles (id, title, genre, release_year, emoji, description, allow_download)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['s1', 'Golden Hour', 'Afrobeats', 2026, '☀️', 'A warm summer anthem about chasing light.', 1]
    );
    await run(
      `INSERT INTO singles (id, title, genre, release_year, emoji, description, allow_download)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['s2', 'Neon Rain', 'R&B / Soul', 2025, '🌧️', 'Late-night reflections under city lights.', 1]
    );
    await run(
      `INSERT INTO singles (id, title, genre, release_year, emoji, description, allow_download)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['s3', 'Still Waters', 'Jazz', 2025, '🌊', 'Finding calm in the midst of chaos.', 0]
    );
  }

  if (existingAlbums.count === 0) {
    await insertAlbumSeed('a1', 'Midnight Reverie', 'R&B / Soul', 2024, '🌙', 'A journey through the hours after midnight.', [
      ['Intro (3AM)', '1:12'],
      ['Fade Into You', '3:45'],
      ['Empty Streets', '4:02'],
      ['Candle Light', '3:28'],
      ['Reverie', '5:14']
    ]);

    await insertAlbumSeed('a2', 'Harmattan Season', 'Afrobeats', 2023, '🏜️', 'Roots, dust, and the sound of home.', [
      ['Arise', '3:10'],
      ['Akosua', '4:22'],
      ['Road to Kumasi', '3:55'],
      ['Harmattan Dance', '4:08'],
      ['Come Back', '3:40'],
      ['Dust & Gold', '5:00']
    ]);
  }
}

async function insertAlbumSeed(id, title, genre, year, emoji, description, tracks) {
  await run(
    `INSERT INTO albums (id, title, genre, release_year, emoji, description, allow_download)
     VALUES (?, ?, ?, ?, ?, ?, 1)`,
    [id, title, genre, year, emoji, description]
  );

  for (let index = 0; index < tracks.length; index += 1) {
    await run(
      `INSERT INTO album_tracks (album_id, title, duration, track_order)
       VALUES (?, ?, ?, ?)`,
      [id, tracks[index][0], tracks[index][1], index + 1]
    );
  }
}

async function listMusic() {
  const singles = await all(`
    SELECT id, title, genre, release_year AS year, emoji, description AS "desc",
           allow_download AS download, audio_path AS audioPath, created_at AS createdAt
    FROM singles
    ORDER BY datetime(created_at) DESC
  `);

  const albums = await all(`
    SELECT id, title, genre, release_year AS year, emoji, description AS "desc",
           allow_download AS download, created_at AS createdAt
    FROM albums
    ORDER BY datetime(created_at) DESC
  `);

  const tracks = await all(`
    SELECT album_id AS albumId, title AS name, duration AS dur, audio_path AS audioPath
    FROM album_tracks
    ORDER BY track_order ASC
  `);

  return {
    singles: singles.map((single) => ({
      ...single,
      type: 'single',
      download: Boolean(single.download)
    })),
    albums: albums.map((album) => ({
      ...album,
      type: 'album',
      download: Boolean(album.download),
      tracks: tracks.filter((track) => track.albumId === album.id).map(({ albumId, ...track }) => track)
    }))
  };
}

export default {
  all,
  get,
  initDb,
  listMusic,
  run
};
