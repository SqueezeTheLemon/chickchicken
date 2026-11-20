import express, { Router } from 'express';
import { asyncHandler } from '../asyncHandler.js';
import { requireAuth } from '../auth/middleware.js';
import { broadcastRepo } from '../db.js';
import { donationService } from '../donations/donationService.js';
import { paymentGateway } from '../payments/index.js';
import { donationRepo } from '../repos/donationRepo.js';

export const donationsRouter = Router();
donationsRouter.use(express.json({ limit: '20kb' }));

// 결제창 초기화 정보 (클라이언트 키만 공개, 시크릿 키는 절대 X)
donationsRouter.get('/payments/config', (_req, res) => {
  res.json({ provider: paymentGateway.name, clientKey: paymentGateway.clientKey });
});

// 공개: 방송별 후원 내역(확정된 것만)과 합계
donationsRouter.get('/broadcasts/:id/donations', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || !broadcastRepo.findById(id)) return res.status(404).json({ error: '방송을 찾을 수 없어요.' });
  const donations = donationRepo.listDoneByBroadcast(id).map(({ id: did, donor, amount, message, approvedAt }) => ({
    id: did,
    donor,
    amount,
    message,
    approvedAt,
  }));
  res.json({ ...donationRepo.summaryByBroadcast(id), donations });
});

// 로그인 필요: 후원 주문 만들기 → 결제창에 넘길 정보
donationsRouter.post('/broadcasts/:id/donations', requireAuth, (req, res) => {
  const order = donationService.createOrder({
    broadcastId: Number(req.params.id),
    donor: req.user,
    amount: Number(req.body?.amount),
    message: req.body?.message,
  });
  res.status(201).json(order);
});

// 로그인 필요(주문자): 결제 승인 확인 → 서버 검증 후 확정
donationsRouter.post(
  '/donations/confirm',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { orderId, paymentKey, amount } = req.body ?? {};
    res.json(await donationService.confirm({ orderId, paymentKey, amount, user: req.user }));
  }),
);

// 로그인 필요(주문자): 결제창 실패·취소 보고
donationsRouter.post('/donations/:orderId/fail', requireAuth, (req, res) => {
  res.json(donationService.reportFailure({ orderId: req.params.orderId, code: req.body?.code, message: req.body?.message, user: req.user }));
});

// 로그인 필요(주문자): 내 주문 상태 조회
donationsRouter.get('/donations/:orderId', requireAuth, (req, res) => {
  const donation = donationRepo.findByOrderId(req.params.orderId);
  if (!donation || donation.donor.id !== req.user.id) return res.status(404).json({ error: '주문을 찾을 수 없어요.' });
  res.json(donation);
});

// 결제사 웹훅 (로그인 없음 — 대신 본문을 믿지 않고 결제사에 재조회해요)
donationsRouter.post(
  '/payments/webhook',
  asyncHandler(async (req, res) => {
    try {
      const result = await donationService.handleWebhook(req.body);
      res.json(result);
    } catch (e) {
      // 검증 실패처럼 "다시 보내도 결과가 같은" 오류는 200 으로 받아 재전송을 멈춰요
      if (e.status && e.status < 500) return res.json({ result: 'rejected', reason: e.message });
      throw e; // 결제사 조회 실패 등 일시 오류 → 500 → 결제사가 나중에 재전송
    }
  }),
);
