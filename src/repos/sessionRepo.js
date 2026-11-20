import crypto from 'node:crypto';
import { db } from '../db.js';

// 💡 쿠키에는 랜덤 토큰 원문, DB 에는 해시만 저장해요 (DB 가 새어도 세션을 훔칠 수 없게)
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

const insertStmt = db.prepare(
  "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, datetime('now', ?))",
);
const findUserStmt = db.prepare(`
  SELECT u.id, u.username, u.nickname
  FROM sessions s JOIN users u ON u.id = s.user_id
  WHERE s.token_hash = ? AND s.expires_at > datetime('now')
`);
const deleteStmt = db.prepare('DELETE FROM sessions WHERE token_hash = ?');
const deleteExpiredStmt = db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')");

export const sessionRepo = {
  /** @returns {string} 쿠키에 넣을 토큰 원문 */
  create(userId, ttlHours) {
    const token = crypto.randomBytes(32).toString('base64url');
    insertStmt.run(hashToken(token), userId, `+${ttlHours} hours`);
    return token;
  },
  findUser(token) {
    if (!token) return undefined;
    const row = findUserStmt.get(hashToken(token));
    return row && { id: row.id, username: row.username, nickname: row.nickname };
  },
  delete(token) {
    if (token) deleteStmt.run(hashToken(token));
  },
  deleteExpired() {
    return deleteExpiredStmt.run().changes;
  },
};
