import crypto from 'node:crypto';
import { execute, queryOne } from '../db.js';

// 💡 쿠키에는 랜덤 토큰 원문, DB 에는 해시만 저장해요 (DB 가 새어도 세션을 훔칠 수 없게)
// 5단계: 세션이 공용 DB 에 있으니 어느 인스턴스로 요청이 가도 같은 로그인 상태예요 (sticky session 불필요)
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

export const sessionRepo = {
  /** @returns {Promise<string>} 쿠키에 넣을 토큰 원문 */
  async create(userId, ttlHours) {
    const token = crypto.randomBytes(32).toString('base64url');
    await execute(
      "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(hours => $3))",
      [hashToken(token), userId, ttlHours],
    );
    return token;
  },
  async findUser(token) {
    if (!token) return undefined;
    const row = await queryOne(
      `SELECT u.id, u.username, u.nickname
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [hashToken(token)],
    );
    return row && { id: row.id, username: row.username, nickname: row.nickname };
  },
  async delete(token) {
    if (token) await execute('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
  },
  deleteExpired() {
    return execute('DELETE FROM sessions WHERE expires_at <= now()');
  },
};
