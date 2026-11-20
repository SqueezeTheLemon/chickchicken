import crypto from 'node:crypto';
import { config } from '../config.js';
import { broadcastRepo, withAdvisoryLock } from '../db.js';
import { PaymentError } from '../payments/errors.js';
import { paymentGateway } from '../payments/index.js';
import { donationRepo } from '../repos/donationRepo.js';

/** 서비스 로직에서 던지는 HTTP 에러 */
const httpError = (status, message, code) => Object.assign(new Error(message), { status, code });

const CANCEL_CODES = new Set(['PAY_PROCESS_CANCELED', 'USER_CANCEL', 'PAYMENT_REQUEST_ABORTED']);

/**
 * 💡 같은 주문을 동시에 처리하지 않게 하는 주문별 잠금 (승인 요청 + 웹훅이 동시에 와도 한 줄로 세워요)
 *    5단계: 인스턴스가 여러 개라 메모리 잠금 대신 Postgres advisory lock 으로 "모든 인스턴스"에서 줄 세워요.
 *    마지막 방어선은 여전히 markDone 의 "WHERE status='PENDING'" 이에요.
 */
const withOrderLock = (orderId, fn) => withAdvisoryLock(`donation:${orderId}`, fn);

const isExpired = (row) => Date.now() - new Date(row.created_at).getTime() > config.donationOrderTtlMinutes * 60_000;

/**
 * 결제사가 "승인됨"이라고 한 결제가 정말 이 주문의 것인지 서버가 대조해요.
 * 화면이 보낸 값이 아니라 결제사 응답(payment)과 DB 주문(row)만 비교해요.
 */
async function verifyPayment(row, payment) {
  const problems = [];
  if (payment.status !== 'DONE') problems.push(`결제 상태가 DONE 이 아님(${payment.status})`);
  if (payment.orderId !== row.order_id) problems.push('주문번호 불일치');
  if (payment.amount !== row.amount) problems.push(`금액 불일치(주문 ${row.amount}, 결제 ${payment.amount})`);
  // 수신 대상: 결제창에 실어 보낸 metadata 의 방송자 == 주문 생성 때 서버가 고정한 방송자
  if (String(payment.metadata?.streamerId) !== String(row.streamer_id)) problems.push('수신 방송자 불일치');
  if (row.broadcast_id && String(payment.metadata?.broadcastId) !== String(row.broadcast_id)) problems.push('방송 불일치');
  // 주문 이후 방송 소유자가 바뀌지 않았는지 (방송이 남아 있다면)
  const broadcast = row.broadcast_id ? await broadcastRepo.findById(row.broadcast_id) : null;
  if (broadcast && broadcast.owner?.id !== row.streamer_id) problems.push('방송 소유자가 주문 때와 다름');
  return problems;
}

/** 승인된 결제를 주문에 확정. 중복 통지면 duplicated: true (적립은 한 번만) */
async function finalize(row, payment, source) {
  const problems = await verifyPayment(row, payment);
  if (problems.length) {
    // 돈은 빠져나갔는데 검증이 안 맞으면 → 결제를 취소하고 주문을 실패 처리
    if (payment.status === 'DONE') {
      await paymentGateway.cancel(payment.paymentKey, `후원 검증 실패: ${problems.join(', ')}`).catch((e) =>
        console.error(`[donation ${row.order_id}] 자동 취소 실패`, e.message),
      );
    }
    await donationRepo.markFailed(row.order_id, 'FAILED', 'VERIFICATION_FAILED', problems.join(', '));
    console.warn(`[donation ${row.order_id}] 검증 실패(${source}): ${problems.join(', ')}`);
    throw httpError(400, `결제 검증에 실패해서 후원을 확정하지 않았어요: ${problems.join(', ')}`, 'VERIFICATION_FAILED');
  }

  let credited;
  try {
    credited = await donationRepo.markDone(row.order_id, {
      paymentKey: payment.paymentKey,
      method: payment.method,
      approvedAt: payment.approvedAt,
    });
  } catch (e) {
    // payment_key UNIQUE 위반 = 이 결제가 이미 다른 주문에 쓰였어요
    if (e.code === '23505') throw httpError(409, '이미 다른 후원에 사용된 결제예요.', 'DUPLICATED_PAYMENT');
    throw e;
  }
  console.log(`[donation ${row.order_id}] ${credited ? `확정 ${row.amount}원 (${source})` : `중복 통지 무시 (${source})`}`);
  return { donation: await donationRepo.findByOrderId(row.order_id), duplicated: !credited };
}

export const donationService = {
  /** 1) 주문 만들기: 수신 대상(방송 소유자)과 금액을 서버가 정해 저장 */
  async createOrder({ broadcastId, donor, amount, message }) {
    const broadcast = await broadcastRepo.findById(broadcastId);
    if (!broadcast) throw httpError(404, '방송을 찾을 수 없어요.');
    if (!broadcast.owner) throw httpError(400, '방송자 정보가 없는 방송이라 후원할 수 없어요.');
    if (broadcast.owner.id === donor.id) throw httpError(400, '내 방송에는 후원할 수 없어요.');
    if (!Number.isInteger(amount) || amount < config.donationMinAmount || amount > config.donationMaxAmount) {
      throw httpError(400, `후원 금액은 ${config.donationMinAmount.toLocaleString()}~${config.donationMaxAmount.toLocaleString()}원 사이 정수로 입력해 주세요.`);
    }
    const text = String(message ?? '').trim();
    if (text.length > 100) throw httpError(400, '후원 메시지는 100자 이하로 입력해 주세요.');

    const orderId = `don_${crypto.randomUUID().replaceAll('-', '')}`; // 토스 규칙: 6~64자 영문·숫자·-_
    await donationRepo.createPending({
      orderId,
      broadcastId: broadcast.id,
      broadcastTitle: broadcast.title,
      streamerId: broadcast.owner.id,
      donorId: donor.id,
      amount,
      message: text,
      provider: paymentGateway.name,
    });

    return {
      provider: paymentGateway.name,
      clientKey: paymentGateway.clientKey,
      orderId,
      amount,
      orderName: `${broadcast.owner.nickname}님 후원`.slice(0, 100),
      customerName: donor.nickname,
      // 결제사 응답에서 그대로 돌아와요 → 승인 때 수신 대상 대조에 써요
      metadata: { broadcastId: String(broadcast.id), streamerId: String(broadcast.owner.id) },
      streamer: broadcast.owner,
    };
  },

  /** 2) 승인 확인: successUrl 로 돌아온 값으로 서버가 결제사에 승인 요청 → 검증 → 확정 */
  async confirm({ orderId, paymentKey, amount, user }) {
    const row = await donationRepo.findRaw(String(orderId ?? ''));
    if (!row) throw httpError(404, '주문을 찾을 수 없어요.');
    if (row.donor_id !== user.id) throw httpError(403, '내 주문만 승인할 수 있어요.');
    if (!paymentKey) throw httpError(400, 'paymentKey 가 필요해요.');

    return withOrderLock(row.order_id, async () => {
      const current = await donationRepo.findRaw(row.order_id);
      // 이미 확정된 주문: 같은 결제의 재통지면 그대로 응답 (새로고침·뒤로가기·중복 클릭)
      if (current.status === 'DONE') {
        if (current.payment_key !== paymentKey) throw httpError(409, '이미 다른 결제로 확정된 주문이에요.', 'ALREADY_DONE');
        return { donation: await donationRepo.findByOrderId(row.order_id), duplicated: true };
      }
      if (current.status !== 'PENDING') throw httpError(409, `이미 ${current.status === 'CANCELED' ? '취소' : '실패'} 처리된 주문이에요.`, current.status);
      if (isExpired(current)) {
        await donationRepo.markFailed(row.order_id, 'FAILED', 'ORDER_EXPIRED', '주문 유효시간이 지났어요.');
        throw httpError(409, '주문 유효시간이 지났어요. 다시 후원해 주세요.', 'ORDER_EXPIRED');
      }
      // 💡 결제사에 요청하기 전에 금액부터 대조 (브라우저가 바꾼 금액으로는 승인 요청조차 안 해요)
      if (Number(amount) !== current.amount) {
        throw httpError(400, `결제 금액(${amount})이 주문 금액(${current.amount})과 달라요.`, 'AMOUNT_MISMATCH');
      }

      let payment;
      try {
        payment = await paymentGateway.confirm({ paymentKey, orderId: current.order_id, amount: current.amount });
      } catch (e) {
        if (!(e instanceof PaymentError)) throw e;
        if (e.code === 'NETWORK_ERROR') throw httpError(502, e.message, e.code); // 일시 오류: 주문은 PENDING 유지 (재시도 가능)
        await donationRepo.markFailed(current.order_id, 'FAILED', e.code, e.message);
        throw httpError(402, `결제 승인에 실패했어요: ${e.message}`, e.code);
      }
      return finalize(current, payment, 'confirm');
    });
  },

  /** 결제창에서 실패·취소로 돌아왔을 때 (failUrl) */
  async reportFailure({ orderId, code, message, user }) {
    const row = await donationRepo.findRaw(String(orderId ?? ''));
    if (!row) throw httpError(404, '주문을 찾을 수 없어요.');
    if (row.donor_id !== user.id) throw httpError(403, '내 주문만 처리할 수 있어요.');
    const status = CANCEL_CODES.has(code) ? 'CANCELED' : 'FAILED';
    await donationRepo.markFailed(row.order_id, status, String(code ?? 'UNKNOWN').slice(0, 64), String(message ?? '').slice(0, 300));
    return await donationRepo.findByOrderId(row.order_id); // 이미 DONE 이면 바뀌지 않아요
  },

  /**
   * 3) 결제사 웹훅 (PAYMENT_STATUS_CHANGED). 같은 통지가 여러 번 와도 안전하게.
   * 💡 본문은 위조될 수 있으니 paymentKey 로 결제사에 다시 조회한 결과만 믿어요.
   */
  async handleWebhook(body) {
    if (body?.eventType !== 'PAYMENT_STATUS_CHANGED') return { result: 'ignored', reason: 'eventType' };
    const paymentKey = body.data?.paymentKey;
    const row = await donationRepo.findRaw(String(body.data?.orderId ?? ''));
    if (!paymentKey || !row) return { result: 'ignored', reason: 'unknown order' };

    let payment;
    try {
      payment = await paymentGateway.getPayment(paymentKey);
    } catch (e) {
      // 결제사에 없는 결제 = 위조·잘못된 통지 → 무시 (200). 네트워크 등 일시 오류만 500 으로 재전송 받아요
      if (e instanceof PaymentError && e.httpStatus < 500 && e.code !== 'NETWORK_ERROR') {
        return { result: 'ignored', reason: `결제사 조회 실패(${e.code})` };
      }
      throw e;
    }
    if (payment.orderId !== row.order_id) return { result: 'ignored', reason: 'orderId mismatch' };

    return withOrderLock(row.order_id, async () => {
      const current = await donationRepo.findRaw(row.order_id);
      if (payment.status === 'DONE') {
        if (current.status !== 'PENDING') return { result: 'duplicate', status: current.status };
        const { duplicated } = await finalize(current, payment, 'webhook');
        return { result: duplicated ? 'duplicate' : 'credited' };
      }
      if (['CANCELED', 'PARTIAL_CANCELED'].includes(payment.status) && current.status === 'DONE') {
        await donationRepo.markRefunded(current.order_id, '결제사에서 결제가 취소됐어요.');
        return { result: 'refunded' };
      }
      if (['CANCELED', 'ABORTED', 'EXPIRED'].includes(payment.status) && current.status === 'PENDING') {
        await donationRepo.markFailed(current.order_id, payment.status === 'CANCELED' ? 'CANCELED' : 'FAILED', payment.status, '결제사 상태 변경');
        return { result: 'closed' };
      }
      return { result: 'noop', status: current.status };
    });
  },
};
