import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import { createApp } from './app.js';
import { config } from './config.js';
import { initDb, pool } from './db.js';
import { attachIngest } from './live/ingest.js';
import { liveService } from './live/liveService.js';
import { sessionRepo } from './repos/sessionRepo.js';

await initDb(); // 공용 DB 스키마 준비 (여러 인스턴스가 동시에 떠도 advisory lock 으로 한 번씩)

const state = { draining: false }; // 종료 중이면 /readyz 가 503 → 로드밸런서가 새 요청을 안 보내요
const app = createApp(state);
const useHttps = Boolean(config.httpsKeyPath && config.httpsCertPath);
const server = useHttps
  ? https.createServer({ key: fs.readFileSync(config.httpsKeyPath), cert: fs.readFileSync(config.httpsCertPath) }, app)
  : http.createServer(app);

attachIngest(server);
liveService.startBackgroundJobs(); // 라이브 하트비트 + 끊긴 라이브 정리

// 만료된 로그인 세션은 시작할 때와 1시간마다 정리해요
const cleanSessions = () => sessionRepo.deleteExpired().catch((e) => console.error('[session] 정리 실패', e.message));
cleanSessions();
setInterval(cleanSessions, 60 * 60 * 1000).unref();

server.listen(config.port, () => {
  const scheme = useHttps ? 'https' : 'http';
  console.log(`🐔 chickchicken running → ${scheme}://localhost:${config.port}  (instance: ${config.instanceId})`);
  // 휴대폰에서 접속할 같은 와이파이 주소도 보여줘요
  for (const nets of Object.values(os.networkInterfaces())) {
    for (const n of nets ?? []) {
      if (n.family === 'IPv4' && !n.internal) console.log(`   LAN → ${scheme}://${n.address}:${config.port}`);
    }
  }
  if (!useHttps) console.log('   ⚠️  휴대폰 카메라는 HTTPS 에서만 동작해요 (README "휴대폰 접속 환경" 참고)');
  console.log(`   data dir: ${config.dataDir}`);
  console.log(
    config.paymentProvider === 'toss'
      ? '   💳 결제: 토스페이먼츠 테스트 모드'
      : '   💳 결제: 로컬 모의 결제 (토스 테스트 키를 넣으면 토스 테스트 모드로 바뀌어요)',
  );
});

/**
 * 💡 우아한 종료 (스케일 인·재배포 때 k8s 가 SIGTERM 을 보내요)
 *   1) /readyz 를 503 으로 → 새 요청이 다른 인스턴스로
 *   2) 진행 중인 라이브 송출은 "끝내지 않고" 넘겨줘요 (휴대폰이 다른 인스턴스로 재연결)
 *   3) 처리 중인 요청을 마치고 DB 연결을 닫아요
 */
async function shutdown(signal) {
  if (state.draining) return;
  state.draining = true;
  console.log(`[${config.instanceId}] ${signal} → 종료 준비 (송출 ${liveService.localSessionCount()}개 넘겨주기)`);
  setTimeout(() => process.exit(0), 20_000).unref(); // 최악의 경우에도 20초 안에 종료
  await liveService.shutdown().catch((e) => console.error('[live] shutdown', e.message));
  server.close(() => pool.end().finally(() => process.exit(0)));
  server.closeIdleConnections?.();
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => shutdown(signal));
