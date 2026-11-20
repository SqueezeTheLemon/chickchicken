import path from 'node:path';

// 💡 모든 환경변수는 여기서 한 번만 읽어요. 다른 파일은 config만 import!
const DATA_DIR = path.resolve(process.env.DATA_DIR ?? './data');

export const config = {
  port: Number(process.env.PORT ?? 3000),
  dataDir: DATA_DIR,
  dbPath: path.join(DATA_DIR, 'chickchicken.db'),
  uploadDir: path.join(DATA_DIR, 'videos'),
  liveDir: path.join(DATA_DIR, 'live'),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB ?? 500) * 1024 * 1024,

  // 라이브(HLS) 설정
  ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
  hlsSegmentSeconds: Number(process.env.HLS_SEGMENT_SECONDS ?? 2),
  liveConnectTimeoutMs: 30_000, // 방송 생성 후 이 시간 안에 송출이 안 붙으면 종료 처리

  // 휴대폰 카메라(getUserMedia)는 HTTPS에서만 동작 → 인증서 경로를 주면 HTTPS로 떠요
  httpsKeyPath: process.env.HTTPS_KEY_PATH || '',
  httpsCertPath: process.env.HTTPS_CERT_PATH || '',

  // 3단계: 로그인 세션
  sessionCookieName: 'cc_session',
  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS ?? 24 * 7),
  // HTTPS 로 서비스할 때 true (HTTPS_KEY_PATH 를 쓰면 자동으로 켜져요). 터널(https) 뒤라면 직접 true 로
  cookieSecure:
    process.env.COOKIE_SECURE === 'true' || Boolean(process.env.HTTPS_KEY_PATH && process.env.HTTPS_CERT_PATH),

  // 4단계: 도네이션 결제
  // toss = 토스페이먼츠 테스트 모드, mock = 로컬 모의 결제 (토스 키가 없으면 mock 이 기본)
  paymentProvider: process.env.PAYMENT_PROVIDER || (process.env.TOSS_SECRET_KEY ? 'toss' : 'mock'),
  tossClientKey: process.env.TOSS_CLIENT_KEY || '',
  tossSecretKey: process.env.TOSS_SECRET_KEY || '',
  donationMinAmount: 1000,
  donationMaxAmount: 1_000_000,
  donationOrderTtlMinutes: 30, // 이 시간이 지난 미결제 주문은 승인하지 않아요
};
