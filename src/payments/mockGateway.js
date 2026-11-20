import crypto from 'node:crypto';
import { normalizePayment, PaymentError } from './errors.js';

/**
 * 로컬 모의 결제사 (토스 키 없이 흐름·중복 처리를 확인하는 용도, 실제 돈 X)
 * 토스 테스트 모드와 같은 규칙을 흉내 내요:
 *   - 결제창 인증(approve) → paymentKey 발급, 상태 IN_PROGRESS
 *   - 서버 승인(confirm) 때 paymentKey·orderId·amount 가 모두 맞아야 DONE
 *   - 같은 승인을 다시 요청하면(멱등) 첫 결과를 그대로 돌려줘요
 * 💡 상태는 메모리에만 있어서 서버를 재시작하면 사라져요 (모의용이라 괜찮아요)
 */
export function createMockGateway() {
  /** @type {Map<string, any>} paymentKey → 토스 Payment 모양 객체 */
  const payments = new Map();
  const byOrder = new Map(); // orderId → paymentKey

  const find = (paymentKey) => {
    const p = payments.get(paymentKey);
    if (!p) throw new PaymentError('NOT_FOUND_PAYMENT', '존재하지 않는 결제 정보 입니다.', 404);
    return p;
  };

  return {
    name: 'mock',
    clientKey: 'mock',

    /** 모의 결제창에서 "결제하기"를 눌렀을 때 (= 토스 결제창의 카드 인증 완료) */
    authorize({ orderId, amount, orderName, metadata, rejectOnConfirm = false }) {
      if (byOrder.has(orderId)) throw new PaymentError('DUPLICATED_ORDER_ID', '이미 승인 및 취소가 진행된 중복된 주문번호 입니다.');
      const paymentKey = `mock_${crypto.randomBytes(12).toString('hex')}`;
      payments.set(paymentKey, {
        paymentKey,
        orderId,
        orderName,
        totalAmount: amount,
        status: 'IN_PROGRESS',
        method: '카드(모의)',
        metadata,
        requestedAt: new Date().toISOString(),
        approvedAt: null,
        rejectOnConfirm, // "승인 단계 거절" 시나리오용 (토스의 TossPayments-Test-Code 헤더 역할)
      });
      byOrder.set(orderId, paymentKey);
      return paymentKey;
    },

    async confirm({ paymentKey, orderId, amount }) {
      const p = find(paymentKey);
      if (p.orderId !== orderId) throw new PaymentError('NOT_FOUND_PAYMENT', '존재하지 않는 결제 정보 입니다.', 404);
      if (p.status === 'DONE') return normalizePayment(p); // 멱등: 같은 승인 재요청 → 같은 결과
      if (p.status !== 'IN_PROGRESS') throw new PaymentError('ALREADY_PROCESSED_PAYMENT', '이미 처리된 결제 입니다.');
      if (p.totalAmount !== Number(amount)) {
        throw new PaymentError('INVALID_REQUEST', '결제 금액이 인증된 금액과 일치하지 않아요.');
      }
      if (p.rejectOnConfirm) {
        p.status = 'ABORTED';
        throw new PaymentError('REJECT_CARD_PAYMENT', '한도초과 혹은 잔액부족으로 결제에 실패했습니다.(모의)', 403);
      }
      p.status = 'DONE';
      p.approvedAt = new Date().toISOString();
      return normalizePayment(p);
    },

    async getPayment(paymentKey) {
      return normalizePayment(find(paymentKey));
    },

    async cancel(paymentKey, reason) {
      const p = find(paymentKey);
      p.status = 'CANCELED';
      p.cancelReason = reason;
      return normalizePayment(p);
    },
  };
}
