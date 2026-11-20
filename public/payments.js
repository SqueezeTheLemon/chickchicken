// 💡 결제창 띄우기: 서버가 만든 주문(order)대로 토스 결제창 또는 모의 결제창을 열어요.
//    여기서 "성공"을 판단하지 않아요. 결제창은 successUrl 로 돌아가고, 확정은 서버가 해요.

const TOSS_SDK = 'https://js.tosspayments.com/v2/standard';

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = Object.assign(document.createElement('script'), { src, onload: resolve, onerror: () => reject(new Error('결제 모듈을 불러오지 못했어요.')) });
    document.head.append(s);
  });
}

/** @param {{ provider: string, clientKey: string, orderId: string, amount: number, orderName: string, customerName: string, metadata: object }} order */
export async function openPaymentWindow(order) {
  // 토스는 취소 시 failUrl 에 orderId 를 안 붙여줘요 → failUrl 자체에 넣어 둬요
  const successPath = '/donate/success';
  const failPath = `/donate/fail?orderId=${encodeURIComponent(order.orderId)}`;

  if (order.provider === 'mock') {
    const q = new URLSearchParams({
      orderId: order.orderId,
      orderName: order.orderName,
      amount: String(order.amount),
      metadata: JSON.stringify(order.metadata),
      successUrl: successPath,
      failUrl: failPath,
    });
    location.href = `/mock-pay?${q}`;
    return;
  }

  await loadScript(TOSS_SDK);
  const tossPayments = window.TossPayments(order.clientKey);
  const payment = tossPayments.payment({ customerKey: window.TossPayments.ANONYMOUS });
  // 리다이렉트 방식: 성공 → successUrl?paymentKey&orderId&amount, 실패·취소 → failUrl?code&message
  await payment.requestPayment({
    method: 'CARD',
    amount: { currency: 'KRW', value: order.amount },
    orderId: order.orderId,
    orderName: order.orderName,
    customerName: order.customerName,
    successUrl: location.origin + successPath,
    failUrl: location.origin + failPath,
    metadata: order.metadata,
  });
}
