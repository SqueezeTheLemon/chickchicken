/** 결제사(토스/모의)가 돌려준 실패. code 는 결제사 에러 코드 그대로 */
export class PaymentError extends Error {
  constructor(code, message, httpStatus = 400) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

/**
 * 결제사 응답을 우리 서비스에서 쓰는 모양으로 통일해요 (토스 Payment 객체 기준)
 * @returns {{ paymentKey: string, orderId: string, status: string, amount: number, method?: string,
 *             approvedAt?: string, metadata: Record<string, string> }}
 */
export const normalizePayment = (p) => ({
  paymentKey: p.paymentKey,
  orderId: p.orderId,
  status: p.status, // READY | IN_PROGRESS | DONE | CANCELED | PARTIAL_CANCELED | ABORTED | EXPIRED ...
  amount: p.totalAmount,
  method: p.method,
  approvedAt: p.approvedAt,
  metadata: p.metadata ?? {},
});
