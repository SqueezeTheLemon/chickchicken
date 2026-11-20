import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

// 💡 Node 22.13+ 내장 SQLite → 별도 DB 서버 없이 파일 하나로 영속화돼요.
fs.mkdirSync(config.dataDir, { recursive: true });

export const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA foreign_keys = ON'); // 방송 삭제 시 댓글도 함께 지우려면(ON DELETE CASCADE) 필요해요

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    username       TEXT    NOT NULL UNIQUE COLLATE NOCASE,  -- 로그인 아이디 (대소문자 구분 없이 유일)
    nickname       TEXT    NOT NULL,                        -- 화면에 보이는 이름
    password_hash  TEXT    NOT NULL,                        -- scrypt 해시 (평문 저장 X)
    created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash  TEXT    PRIMARY KEY,                        -- 쿠키 토큰의 SHA-256 (DB 가 유출돼도 토큰은 모름)
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at  TEXT    NOT NULL,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS broadcasts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    title        TEXT    NOT NULL,
    description  TEXT    NOT NULL DEFAULT '',
    video_path   TEXT    NOT NULL,            -- vod: uploadDir 기준 파일명 / live: liveDir 기준 폴더명
    mime_type    TEXT    NOT NULL,
    size_bytes   INTEGER NOT NULL,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS comments (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    broadcast_id  INTEGER NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content       TEXT    NOT NULL,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_comments_broadcast ON comments (broadcast_id, id);
`);

// 💡 마이그레이션: 이전 단계 DB 파일에는 아래 칼럼이 없어서, 없을 때만 ALTER 로 추가해요
const columns = new Set(db.prepare('PRAGMA table_info(broadcasts)').all().map((c) => c.name));
const addColumn = (name, ddl) => !columns.has(name) && db.exec(`ALTER TABLE broadcasts ADD COLUMN ${ddl}`);
addColumn('kind', "kind TEXT NOT NULL DEFAULT 'vod'"); // vod | live
addColumn('status', "status TEXT NOT NULL DEFAULT 'ended'"); // live(방송 중) | ended(종료)
addColumn('ended_at', 'ended_at TEXT');
// 3단계: 소유자. 1·2단계에 만든 방송은 소유자가 없어(NULL) 아무도 수정·삭제할 수 없어요
addColumn('owner_id', 'owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL');

export const HLS_MIME = 'application/vnd.apple.mpegurl';

const toBroadcast = (row) =>
  row && {
    id: row.id,
    kind: row.kind,
    status: row.status,
    title: row.title,
    description: row.description,
    owner: row.owner_id ? { id: row.owner_id, nickname: row.owner_nickname } : null,
    videoUrl:
      row.kind === 'live'
        ? `/hls/${encodeURIComponent(row.video_path)}/index.m3u8`
        : `/videos/${encodeURIComponent(row.video_path)}`,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
    endedAt: row.ended_at,
  };

const SELECT_WITH_OWNER = `
  SELECT b.*, u.nickname AS owner_nickname
  FROM broadcasts b LEFT JOIN users u ON u.id = b.owner_id`;

const insertStmt = db.prepare(`
  INSERT INTO broadcasts (kind, status, title, description, video_path, mime_type, size_bytes, owner_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
// 방송 중인 라이브를 맨 위로
const listStmt = db.prepare(`${SELECT_WITH_OWNER} ORDER BY b.status = 'live' DESC, b.id DESC`);
const getStmt = db.prepare(`${SELECT_WITH_OWNER} WHERE b.id = ?`);
const getRawStmt = db.prepare('SELECT * FROM broadcasts WHERE id = ?');
const setVideoPathStmt = db.prepare('UPDATE broadcasts SET video_path = ? WHERE id = ?');
const updateStmt = db.prepare('UPDATE broadcasts SET title = ?, description = ? WHERE id = ?');
const deleteStmt = db.prepare('DELETE FROM broadcasts WHERE id = ?');
const endStmt = db.prepare(
  "UPDATE broadcasts SET status = 'ended', ended_at = datetime('now') WHERE id = ? AND status = 'live'",
);
const liveRowsStmt = db.prepare("SELECT * FROM broadcasts WHERE status = 'live'");

export const broadcastRepo = {
  create({ title, description, videoPath, mimeType, sizeBytes, ownerId }) {
    const { lastInsertRowid } = insertStmt.run('vod', 'ended', title, description, videoPath, mimeType, sizeBytes, ownerId);
    return this.findById(Number(lastInsertRowid));
  },
  createLive({ title, description, ownerId }) {
    // 폴더명은 id 로 정하므로 일단 빈 값으로 넣고 바로 채워요
    const { lastInsertRowid } = insertStmt.run('live', 'live', title, description, '', HLS_MIME, 0, ownerId);
    const id = Number(lastInsertRowid);
    setVideoPathStmt.run(String(id), id);
    return this.findById(id);
  },
  update(id, { title, description }) {
    updateStmt.run(title, description, id);
    return this.findById(id);
  },
  delete(id) {
    return deleteStmt.run(id).changes > 0;
  },
  /** 파일 정리용: 응답에는 내보내지 않는 실제 저장 경로(video_path)까지 담긴 원본 행 */
  findRawById(id) {
    return getRawStmt.get(id);
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
