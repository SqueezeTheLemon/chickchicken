import { execute, query, queryOne } from '../db.js';

export const COMMENT_PAGE_SIZE = 300;

const iso = (d) => (d ? new Date(d).toISOString() : null);
const toComment = (row) =>
  row && {
    id: row.id,
    broadcastId: row.broadcast_id,
    content: row.content,
    author: { id: row.user_id, nickname: row.nickname },
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };

const SELECT = `
  SELECT c.*, u.nickname
  FROM comments c JOIN users u ON u.id = c.user_id`;

export const commentRepo = {
  // 최신 N개를 오래된 순으로 (채팅처럼 아래로 쌓이게)
  async listByBroadcast(broadcastId) {
    const rows = await query(
      `SELECT * FROM (${SELECT} WHERE c.broadcast_id = $1 ORDER BY c.id DESC LIMIT ${COMMENT_PAGE_SIZE}) t ORDER BY id ASC`,
      [broadcastId],
    );
    return rows.map(toComment);
  },
  async findById(id) {
    return toComment(await queryOne(`${SELECT} WHERE c.id = $1`, [id]));
  },
  async create({ broadcastId, userId, content }) {
    const { id } = await queryOne(
      'INSERT INTO comments (broadcast_id, user_id, content) VALUES ($1, $2, $3) RETURNING id',
      [broadcastId, userId, content],
    );
    return this.findById(id);
  },
  async update(id, content) {
    await execute('UPDATE comments SET content = $1, updated_at = now() WHERE id = $2', [content, id]);
    return this.findById(id);
  },
  async delete(id) {
    return (await execute('DELETE FROM comments WHERE id = $1', [id])) > 0;
  },
};
