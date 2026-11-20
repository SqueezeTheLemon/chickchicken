import { db } from '../db.js';

const toUser = (row) => row && { id: row.id, username: row.username, nickname: row.nickname, createdAt: row.created_at };

const insertStmt = db.prepare('INSERT INTO users (username, nickname, password_hash) VALUES (?, ?, ?)');
const byUsernameStmt = db.prepare('SELECT * FROM users WHERE username = ?');
const byIdStmt = db.prepare('SELECT * FROM users WHERE id = ?');

export const userRepo = {
  create({ username, nickname, passwordHash }) {
    const { lastInsertRowid } = insertStmt.run(username, nickname, passwordHash);
    return this.findById(Number(lastInsertRowid));
  },
  /** 로그인 검증용: password_hash 까지 담긴 원본 행 (응답으로 내보내지 않기!) */
  findCredentials(username) {
    return byUsernameStmt.get(username);
  },
  existsByUsername(username) {
    return Boolean(byUsernameStmt.get(username));
  },
  findById(id) {
    return toUser(byIdStmt.get(id));
  },
};
