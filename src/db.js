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
    video_path   TEXT    NOT NULL,            -- uploadDir 기준 파일명 (영상 위치)
    mime_type    TEXT    NOT NULL,
    size_bytes   INTEGER NOT NULL,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`);

const toBroadcast = (row) =>
  row && {
    id: row.id,
    title: row.title,
    description: row.description,
    videoUrl: `/videos/${encodeURIComponent(row.video_path)}`,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
  };

const insertStmt = db.prepare(`
  INSERT INTO broadcasts (title, description, video_path, mime_type, size_bytes)
  VALUES (?, ?, ?, ?, ?)
`);
const listStmt = db.prepare('SELECT * FROM broadcasts ORDER BY id DESC');
const getStmt = db.prepare('SELECT * FROM broadcasts WHERE id = ?');

export const broadcastRepo = {
  create({ title, description, videoPath, mimeType, sizeBytes }) {
    const { lastInsertRowid } = insertStmt.run(title, description, videoPath, mimeType, sizeBytes);
    return this.findById(Number(lastInsertRowid));
  },
  findAll() {
    return listStmt.all().map(toBroadcast);
  },
  findById(id) {
    return toBroadcast(getStmt.get(id));
  },
};
