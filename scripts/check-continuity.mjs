#!/usr/bin/env node
/**
 * 스케일이 바뀌는 동안 상태가 유지되는지 확인해요 (부하와 동시에 실행)
 *   node scripts/check-continuity.mjs --duration 300
 *
 * 처음에 한 번: 가입(로그인) → 방송 등록 → 댓글 작성 → 후원(모의 결제) 확정
 * 그다음 3초마다 "새 연결"로 (= 매번 다른 Pod 로 갈 수 있게) 확인:
 *   - 같은 쿠키로 /api/auth/me → 여전히 로그인 상태인지
 *   - 방송 목록에 내 방송이 있는지 / 내 댓글 수가 그대로인지 / 후원 합계가 그대로인지
 *   - 업로드한 영상 파일을 받을 수 있는지 (공유 볼륨)
 * 처음 보는 Pod 가 응답하면 "🆕" 로 표시해요 → 스케일 아웃된 새 Pod 도 같은 상태를 보는지 확인
 */
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1]]] : acc), []),
);
const BASE = new URL(args.url ?? process.env.BASE_URL ?? 'http://localhost:8080');
const DURATION = Number(args.duration ?? 300) * 1000;
const agent = new http.Agent({ keepAlive: false });
let cookie = '';

function req(method, p, { json, raw, headers = {} } = {}) {
  return new Promise((resolve) => {
    const body = json ? JSON.stringify(json) : raw;
    const h = { ...headers, ...(cookie ? { Cookie: cookie } : {}) };
    if (json) h['Content-Type'] = 'application/json';
    if (body) h['Content-Length'] = Buffer.byteLength(body);
    const r = http.request({ host: BASE.hostname, port: BASE.port || 80, path: p, method, agent, headers: h, timeout: 10_000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        for (const c of res.headers['set-cookie'] ?? []) if (c.startsWith('cc_session=')) cookie = c.split(';')[0];
        const text = Buffer.concat(chunks).toString();
        let data;
        try { data = JSON.parse(text); } catch { data = text; }
        resolve({ status: res.statusCode, data, instance: res.headers['x-instance'] ?? '?', bytes: Buffer.concat(chunks).length });
      });
    });
    r.on('timeout', () => r.destroy(new Error('timeout')));
    r.on('error', (e) => resolve({ status: 0, error: e.message, instance: '-' }));
    if (body) r.write(body);
    r.end();
  });
}

// ---- 준비 ----
const id = crypto.randomBytes(3).toString('hex');
const su = await req('POST', '/api/auth/signup', { json: { username: `cont_${id}`, nickname: `연속성${id}`, password: 'password123' } });
if (su.status !== 201) throw new Error(`signup ${su.status}`);

// 방송 등록 (multipart 를 직접 만들어 보내요)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-cont-'));
const mp4 = path.join(tmp, 'c.mp4');
execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=15', '-t', '1', '-pix_fmt', 'yuv420p', mp4]);
const boundary = `----cc${id}`;
const multipart = Buffer.concat([
  Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\n연속성 확인 방송 ${id}\r\n`),
  Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="video"; filename="c.mp4"\r\nContent-Type: video/mp4\r\n\r\n`),
  fs.readFileSync(mp4),
  Buffer.from(`\r\n--${boundary}--\r\n`),
]);
fs.rmSync(tmp, { recursive: true, force: true });
const up = await req('POST', '/api/broadcasts', { raw: multipart, headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` } });
if (up.status !== 201) throw new Error(`upload ${up.status}`);
const bid = up.data.id;
const videoUrl = up.data.videoUrl;

// 댓글 3개
for (let i = 1; i <= 3; i++) await req('POST', `/api/broadcasts/${bid}/comments`, { json: { content: `스케일 중에도 남아 있어야 하는 댓글 ${i}` } });

// 후원은 남의 방송에만 → 두 번째 계정으로 후원 (모의 결제가 켜져 있을 때만)
const myCookie = cookie;
let donationTotal = 0;
const cfg = await req('GET', '/api/payments/config');
if (cfg.data?.provider === 'mock') {
  cookie = '';
  await req('POST', '/api/auth/signup', { json: { username: `fan_${id}`, nickname: `팬${id}`, password: 'password123' } });
  const order = (await req('POST', `/api/broadcasts/${bid}/donations`, { json: { amount: 5000, message: '스케일 테스트 후원' } })).data;
  const auth = await req('POST', '/mock-pay/api/authorize', {
    json: { orderId: order.orderId, orderName: order.orderName, amount: order.amount, metadata: order.metadata, successUrl: '/donate/success', failUrl: '/donate/fail', outcome: 'success' },
  });
  const q = new URL(auth.data.redirect, BASE).searchParams;
  const c = await req('POST', '/api/donations/confirm', { json: { orderId: q.get('orderId'), paymentKey: q.get('paymentKey'), amount: Number(q.get('amount')) } });
  if (c.data?.donation?.status === 'DONE') donationTotal = 5000;
  cookie = myCookie;
}
console.log(`준비 완료: 사용자 연속성${id} · 방송 #${bid} · 댓글 3개 · 후원 ${donationTotal}원\n`);
console.log('시각      Pod         로그인  방송목록  댓글  후원합계  영상');

// ---- 반복 확인 ----
const seen = new Set();
let checks = 0;
let failures = 0;
const end = Date.now() + DURATION;
while (Date.now() < end) {
  const me = await req('GET', '/api/auth/me');
  const list = await req('GET', '/api/broadcasts');
  const cm = await req('GET', `/api/broadcasts/${bid}/comments`);
  const dn = await req('GET', `/api/broadcasts/${bid}/donations`);
  const vid = await req('GET', videoUrl, { headers: { Range: 'bytes=0-99' } });

  const okMe = me.data?.user?.nickname === `연속성${id}`;
  const okList = Array.isArray(list.data) && list.data.some((b) => b.id === bid);
  const okCm = Array.isArray(cm.data) && cm.data.length === 3;
  const okDn = dn.data?.total === donationTotal;
  const okVid = vid.status === 206;
  const allOk = okMe && okList && okCm && okDn && okVid;
  checks++;
  if (!allOk) failures++;

  const pod = me.instance;
  const isNew = !seen.has(pod);
  seen.add(pod);
  const mark = (b) => (b ? '✔' : '✘');
  console.log(
    `${new Date().toTimeString().slice(0, 8)}  ${pod.slice(-10).padEnd(10)} ${isNew ? '🆕' : '  '}  ${mark(okMe)}       ${mark(okList)}         ${mark(okCm)}     ${mark(okDn)}        ${mark(okVid)}`,
  );
  await new Promise((r) => setTimeout(r, 3000));
}
console.log(`\n${failures ? '✘' : '✅'} 확인 ${checks}회 · 실패 ${failures}회 · 응답한 Pod ${seen.size}개`);
process.exit(failures ? 1 : 0);
