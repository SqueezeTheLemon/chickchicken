import { execute, query, queryOne } from '../db.js';

const iso = (d) => (d ? new Date(d).toISOString() : null);

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
    createdAt: iso(row.created_at),
    approvedAt: iso(row.approved_at),
  };

const SELECT = `
  SELECT d.*, s.nickname AS streamer_nickname, u.nickname AS donor_nickname
  FROM donations d
  JOIN users s ON s.id = d.streamer_id
  JOIN users u ON u.id = d.donor_id`;

export const donationRepo = {
  async createPending({ orderId, broadcastId, broadcastTitle, streamerId, donorId, amount, message, provider }) {
    await execute(
      `INSERT INTO donations (order_id, broadcast_id, broadcast_title, streamer_id, donor_id, amount, message, provider)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [orderId, broadcastId, broadcastTitle, streamerId, donorId, amount, message, provider],
    );
    return this.findByOrderId(orderId);
  },
  async findByOrderId(orderId) {
    return toDonation(await queryOne(`${SELECT} WHERE d.order_id = $1`, [orderId]));
  },
  /** 검증용 원본 행 (payment_key 포함) */
  findRaw(orderId) {
    return queryOne('SELECT * FROM donations WHERE order_id = $1', [orderId]);
  },
  /**
   * 💡 중복 적립 방지의 핵심: "PENDING 일 때만" DONE 으로 바꿔요.
   *    같은 승인 통지가 여러 번, 여러 인스턴스로 와도 실제로 바뀌는(rowCount = 1) 건 딱 한 번뿐이에요.
   * @returns {Promise<boolean>} 이번 호출로 처음 확정됐는지
   */
  async markDone(orderId, { paymentKey, method, approvedAt }) {
    const n = await execute(
      `UPDATE donations SET status = 'DONE', payment_key = $1, method = $2, approved_at = $3, updated_at = now()
       WHERE order_id = $4 AND status = 'PENDING'`,
      [paymentKey, method ?? null, approvedAt ?? new Date().toISOString(), orderId],
    );
    return n > 0;
  },
  async markFailed(orderId, status, code, message) {
    const n = await execute(
      `UPDATE donations SET status = $1, fail_code = $2, fail_message = $3, updated_at = now()
       WHERE order_id = $4 AND status = 'PENDING'`,
      [status, code ?? null, message ?? null, orderId],
    );
    return n > 0;
  },
  /** 이미 확정된 후원이 결제사에서 취소(환불)된 경우 */
  async markRefunded(orderId, message) {
    const n = await execute(
      `UPDATE donations SET status = 'CANCELED', fail_code = 'REFUNDED', fail_message = $1, updated_at = now()
       WHERE order_id = $2 AND status = 'DONE'`,
      [message ?? '결제사에서 취소됨', orderId],
    );
    return n > 0;
  },
  async listDoneByBroadcast(broadcastId) {
    const rows = await query(
      `${SELECT} WHERE d.broadcast_id = $1 AND d.status = 'DONE' ORDER BY d.approved_at DESC, d.id DESC LIMIT 100`,
      [broadcastId],
    );
    return rows.map(toDonation);
  },
  async summaryByBroadcast(broadcastId) {
    const row = await queryOne(
      "SELECT COALESCE(SUM(amount), 0)::int AS total, COUNT(*)::int AS count FROM donations WHERE broadcast_id = $1 AND status = 'DONE'",
      [broadcastId],
    );
    return { total: row.total, count: row.count };
  },
};
