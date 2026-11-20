import { normalizePayment, PaymentError } from './errors.js';

const API = 'https://api.tosspayments.com/v1';

/**
 * 토스페이먼츠 API 개별 연동 (결제창 v2) — 테스트 키(test_ck / test_sk) 전용
 * 💡 시크릿 키는 서버에만 있어요. 브라우저에는 클라이언트 키만 내려가요.
 */
export function createTossGateway({ clientKey, secretKey }) {
  // Basic 인증: "시크릿키:" 를 base64 (콜론 필수)
  const authorization = `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`;

  async function call(method, path, body, idempotencyKey) {
    const headers = { Authorization: authorization };
    if (body) headers['Content-Type'] = 'application/json';
    // 같은 키로 다시 요청하면 토스가 첫 응답을 그대로 돌려줘요 → 네트워크 재시도해도 이중 승인 없음
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

    let res;
    try {
      res = await fetch(`${API}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      throw new PaymentError('NETWORK_ERROR', `결제사에 연결하지 못했어요: ${e.message}`, 502);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new PaymentError(data.code ?? `HTTP_${res.status}`, data.message ?? '결제사 오류', res.status);
    return normalizePayment(data);
  }

  return {
    name: 'toss',
    clientKey,
    /** 결제 승인 (successUrl 로 돌아온 뒤 10분 안에 호출해야 해요) */
    confirm: ({ paymentKey, orderId, amount }) =>
      call('POST', '/payments/confirm', { paymentKey, orderId, amount }, `confirm-${orderId}`),
    /** 결제 조회 — 웹훅 본문 대신 이걸로 실제 상태를 확인해요 */
    getPayment: (paymentKey) => call('GET', `/payments/${encodeURIComponent(paymentKey)}`),
    /** 검증 실패 등으로 승인된 결제를 되돌릴 때 */
    cancel: (paymentKey, reason) =>
      call('POST', `/payments/${encodeURIComponent(paymentKey)}/cancel`, { cancelReason: reason.slice(0, 200) }, `cancel-${paymentKey}`),
  };
}
