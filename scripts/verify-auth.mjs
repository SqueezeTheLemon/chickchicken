#!/usr/bin/env node
/**
 * 3단계 권한 점검: 실행 중인 서버에 비로그인 / 소유자(alice) / 다른 사용자(bob) 로 직접 요청을 보내
 * 허용·거절이 서버에서 처리되는지 확인해요. (화면 버튼과 무관하게 API·WebSocket 을 직접 호출)
 *
 *   npm start                # 터미널 1
 *   npm run verify:auth      # 터미널 2  (BASE_URL=http://localhost:3000 기본)
 */
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';

const BASE = (process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 테스트 영상 만들기 ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chickchicken-verify-'));
const mp4 = path.join(tmp, 'sample.mp4');
const webm = path.join(tmp, 'live.webm');
const ff = (args) => execFileSync(FFMPEG, ['-loglevel', 'error', '-y', ...args]);
ff(['-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=30', '-t', '2', '-pix_fmt', 'yuv420p', mp4]);
ff(['-f', 'lavfi', '-i', 'testsrc=size=240x320:rate=30', '-f', 'lavfi', '-i', 'sine', '-t', '4',
  '-c:v', 'libvpx', '-deadline', 'realtime', '-c:a', 'libopus', '-shortest', '-live', '1', webm]);

// ---------- 쿠키를 기억하는 간단한 클라이언트 ----------
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
    return { status: res.status, data, headers: res.headers };
  }
  /** WebSocket 업그레이드 결과 상태 코드 (101 = 연결 허용) */
  ws(url) {
    return new Promise((resolve) => {
      const ws = new WebSocket(BASE.replace(/^http/, 'ws') + url, { headers: this.cookie ? { Cookie: this.cookie } : {} });
      ws.on('open', () => resolve({ status: 101, ws }));
      ws.on('unexpected-response', (_req, res) => resolve({ status: res.statusCode }));
      ws.on('error', () => resolve({ status: 'error' }));
    });
  }
}

const anon = new Client('비로그인');
const alice = new Client('alice(소유자)');
const bob = new Client('bob(다른 사용자)');

const rows = [];
let failed = 0;
function check(area, action, who, expected, actual) {
  const ok = actual === expected;
  if (!ok) failed++;
  rows.push({ ok, area, action, who: who.name ?? who, expected, actual });
}

const uploadForm = (title) => {
  const fd = new FormData();
  fd.append('title', title);
  fd.append('video', new Blob([fs.readFileSync(mp4)], { type: 'video/mp4' }), 'sample.mp4');
  return fd;
};

async function sendLive(ws, ms = 2000) {
  const buf = fs.readFileSync(webm);
  const n = 8;
  const size = Math.ceil(buf.length / n);
  for (let i = 0; i < buf.length; i += size) {
    ws.send(buf.subarray(i, i + size));
    await sleep(ms / n);
  }
}

try {
  await fetch(`${BASE}/api/auth/me`);
} catch {
  console.error(`✘ 서버(${BASE})에 연결할 수 없어요. 먼저 npm start 로 서버를 켜주세요.`);
  process.exit(1);
}

const suffix = crypto.randomBytes(3).toString('hex');
const pw = 'password123';

// ---------- 회원가입·로그인 ----------
check('인증', '회원가입 (잘못된 아이디)', anon, 400, (await anon.req('POST', '/api/auth/signup', { json: { username: 'a!', nickname: 'x', password: pw } })).status);
check('인증', '회원가입 (짧은 비밀번호)', anon, 400, (await anon.req('POST', '/api/auth/signup', { json: { username: `x_${suffix}`, nickname: 'x', password: '123' } })).status);
const aliceSignup = await alice.req('POST', '/api/auth/signup', { json: { username: `alice_${suffix}`, nickname: '앨리스', password: pw } });
check('인증', '회원가입', alice, 201, aliceSignup.status);
const setCookie = aliceSignup.headers.getSetCookie().join(';');
check('인증', '세션 쿠키 HttpOnly·SameSite=Lax', alice, true, /HttpOnly/i.test(setCookie) && /SameSite=Lax/i.test(setCookie));
check('인증', '회원가입', bob, 201, (await bob.req('POST', '/api/auth/signup', { json: { username: `bob_${suffix}`, nickname: '밥', password: pw } })).status);
check('인증', '중복 아이디 가입 (대소문자 무시)', anon, 409, (await anon.req('POST', '/api/auth/signup', { json: { username: `ALICE_${suffix}`, nickname: 'x', password: pw } })).status);
check('인증', '로그인 (틀린 비밀번호)', anon, 401, (await anon.req('POST', '/api/auth/login', { json: { username: `alice_${suffix}`, password: 'wrongpass1' } })).status);
check('인증', '로그인 (없는 아이디)', anon, 401, (await anon.req('POST', '/api/auth/login', { json: { username: `nobody_${suffix}`, password: pw } })).status);
alice.cookie = '';
check('인증', '로그인', alice, 200, (await alice.req('POST', '/api/auth/login', { json: { username: `alice_${suffix}`, password: pw } })).status);
check('인증', '내 정보 (비로그인 → null)', anon, null, (await anon.req('GET', '/api/auth/me')).data.user);
check('인증', '내 정보', alice, '앨리스', (await alice.req('GET', '/api/auth/me')).data.user?.nickname);

// ---------- 녹화방송 ----------
check('녹화방송', '업로드', anon, 401, (await anon.req('POST', '/api/broadcasts', { form: uploadForm('익명') })).status);
const vod = await alice.req('POST', '/api/broadcasts', { form: uploadForm('앨리스의 방송') });
check('녹화방송', '업로드', alice, 201, vod.status);
const vodId = vod.data.id;
check('녹화방송', '업로드 → 소유자 기록', alice, '앨리스', vod.data.owner?.nickname);
check('녹화방송', '목록 조회 (공개)', anon, 200, (await anon.req('GET', '/api/broadcasts')).status);
check('녹화방송', '상세 조회 (공개)', anon, 200, (await anon.req('GET', `/api/broadcasts/${vodId}`)).status);
for (const [c, expected] of [[anon, 401], [bob, 403], [alice, 200]]) {
  check('녹화방송', '수정', c, expected, (await c.req('PATCH', `/api/broadcasts/${vodId}`, { json: { title: `${c.name} 수정`, description: '' } })).status);
}

// ---------- 댓글 ----------
check('댓글', '목록 조회 (공개)', anon, 200, (await anon.req('GET', `/api/broadcasts/${vodId}/comments`)).status);
check('댓글', '작성', anon, 401, (await anon.req('POST', `/api/broadcasts/${vodId}/comments`, { json: { content: '익명' } })).status);
check('댓글', '작성 (빈 내용)', bob, 400, (await bob.req('POST', `/api/broadcasts/${vodId}/comments`, { json: { content: '  ' } })).status);
const bobComment = await bob.req('POST', `/api/broadcasts/${vodId}/comments`, { json: { content: '밥의 댓글' } });
check('댓글', '작성', bob, 201, bobComment.status);
const aliceComment = await alice.req('POST', `/api/broadcasts/${vodId}/comments`, { json: { content: '앨리스의 댓글' } });
check('댓글', '작성', alice, 201, aliceComment.status);
check('댓글', '없는 방송에 작성', bob, 404, (await bob.req('POST', '/api/broadcasts/999999/comments', { json: { content: 'x' } })).status);
for (const [c, expected] of [[anon, 401], [alice, 403], [bob, 200]]) {
  check('댓글', 'bob 댓글 수정', c, expected, (await c.req('PATCH', `/api/comments/${bobComment.data.id}`, { json: { content: `${c.name} 수정` } })).status);
}
check('댓글', 'alice 댓글 삭제 (남의 댓글)', bob, 403, (await bob.req('DELETE', `/api/comments/${aliceComment.data.id}`)).status);
check('댓글', 'alice 댓글 삭제', anon, 401, (await anon.req('DELETE', `/api/comments/${aliceComment.data.id}`)).status);
check('댓글', 'bob 댓글 삭제 (방송 소유자 관리)', alice, 204, (await alice.req('DELETE', `/api/comments/${bobComment.data.id}`)).status);

// ---------- 라이브 ----------
check('라이브', '시작', anon, 401, (await anon.req('POST', '/api/lives', { json: { title: '익명 라이브' } })).status);
const live = await alice.req('POST', '/api/lives', { json: { title: '앨리스 라이브' } });
check('라이브', '시작', alice, 201, live.status);
const { id: liveId } = live.data.broadcast;
const key = live.data.streamKey;
check('라이브', '송출 소켓', anon, 401, (await anon.ws(`/ws/ingest?id=${liveId}&key=${key}`)).status);
check('라이브', '송출 소켓 (키를 알아도)', bob, 403, (await bob.ws(`/ws/ingest?id=${liveId}&key=${key}`)).status);
check('라이브', '송출 소켓 (틀린 키)', alice, 403, (await alice.ws(`/ws/ingest?id=${liveId}&key=wrong`)).status);
const ingest = await alice.ws(`/ws/ingest?id=${liveId}&key=${key}`);
check('라이브', '송출 소켓', alice, 101, ingest.status);
if (ingest.ws) await sendLive(ingest.ws);
check('라이브', '방송 중 상태', anon, 'live', (await anon.req('GET', `/api/broadcasts/${liveId}`)).data.status);
check('라이브', '종료', anon, 401, (await anon.req('POST', `/api/lives/${liveId}/end`)).status);
check('라이브', '종료', bob, 403, (await bob.req('POST', `/api/lives/${liveId}/end`)).status);
check('라이브', '종료', alice, 200, (await alice.req('POST', `/api/lives/${liveId}/end`)).status);
check('라이브', '종료 후 상태', anon, 'ended', (await anon.req('GET', `/api/broadcasts/${liveId}`)).data.status);
ingest.ws?.terminate();

// 방송 중인 라이브 삭제 → 송출 정리 후 삭제
const live2 = await alice.req('POST', '/api/lives', { json: { title: '삭제될 라이브' } });
const ingest2 = await alice.ws(`/ws/ingest?id=${live2.data.broadcast.id}&key=${live2.data.streamKey}`);
if (ingest2.ws) await sendLive(ingest2.ws, 1000);
check('라이브', '방송 중 삭제', alice, 204, (await alice.req('DELETE', `/api/broadcasts/${live2.data.broadcast.id}`)).status);
check('라이브', '삭제 후 HLS 파일', anon, 404, (await anon.req('GET', live2.data.broadcast.videoUrl)).status);
ingest2.ws?.terminate();

// ---------- 삭제 ----------
for (const [c, expected] of [[anon, 401], [bob, 403], [alice, 204]]) {
  check('녹화방송', '삭제', c, expected, (await c.req('DELETE', `/api/broadcasts/${vodId}`)).status);
}
check('녹화방송', '삭제 후 상세', anon, 404, (await anon.req('GET', `/api/broadcasts/${vodId}`)).status);
check('녹화방송', '삭제 후 댓글 목록', anon, 404, (await anon.req('GET', `/api/broadcasts/${vodId}/comments`)).status);
check('녹화방송', '삭제 후 영상 파일', anon, 404, (await anon.req('GET', vod.data.videoUrl)).status);
check('녹화방송', '없는 방송 삭제', alice, 404, (await alice.req('DELETE', '/api/broadcasts/999999')).status);

// ---------- 로그아웃 ----------
const stolen = alice.cookie; // 로그아웃 전 쿠키를 복사해 둔 상황
check('인증', '로그아웃', alice, 204, (await alice.req('POST', '/api/auth/logout')).status);
check('인증', '로그아웃 후 라이브 시작', alice, 401, (await alice.req('POST', '/api/lives', { json: { title: 'x' } })).status);
const replay = new Client('로그아웃된 쿠키 재사용');
replay.cookie = stolen;
check('인증', '라이브 시작', replay, 401, (await replay.req('POST', '/api/lives', { json: { title: 'x' } })).status);

// ---------- 결과 ----------
fs.rmSync(tmp, { recursive: true, force: true });
const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - [...String(s)].reduce((w, ch) => w + (ch.charCodeAt(0) > 0x2e80 ? 2 : 1), 0)));
console.log(`\n권한 점검 결과 (${BASE})\n`);
console.log(`   ${pad('영역', 10)}${pad('동작', 34)}${pad('요청자', 26)}${pad('기대', 8)}실제`);
for (const r of rows) {
  console.log(`${r.ok ? '✔' : '✘'}  ${pad(r.area, 10)}${pad(r.action, 34)}${pad(r.who, 26)}${pad(r.expected, 8)}${r.actual}`);
}
console.log(`\n${rows.length - failed}/${rows.length} 통과${failed ? ` — ✘ ${failed}개 실패` : ' 🎉'}`);
process.exit(failed ? 1 : 0);
