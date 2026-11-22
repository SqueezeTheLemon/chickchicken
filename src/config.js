import os from 'node:os';
import path from 'node:path';

// 💡 모든 환경변수는 여기서 한 번만 읽어요. 다른 파일은 config만 import!
// 5단계: DATA_DIR 은 여러 인스턴스가 함께 마운트하는 "공유 볼륨" (업로드 영상, 라이브 HLS)
const DATA_DIR = path.resolve(process.env.DATA_DIR ?? './data');

export const config = {
  port: Number(process.env.PORT ?? 3000),
  // 5단계: 모든 상태(사용자·세션·방송·댓글·후원·라이브 진행 상태)는 공용 PostgreSQL 에
  databaseUrl: process.env.DATABASE_URL || 'postgres://chickchicken:devpassword@localhost:5433/chickchicken',
  dbPoolMax: Number(process.env.DB_POOL_MAX ?? 10),
  // 인스턴스 식별자 (k8s 에선 Pod 이름). 라이브 송출을 어느 인스턴스가 맡았는지 기록할 때 써요
  instanceId: process.env.INSTANCE_ID || process.env.HOSTNAME || os.hostname(),
  // 6단계: 배포 환경 정보
  publicBaseUrl: process.env.PUBLIC_BASE_URL || '', // 예: https://chickchicken.example (상태 확인 응답에 표시)
  gitSha: process.env.GIT_SHA || 'dev', // 배포한 커밋 (deploy/setup-vm.sh 가 넣어요)
  // 리버스 프록시(Caddy) 뒤에서 실행 → X-Forwarded-* 를 믿을 프록시 단계 수
  trustProxy: Number(process.env.TRUST_PROXY ?? 1),
  // 데스크톱 클라이언트 등 다른 출처에서 "공개 조회(GET)"만 허용할 출처 목록 (쉼표 구분, * = 모두)
  corsPublicOrigins: (process.env.CORS_PUBLIC_ORIGINS ?? '*').split(',').map((s) => s.trim()).filter(Boolean),
  dataDir: DATA_DIR,
  uploadDir: path.join(DATA_DIR, 'videos'),
  liveDir: path.join(DATA_DIR, 'live'),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB ?? 500) * 1024 * 1024,

  // 라이브(HLS) 설정
  ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
  hlsSegmentSeconds: Number(process.env.HLS_SEGMENT_SECONDS ?? 2),
  liveConnectTimeoutMs: 30_000, // 방송 생성(또는 송출 끊김) 후 이 시간 안에 송출이 안 붙으면 종료 처리
  liveHeartbeatMs: 3_000, // 송출을 맡은 인스턴스가 "살아 있음"을 DB 에 남기는 주기
  liveClaimStaleMs: 15_000, // 하트비트가 이만큼 끊기면 다른 인스턴스가 송출을 넘겨받을 수 있어요

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
