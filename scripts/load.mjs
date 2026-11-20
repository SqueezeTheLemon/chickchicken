#!/usr/bin/env node
/**
 * 부하 발생기 (외부 도구 없이 Node 만으로)
 *   node scripts/load.mjs --duration 180 --concurrency 60
 *   옵션: --url http://localhost:8080  --duration 초  --concurrency 동시 작업자 수
 *
 * 실제 시청자처럼 섞어서 요청해요:
 *   60% 방송 목록 · 20% 댓글 목록 · 20% 로그인(비밀번호 해시 계산 → CPU 를 많이 써요)
 * 💡 요청마다 새 연결(keep-alive 끔)로 보내서 Service 가 여러 Pod 로 골고루 나눠요.
 *    5초마다 처리량과 "어느 Pod 가 몇 개 처리했는지(X-Instance)"를 보여줘요.
 */
import http from 'node:http';
import crypto from 'node:crypto';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1]]] : acc), []),
);
const BASE = new URL(args.url ?? process.env.BASE_URL ?? 'http://localhost:8080');
const DURATION = Number(args.duration ?? 120) * 1000;
const CONCURRENCY = Number(args.concurrency ?? 50);
const agent = new http.Agent({ keepAlive: false });

function request(method, path, body) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      { host: BASE.hostname, port: BASE.port || 80, path, method, agent, timeout: 15_000,
        headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} },
      (res) => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode, instance: res.headers['x-instance'] ?? '?' }));
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => resolve({ status: 0, error: e.message }));
    if (data) req.write(data);
    req.end();
  });
}

// ---- 준비: 부하용 계정과 방송 id ----
const user = { username: `load_${crypto.randomBytes(3).toString('hex')}`, nickname: '부하테스트', password: 'loadtest123' };
const su = await request('POST', '/api/auth/signup', user);
if (su.status !== 201) {
  console.error(`✘ 서버(${BASE.origin}) 준비 실패 (signup ${su.status} ${su.error ?? ''})`);
  process.exit(1);
}
const list = await fetch(new URL('/api/broadcasts', BASE)).then((r) => r.json()).catch(() => []);
const broadcastId = list[0]?.id;

const scenarios = [
  [0.6, () => request('GET', '/api/broadcasts')],
  [0.2, () => (broadcastId ? request('GET', `/api/broadcasts/${broadcastId}/comments`) : request('GET', '/api/broadcasts'))],
  [0.2, () => request('POST', '/api/auth/login', { username: user.username, password: user.password })],
];
const pick = () => {
  let r = Math.random();
  for (const [w, fn] of scenarios) if ((r -= w) <= 0) return fn;
  return scenarios[0][1];
};

// ---- 실행 ----
const stats = { ok: 0, err: 0, byInstance: new Map(), latency: [] };
const total = { ok: 0, err: 0, instances: new Set() };
const end = Date.now() + DURATION;
console.log(`🔥 부하 시작: ${BASE.origin}  동시 ${CONCURRENCY}  ${DURATION / 1000}초`);

async function worker() {
  while (Date.now() < end) {
    const t0 = performance.now();
    const r = await pick()();
    const ms = performance.now() - t0;
    if (r.status >= 200 && r.status < 400) {
      stats.ok++;
      total.ok++;
      stats.latency.push(ms);
      stats.byInstance.set(r.instance, (stats.byInstance.get(r.instance) ?? 0) + 1);
      total.instances.add(r.instance);
    } else {
      stats.err++;
      total.err++;
    }
  }
}

const t = setInterval(() => {
  const lat = stats.latency.sort((a, b) => a - b);
  const p95 = lat.length ? lat[Math.floor(lat.length * 0.95)].toFixed(0) : '-';
  const pods = [...stats.byInstance.entries()]
    .sort()
    .map(([k, v]) => `${k.slice(-5)}:${v}`)
    .join(' ');
  console.log(
    `${new Date().toTimeString().slice(0, 8)}  ${(stats.ok / 5).toFixed(0).padStart(4)} req/s  err ${stats.err}  p95 ${p95}ms  Pod ${stats.byInstance.size}개 → ${pods}`,
  );
  stats.ok = 0;
  stats.err = 0;
  stats.latency = [];
  stats.byInstance.clear();
}, 5000);

await Promise.all(Array.from({ length: CONCURRENCY }, worker));
clearInterval(t);
console.log(`\n✅ 끝: 성공 ${total.ok} · 실패 ${total.err} · 응답한 Pod ${total.instances.size}개 (${[...total.instances].join(', ')})`);
