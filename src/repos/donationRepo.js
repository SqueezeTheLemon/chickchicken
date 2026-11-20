import { db } from '../db.js';

/** 화면·API 로 내보내는 모양 (payment_key 같은 내부 값은 빼요) */
const toDonation = (row) =>
  row && {
    id: row.id,
    orderId: row.order_id,
    broadcastId: row.broadcast_id,
    broadcastTitle: row.broadcast_title,
    streamer: { id: row.streamer_id, nickname: row.streamer_nickname },
    donor: { id: row.donor_id, nickname: row.donor_nickname },
    amount: row.amount,
    message: row.message,
    status: row.status,
    method: row.method,
    failCode: row.fail_code,
    failMessage: row.fail_message,
    createdAt: row.created_at,
    approvedAt: row.approved_at,
  };

const SELECT = `
  SELECT d.*, s.nickname AS streamer_nickname, u.nickname AS donor_nickname
  FROM donations d
  JOIN users s ON s.id = d.streamer_id
  JOIN users u ON u.id = d.donor_id`;

const insertStmt = db.prepare(`
  INSERT INTO donations (order_id, broadcast_id, broadcast_title, streamer_id, donor_id, amount, message, provider)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const byOrderStmt = db.prepare(`${SELECT} WHERE d.order_id = ?`);
const rawByOrderStmt = db.prepare('SELECT * FROM donations WHERE order_id = ?');

// 💡 중복 적립 방지의 핵심: "PENDING 일 때만" DONE 으로 바꿔요.
//    같은 승인 통지가 여러 번 와도 실제로 바뀌는(changes = 1) 건 딱 한 번뿐이에요.
const markDoneStmt = db.prepare(`
  UPDATE donations
  SET status = 'DONE', payment_key = ?, method = ?, approved_at = ?, updated_at = datetime('now')
  WHERE order_id = ? AND status = 'PENDING'
`);
const markFailedStmt = db.prepare(`
  UPDATE donations
  SET status = ?, fail_code = ?, fail_message = ?, updated_at = datetime('now')
  WHERE order_id = ? AND status = 'PENDING'
`);
// 이미 확정된 후원이 결제사에서 취소(환불)된 경우
const markRefundedStmt = db.prepare(`
  UPDATE donations
  SET status = 'CANCELED', fail_code = 'REFUNDED', fail_message = ?, updated_at = datetime('now')
  WHERE order_id = ? AND status = 'DONE'
`);
const listDoneStmt = db.prepare(`${SELECT} WHERE d.broadcast_id = ? AND d.status = 'DONE' ORDER BY d.approved_at DESC, d.id DESC LIMIT 100`);
const summaryStmt = db.prepare(
  "SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count FROM donations WHERE broadcast_id = ? AND status = 'DONE'",
);

export const donationRepo = {
  createPending({ orderId, broadcastId, broadcastTitle, streamerId, donorId, amount, message, provider }) {
    insertStmt.run(orderId, broadcastId, broadcastTitle, streamerId, donorId, amount, message, provider);
    return this.findByOrderId(orderId);
  },
  findByOrderId(orderId) {
    return toDonation(byOrderStmt.get(orderId));
  },
  /** 검증용 원본 행 (payment_key 포함) */
  findRaw(orderId) {
    return rawByOrderStmt.get(orderId);
  },
  /** @returns {boolean} 이번 호출로 처음 확정됐는지 (false = 이미 처리된 중복 통지) */
  markDone(orderId, { paymentKey, method, approvedAt }) {
    return markDoneStmt.run(paymentKey, method ?? null, approvedAt ?? new Date().toISOString(), orderId).changes > 0;
  },
  markFailed(orderId, status, code, message) {
    return markFailedStmt.run(status, code ?? null, message ?? null, orderId).changes > 0;
  },
  markRefunded(orderId, message) {
    return markRefundedStmt.run(message ?? '결제사에서 취소됨', orderId).changes > 0;
  },
  listDoneByBroadcast(broadcastId) {
    return listDoneStmt.all(broadcastId).map(toDonation);
  },
  summaryByBroadcast(broadcastId) {
    const { total, count } = summaryStmt.get(broadcastId);
    return { total: Number(total), count: Number(count) };
  },
};
