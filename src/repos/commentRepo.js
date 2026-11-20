import { db } from '../db.js';

export const COMMENT_PAGE_SIZE = 300;

const toComment = (row) =>
  row && {
    id: row.id,
    broadcastId: row.broadcast_id,
    content: row.content,
    author: { id: row.user_id, nickname: row.nickname },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

const SELECT = `
  SELECT c.*, u.nickname
  FROM comments c JOIN users u ON u.id = c.user_id`;

// 최신 N개를 오래된 순으로 (채팅처럼 아래로 쌓이게)
const listStmt = db.prepare(`
  SELECT * FROM (${SELECT} WHERE c.broadcast_id = ? ORDER BY c.id DESC LIMIT ${COMMENT_PAGE_SIZE})
  ORDER BY id ASC
`);
const getStmt = db.prepare(`${SELECT} WHERE c.id = ?`);
const insertStmt = db.prepare('INSERT INTO comments (broadcast_id, user_id, content) VALUES (?, ?, ?)');
const updateStmt = db.prepare("UPDATE comments SET content = ?, updated_at = datetime('now') WHERE id = ?");
const deleteStmt = db.prepare('DELETE FROM comments WHERE id = ?');

export const commentRepo = {
  listByBroadcast(broadcastId) {
    return listStmt.all(broadcastId).map(toComment);
  },
  findById(id) {
    return toComment(getStmt.get(id));
  },
  create({ broadcastId, userId, content }) {
    const { lastInsertRowid } = insertStmt.run(broadcastId, userId, content);
    return this.findById(Number(lastInsertRowid));
  },
  update(id, content) {
    updateStmt.run(content, id);
    return this.findById(id);
  },
  delete(id) {
    return deleteStmt.run(id).changes > 0;
  },
};
