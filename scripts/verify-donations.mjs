#!/usr/bin/env node
/**
 * 4단계 도네이션 점검 — 모의 결제(PAYMENT_PROVIDER=mock) 서버에 직접 요청해서
 * 성공·실패·취소·위변조·중복 승인 통지를 확인해요. (화면을 거치지 않고 서버 판단만 봐요)
 *
 *   PAYMENT_PROVIDER=mock npm start     # 터미널 1 (토스 키가 없으면 기본이 mock)
 *   npm run verify:donations            # 터미널 2  (BASE_URL=http://localhost:3000 기본)
 */
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = (process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');

class Client {
  constructor(name) {
    this.name = name;
    this.cookie = '';
  }
  async req(method, url, { json, form } = {}) {
    const headers = {};
    if (this.cookie) headers.Cookie = this.cookie;
    let body;
    if (json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(json);
    } else if (form) body = form;
    const res = await fetch(BASE + url, { method, headers, body });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const [name, value] = pair.split('=');
      if (name === 'cc_session') this.cookie = value ? `${name}=${value}` : '';
    }
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : undefined; } catch { data = text; }
    return { status: res.status, data };
  }
}

const rows = [];
let failed = 0;
function check(area, action, who, expected, actual) {
  const ok = actual === expected;
  if (!ok) failed++;
  rows.push({ ok, area, action, who: who?.name ?? who, expected, actual });
}

// ---------- 준비 ----------
try {
  const cfg = await (await fetch(`${BASE}/api/payments/config`)).json();
  if (cfg.provider !== 'mock') {
    console.error(`✘ 이 스크립트는 모의 결제 서버에서 돌려요. 지금 서버는 provider=${cfg.provider}. PAYMENT_PROVIDER=mock 으로 켜주세요.`);
    process.exit(1);
  }
} catch {
  console.error(`✘ 서버(${BASE})에 연결할 수 없어요. 먼저 npm start 로 서버를 켜주세요.`);
  process.exit(1);
}

const anon = new Client('비로그인');
const streamer = new Client('방송자');
const fan = new Client('시청자(후원자)');
const other = new Client('다른 사용자');
const suffix = crypto.randomBytes(3).toString('hex');
for (const [c, nick] of [[streamer, '방송자'], [fan, '팬'], [other, '구경꾼']]) {
  await c.req('POST', '/api/auth/signup', { json: { username: `${c === streamer ? 'st' : c === fan ? 'fan' : 'ot'}_${suffix}`, nickname: nick, password: 'password123' } });
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chickchicken-don-'));
const mp4 = path.join(tmp, 's.mp4');
execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=15', '-t', '1', '-pix_fmt', 'yuv420p', mp4]);
const fd = new FormData();
fd.append('title', '후원 테스트 방송');
fd.append('video', new Blob([fs.readFileSync(mp4)], { type: 'video/mp4' }), 's.mp4');
const broadcast = (await streamer.req('POST', '/api/broadcasts', { form: fd })).data;
const bid = broadcast.id;

/** 모의 결제창에서 버튼을 누른 것과 같은 요청 → 리다이렉트 URL 의 쿼리 */
async function payWindow(order, outcome = 'success', overrides = {}) {
  const res = await fetch(`${BASE}/mock-pay/api/authorize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      orderId: order.orderId,
      orderName: order.orderName,
      amount: order.amount,
      metadata: order.metadata,
      successUrl: '/donate/success',
      failUrl: `/donate/fail?orderId=${order.orderId}`,
      outcome,
      ...overrides,
    }),
  });
  const { redirect } = await res.json();
  return Object.fromEntries(new URL(redirect, BASE).searchParams);
}
const order = (c, amount, message = '') => c.req('POST', `/api/broadcasts/${bid}/donations`, { json: { amount, message } });
const confirm = (c, q) => c.req('POST', '/api/donations/confirm', { json: { orderId: q.orderId, paymentKey: q.paymentKey, amount: Number(q.amount) } });
const summary = async () => (await anon.req('GET', `/api/broadcasts/${bid}/donations`)).data;
const webhook = (q) =>
  anon.req('POST', '/api/payments/webhook', { json: { eventType: 'PAYMENT_STATUS_CHANGED', createdAt: new Date().toISOString(), data: { paymentKey: q.paymentKey, orderId: q.orderId, status: 'DONE' } } });

// ---------- 주문 만들기 (방송자·금액 선택) ----------
check('주문', '후원 주문', anon, 401, (await order(anon, 5000)).status);
check('주문', '내 방송에 후원', streamer, 400, (await order(streamer, 5000)).status);
check('주문', '최소 금액 미만(500원)', fan, 400, (await order(fan, 500)).status);
check('주문', '소수 금액(1000.5원)', fan, 400, (await order(fan, 1000.5)).status);
const o1 = (await order(fan, 5000, '첫 후원!')).data;
check('주문', '후원 주문 → 수신자=방송 소유자', fan, '방송자', o1.streamer?.nickname);

// ---------- 성공 + 중복 승인 통지 ----------
const q1 = await payWindow(o1, 'success');
check('성공', '승인 전 합계 (결제창 성공만으론 미확정)', anon, 0, (await summary()).total);
check('성공', '다른 사용자가 남의 주문 승인', other, 403, (await confirm(other, q1)).status);
const c1 = await confirm(fan, q1);
check('성공', '서버 승인 확인', fan, 200, c1.status);
check('성공', '확정 상태', fan, 'DONE', c1.data?.donation?.status);
check('성공', '합계 반영', anon, 5000, (await summary()).total);
const c1again = await confirm(fan, q1);
check('중복', '같은 승인 재요청(새로고침)', fan, true, c1again.data?.duplicated);
const hooks = await Promise.all(Array.from({ length: 5 }, () => webhook(q1)));
check('중복', '웹훅 5회 동시 통지', '결제사', 'duplicate', [...new Set(hooks.map((h) => h.data?.result))].join(','));
check('중복', '중복 통지 후 합계 그대로', anon, 5000, (await summary()).total);
check('중복', '중복 통지 후 건수 그대로', anon, 1, (await summary()).count);

// 승인 요청과 웹훅이 동시에 몰려도 한 번만
const o2 = (await order(fan, 10000)).data;
const q2 = await payWindow(o2, 'success');
const burst = await Promise.all([confirm(fan, q2), confirm(fan, q2), confirm(fan, q2), webhook(q2), webhook(q2)]);
const credited = burst.filter((r) => r.data?.duplicated === false || r.data?.result === 'credited').length;
check('중복', '승인 3회 + 웹훅 2회 동시 → 적립 횟수', fan, 1, credited);
check('중복', '동시 통지 후 합계', anon, 15000, (await summary()).total);

// 웹훅만으로 확정되는 경우(승인 응답 직후 브라우저가 닫힘 등): 결제사에서 DONE 인 결제를 웹훅이 반영
// → 모의 결제사에서 승인만 하고 우리 서버 confirm 은 실패한 상황을 재현하기 어려워 생략, 대신 위변조된 웹훅을 확인
check('웹훅', '없는 주문 웹훅', '결제사', 'ignored', (await webhook({ paymentKey: 'mock_x', orderId: 'don_nope' })).data?.result);
const o3 = (await order(fan, 3000)).data;
check('웹훅', '결제 안 한 주문에 DONE 위조 웹훅 → 재조회로 무시', '공격자', 'ignored', (await webhook({ paymentKey: 'mock_forged', orderId: o3.orderId })).data?.result);
check('웹훅', '위조 웹훅 후 주문 상태', fan, 'PENDING', (await fan.req('GET', `/api/donations/${o3.orderId}`)).data?.status);
check('웹훅', '위조 웹훅 후 합계 그대로', anon, 15000, (await summary()).total);

// ---------- 금액·수신자 위변조 ----------
const o4 = (await order(fan, 50000)).data;
const q4 = await payWindow(o4, 'success', { amount: 1000 }); // 브라우저가 결제창 금액을 1,000원으로 조작
check('위변조', '조작 금액(1,000원)으로 승인 요청', fan, 400, (await confirm(fan, q4)).status);
check('위변조', '주문 금액(50,000원)으로 승인 요청 → 결제사 거절', fan, 402, (await confirm(fan, { ...q4, amount: 50000 })).status);
const o5 = (await order(fan, 7000)).data;
const q5 = await payWindow(o5, 'success', { metadata: { broadcastId: String(bid), streamerId: '999999' } }); // 수신자 조작
const c5 = await confirm(fan, q5);
check('위변조', '수신자 조작 → 검증 실패', fan, 400, c5.status);
check('위변조', '검증 실패 주문 상태', fan, 'FAILED', (await fan.req('GET', `/api/donations/${o5.orderId}`)).data?.status);
check('위변조', '위변조 후 합계 그대로', anon, 15000, (await summary()).total);

// ---------- 실패·취소 ----------
const o6 = (await order(fan, 2000)).data;
const q6 = await payWindow(o6, 'reject');
check('실패', '카드사 거절 → failUrl code', fan, 'REJECT_CARD_COMPANY', q6.code);
check('실패', '실패 보고 → 상태', fan, 'FAILED', (await fan.req('POST', `/api/donations/${q6.orderId}/fail`, { json: { code: q6.code, message: q6.message } })).data?.status);

const o7 = (await order(fan, 2000)).data;
const q7 = await payWindow(o7, 'confirm-reject');
check('실패', '승인 단계 거절 → 서버 승인 실패', fan, 402, (await confirm(fan, q7)).status);
check('실패', '승인 단계 거절 → 상태', fan, 'FAILED', (await fan.req('GET', `/api/donations/${o7.orderId}`)).data?.status);

const o8 = (await order(fan, 2000)).data;
const q8 = await payWindow(o8, 'cancel');
// 토스는 취소 시 orderId 를 붙여주지 않아요 → 우리가 failUrl 에 미리 넣어 둔 orderId 로 주문을 찾아요
check('취소', '취소 → failUrl code + 미리 넣어 둔 orderId', fan, `PAY_PROCESS_CANCELED|${o8.orderId}`, `${q8.code}|${q8.orderId}`);
check('취소', '취소 보고(주소의 orderId 사용)', fan, 'CANCELED', (await fan.req('POST', `/api/donations/${o8.orderId}/fail`, { json: { code: q8.code } })).data?.status);
check('취소', '남의 주문 취소 보고', other, 403, (await other.req('POST', `/api/donations/${o1.orderId}/fail`, { json: { code: 'PAY_PROCESS_CANCELED' } })).status);
check('취소', '확정된 주문에 취소 보고 → 상태 유지', fan, 'DONE', (await fan.req('POST', `/api/donations/${o1.orderId}/fail`, { json: { code: 'PAY_PROCESS_CANCELED' } })).data?.status);

// ---------- 최종 ----------
const final = await summary();
check('내역', '방송별 합계', anon, 15000, final.total);
check('내역', '방송별 건수 (확정만)', anon, 2, final.count);
check('내역', '내역에 메시지 표시', anon, true, final.donations.some((d) => d.message === '첫 후원!'));

fs.rmSync(tmp, { recursive: true, force: true });
const width = (s) => [...String(s)].reduce((w, ch) => w + (ch.charCodeAt(0) > 0x2e80 ? 2 : 1), 0);
const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - width(s)));
console.log(`\n도네이션 점검 결과 (${BASE})\n`);
console.log(`   ${pad('영역', 8)}${pad('동작', 50)}${pad('요청자', 16)}${pad('기대', 24)}실제`);
for (const r of rows) {
  console.log(`${r.ok ? '✔' : '✘'}  ${pad(r.area, 8)}${pad(r.action, 50)}${pad(r.who, 16)}${pad(r.expected, 24)}${r.actual}`);
}
console.log(`\n${rows.length - failed}/${rows.length} 통과${failed ? ` — ✘ ${failed}개 실패` : ' 🎉'}`);
process.exit(failed ? 1 : 0);
