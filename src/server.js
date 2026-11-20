import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import { createApp } from './app.js';
import { config } from './config.js';
import { attachIngest } from './live/ingest.js';
import { liveService } from './live/liveService.js';

const app = createApp();
const useHttps = Boolean(config.httpsKeyPath && config.httpsCertPath);
const server = useHttps
  ? https.createServer({ key: fs.readFileSync(config.httpsKeyPath), cert: fs.readFileSync(config.httpsCertPath) }, app)
  : http.createServer(app);

attachIngest(server);
liveService.recoverStaleLives();

server.listen(config.port, () => {
  const scheme = useHttps ? 'https' : 'http';
  console.log(`🐔 chickchicken running → ${scheme}://localhost:${config.port}`);
  // 휴대폰에서 접속할 같은 와이파이 주소도 보여줘요
  for (const nets of Object.values(os.networkInterfaces())) {
    for (const n of nets ?? []) {
      if (n.family === 'IPv4' && !n.internal) console.log(`   LAN → ${scheme}://${n.address}:${config.port}`);
    }
  }
  if (!useHttps) console.log('   ⚠️  휴대폰 카메라는 HTTPS 에서만 동작해요 (README "휴대폰 접속 환경" 참고)');
  console.log(`   data dir: ${config.dataDir}`);
});

// Ctrl+C 시 진행 중인 송출을 마무리(ENDLIST 기록)하고 종료
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    liveService.shutdown();
    setTimeout(() => process.exit(0), 1500).unref();
    server.close(() => process.exit(0));
  });
}
