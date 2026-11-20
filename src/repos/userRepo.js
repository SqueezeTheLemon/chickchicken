import { queryOne } from '../db.js';

const toUser = (row) =>
  row && { id: row.id, username: row.username, nickname: row.nickname, createdAt: new Date(row.created_at).toISOString() };

export const userRepo = {
  async create({ username, nickname, passwordHash }) {
    const row = await queryOne(
      'INSERT INTO users (username, nickname, password_hash) VALUES ($1, $2, $3) RETURNING *',
      [username, nickname, passwordHash],
    );
    return toUser(row);
  },
  /** 로그인 검증용: password_hash 까지 담긴 원본 행 (응답으로 내보내지 않기!) */
  findCredentials(username) {
    return queryOne('SELECT * FROM users WHERE lower(username) = lower($1)', [username]);
  },
  async existsByUsername(username) {
    return Boolean(await this.findCredentials(username));
  },
  async findById(id) {
    return toUser(await queryOne('SELECT * FROM users WHERE id = $1', [id]));
  },
};
