import crypto from 'node:crypto';
import { execute, queryOne } from '../db.js';
import { normalizePayment, PaymentError } from './errors.js';

/**
 * 로컬 모의 결제사 (토스 키 없이 흐름·중복 처리를 확인하는 용도, 실제 돈 X)
 * 토스 테스트 모드와 같은 규칙을 흉내 내요:
 *   - 결제창 인증(authorize) → paymentKey 발급, 상태 IN_PROGRESS
 *   - 서버 승인(confirm) 때 paymentKey·orderId·amount 가 모두 맞아야 DONE
 *   - 같은 승인을 다시 요청하면(멱등) 첫 결과를 그대로 돌려줘요
 * 💡 5단계: 상태를 메모리 → DB(mock_payments) 로 옮겼어요.
 *    결제창 인증은 인스턴스 A, 승인 요청은 인스턴스 B 로 가도 같은 결제를 봐요.
 */

// DB 행 → 토스 Payment 모양
const toTossShape = (r) => ({
  paymentKey: r.payment_key,
  orderId: r.order_id,
  orderName: r.order_name,
  totalAmount: r.amount,
  status: r.status,
  method: '카드(모의)',
  metadata: r.metadata,
  approvedAt: r.approved_at ? new Date(r.approved_at).toISOString() : null,
});

async function find(paymentKey) {
  const row = await queryOne('SELECT * FROM mock_payments WHERE payment_key = $1', [paymentKey]);
  if (!row) throw new PaymentError('NOT_FOUND_PAYMENT', '존재하지 않는 결제 정보 입니다.', 404);
  return row;
}

export function createMockGateway() {
  return {
    name: 'mock',
    clientKey: 'mock',

    /** 모의 결제창에서 "결제하기"를 눌렀을 때 (= 토스 결제창의 카드 인증 완료) */
    async authorize({ orderId, amount, orderName, metadata, rejectOnConfirm = false }) {
      const paymentKey = `mock_${crypto.randomBytes(12).toString('hex')}`;
      try {
        await execute(
          `INSERT INTO mock_payments (payment_key, order_id, order_name, amount, status, metadata, reject_on_confirm)
           VALUES ($1, $2, $3, $4, 'IN_PROGRESS', $5, $6)`,
          [paymentKey, orderId, orderName ?? '', amount, JSON.stringify(metadata ?? {}), rejectOnConfirm],
        );
      } catch (e) {
        if (e.code === '23505') throw new PaymentError('DUPLICATED_ORDER_ID', '이미 승인 및 취소가 진행된 중복된 주문번호 입니다.');
        throw e;
      }
      return paymentKey;
    },

    async confirm({ paymentKey, orderId, amount }) {
      const p = await find(paymentKey);
      if (p.order_id !== orderId) throw new PaymentError('NOT_FOUND_PAYMENT', '존재하지 않는 결제 정보 입니다.', 404);
      if (p.status === 'DONE') return normalizePayment(toTossShape(p)); // 멱등: 같은 승인 재요청 → 같은 결과
      if (p.status !== 'IN_PROGRESS') throw new PaymentError('ALREADY_PROCESSED_PAYMENT', '이미 처리된 결제 입니다.');
      if (p.amount !== Number(amount)) throw new PaymentError('INVALID_REQUEST', '결제 금액이 인증된 금액과 일치하지 않아요.');
      if (p.reject_on_confirm) {
        await execute("UPDATE mock_payments SET status = 'ABORTED' WHERE payment_key = $1", [paymentKey]);
        throw new PaymentError('REJECT_CARD_PAYMENT', '한도초과 혹은 잔액부족으로 결제에 실패했습니다.(모의)', 403);
      }
      // 동시에 두 번 승인돼도 IN_PROGRESS → DONE 은 한 번만 (나머지는 위의 멱등 응답과 같은 결과를 받아요)
      await execute(
        "UPDATE mock_payments SET status = 'DONE', approved_at = now() WHERE payment_key = $1 AND status = 'IN_PROGRESS'",
        [paymentKey],
      );
      return normalizePayment(toTossShape(await find(paymentKey)));
    },

    async getPayment(paymentKey) {
      return normalizePayment(toTossShape(await find(paymentKey)));
    },

    async cancel(paymentKey, reason) {
      await find(paymentKey);
      await execute("UPDATE mock_payments SET status = 'CANCELED', cancel_reason = $2 WHERE payment_key = $1", [paymentKey, reason]);
      return normalizePayment(toTossShape(await find(paymentKey)));
    },
  };
}
