import { config } from '../config.js';
import { createMockGateway } from './mockGateway.js';
import { createTossGateway } from './tossGateway.js';

function createGateway() {
  if (config.paymentProvider === 'mock') return createMockGateway();
  if (config.paymentProvider !== 'toss') throw new Error(`PAYMENT_PROVIDER 는 toss 또는 mock 이어야 해요 (지금: ${config.paymentProvider})`);

  const { tossClientKey: clientKey, tossSecretKey: secretKey } = config;
  if (!clientKey || !secretKey) throw new Error('토스 결제를 쓰려면 TOSS_CLIENT_KEY 와 TOSS_SECRET_KEY 가 필요해요.');
  // 💡 과제 범위는 테스트 결제뿐 → 실결제(live_) 키로는 아예 시작하지 않아요
  if (!clientKey.startsWith('test_') || !secretKey.startsWith('test_')) {
    throw new Error('테스트 키(test_ 로 시작)만 쓸 수 있어요. 실결제 키는 사용하지 마세요.');
  }
  return createTossGateway({ clientKey, secretKey });
}

/** 앱 전체에서 쓰는 결제 게이트웨이 (toss | mock) — 같은 인터페이스: confirm / getPayment / cancel */
export const paymentGateway = createGateway();
