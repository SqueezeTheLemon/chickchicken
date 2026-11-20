import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

// 💡 Node 22.13+ 내장 SQLite → 별도 DB 서버 없이 파일 하나로 영속화돼요.
fs.mkdirSync(config.dataDir, { recursive: true });

export const db = new DatabaseSync(config.dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS broadcasts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    title        TEXT    NOT NULL,
    description  TEXT    NOT NULL DEFAULT '',
    video_path   TEXT    NOT NULL,            -- vod: uploadDir 기준 파일명 / live: liveDir 기준 폴더명
    mime_type    TEXT    NOT NULL,
    size_bytes   INTEGER NOT NULL,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`);

// 💡 마이그레이션: 1단계 DB 파일에는 아래 칼럼이 없어서, 없을 때만 ALTER 로 추가해요
const columns = new Set(db.prepare('PRAGMA table_info(broadcasts)').all().map((c) => c.name));
const addColumn = (name, ddl) => !columns.has(name) && db.exec(`ALTER TABLE broadcasts ADD COLUMN ${ddl}`);
addColumn('kind', "kind TEXT NOT NULL DEFAULT 'vod'"); // vod | live
addColumn('status', "status TEXT NOT NULL DEFAULT 'ended'"); // live(방송 중) | ended(종료)
addColumn('ended_at', 'ended_at TEXT');

export const HLS_MIME = 'application/vnd.apple.mpegurl';

const toBroadcast = (row) =>
  row && {
    id: row.id,
    kind: row.kind,
    status: row.status,
    title: row.title,
    description: row.description,
    videoUrl:
      row.kind === 'live'
        ? `/hls/${encodeURIComponent(row.video_path)}/index.m3u8`
        : `/videos/${encodeURIComponent(row.video_path)}`,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
    endedAt: row.ended_at,
  };

const insertStmt = db.prepare(`
  INSERT INTO broadcasts (kind, status, title, description, video_path, mime_type, size_bytes)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
// 방송 중인 라이브를 맨 위로
const listStmt = db.prepare("SELECT * FROM broadcasts ORDER BY status = 'live' DESC, id DESC");
const getStmt = db.prepare('SELECT * FROM broadcasts WHERE id = ?');
const setVideoPathStmt = db.prepare('UPDATE broadcasts SET video_path = ? WHERE id = ?');
const endStmt = db.prepare(
  "UPDATE broadcasts SET status = 'ended', ended_at = datetime('now') WHERE id = ? AND status = 'live'",
);
const liveRowsStmt = db.prepare("SELECT * FROM broadcasts WHERE status = 'live'");

export const broadcastRepo = {
  create({ title, description, videoPath, mimeType, sizeBytes }) {
    const { lastInsertRowid } = insertStmt.run('vod', 'ended', title, description, videoPath, mimeType, sizeBytes);
    return this.findById(Number(lastInsertRowid));
  },
  createLive({ title, description }) {
    // 폴더명은 id 로 정하므로 일단 빈 값으로 넣고 바로 채워요
    const { lastInsertRowid } = insertStmt.run('live', 'live', title, description, '', HLS_MIME, 0);
    const id = Number(lastInsertRowid);
    setVideoPathStmt.run(String(id), id);
    return this.findById(id);
  },
  /** @returns {boolean} 실제로 방송 중 → 종료로 바뀌었는지 */
  end(id) {
    return endStmt.run(id).changes > 0;
  },
  findLiveRows() {
    return liveRowsStmt.all().map(toBroadcast);
  },
  findAll() {
    return listStmt.all().map(toBroadcast);
  },
  findById(id) {
    return toBroadcast(getStmt.get(id));
  },
};
