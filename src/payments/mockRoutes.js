import path from 'node:path';
import express, { Router } from 'express';
import { paymentGateway } from './index.js';

/**
 * 모의 결제창 (PAYMENT_PROVIDER=mock 일 때만 등록돼요)
 * 토스 결제창처럼 성공이면 successUrl, 실패·취소면 failUrl 로 돌려보내요.
 */
export const mockPayRouter = Router();

// 같은 사이트 경로만 허용 (//evil.com 같은 외부 이동 방지)
const isLocalPath = (url) => typeof url === 'string' && url.startsWith('/') && !url.startsWith('//');
const withQuery = (url, params) => `${url}${url.includes('?') ? '&' : '?'}${new URLSearchParams(params)}`;

mockPayRouter.get('/mock-pay', (_req, res) => {
  res.sendFile(path.resolve('src/payments/mock-pay.html'));
});

mockPayRouter.post('/mock-pay/api/authorize', express.json({ limit: '10kb' }), (req, res) => {
  const { orderId, orderName, amount, metadata, successUrl, failUrl, outcome } = req.body ?? {};
  if (!isLocalPath(successUrl) || !isLocalPath(failUrl)) return res.status(400).json({ error: 'successUrl/failUrl 은 같은 사이트 경로여야 해요.' });
  if (!orderId || !Number.isInteger(amount) || amount <= 0) return res.status(400).json({ error: '주문 정보가 올바르지 않아요.' });

  // 토스와 같은 규칙: 취소하면 failUrl 에 orderId 가 붙지 않아요 (그래서 failUrl 자체에 orderId 를 넣어 둬요)
  if (outcome === 'cancel') {
    return res.json({ redirect: withQuery(failUrl, { code: 'PAY_PROCESS_CANCELED', message: '사용자에 의해 결제가 취소되었습니다.' }) });
  }
  if (outcome === 'reject') {
    return res.json({ redirect: withQuery(failUrl, { code: 'REJECT_CARD_COMPANY', message: '카드사에서 결제를 거절했어요.(모의)', orderId }) });
  }
  try {
    const paymentKey = paymentGateway.authorize({
      orderId,
      orderName,
      amount,
      metadata: metadata ?? {},
      rejectOnConfirm: outcome === 'confirm-reject',
    });
    res.json({ redirect: withQuery(successUrl, { paymentKey, orderId, amount }) });
  } catch (e) {
    res.json({ redirect: withQuery(failUrl, { code: e.code ?? 'MOCK_ERROR', message: e.message, orderId }) });
  }
});
