#!/usr/bin/env node
/**
 * 라이브 송출 인계 점검 — 인스턴스 3개(A·B·C)를 로컬에서 같은 DB·같은 공유 폴더로 띄워서 확인해요.
 *   npm run db:up && npm run verify:live-handover
 *
 *   - A 에서 로그인한 세션이 B·C 에서도 유효
 *   - A 에서 만든 방송을 B 로 송출 (DB claim), 송출 중 C 로 두 번째 연결은 403
 *   - 송출 중인 B 를 SIGTERM(= 스케일 인) → 소켓 1012 → C 로 재연결해서 같은 재생목록에 이어 붙임
 *   - A 로 들어온 종료 요청을 송출 담당 C 가 처리, 방송을 만든 A 가 사라져도 C 가 끊긴 라이브를 정리
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const S = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-handover-'));
const DATA = path.join(S, 'shared');
const webm = path.join(S, 'live.webm');
execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=240x320:rate=30', '-f', 'lavfi', '-i', 'sine', '-t', '12',
  '-c:v', 'libvpx', '-deadline', 'realtime', '-c:a', 'libopus', '-shortest', '-live', '1', webm]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, m) => { console.log(`${c ? '✔' : '✘'} ${m}`); if (!c) fails++; };

function startInstance(name, port) {
  const p = spawn('node', ['--no-warnings', 'src/server.js'], {
    cwd: ROOT, env: { ...process.env, PORT: String(port), DATA_DIR: DATA, INSTANCE_ID: name, PAYMENT_PROVIDER: 'mock' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  p.stdout.on('data', (d) => String(d).split('\n').filter((l) => l.includes('[live')).forEach((l) => console.log(`   [${name}] ${l}`)));
  p.stderr.on('data', (d) => console.log(`   [${name}!] ${String(d).trim()}`));
  return p;
}
async function ready(port) {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(`http://localhost:${port}/readyz`)).ok) return; } catch {} await sleep(200); }
  throw new Error(`port ${port} not ready`);
}
const A = startInstance('A', 3141), B = startInstance('B', 3142), C = startInstance('C', 3143);
await Promise.all([ready(3141), ready(3142), ready(3143)]);

// 로그인 (A 에서) → 쿠키는 B·C 에서도 통해야 해요
const signup = await fetch('http://localhost:3141/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: `ml_${Date.now().toString(36)}`, nickname: '멀티', password: 'password123' }) });
const cookie = signup.headers.getSetCookie()[0].split(';')[0];
const me = async (port) => (await (await fetch(`http://localhost:${port}/api/auth/me`, { headers: { Cookie: cookie } })).json()).user?.nickname;
ok((await me(3142)) === '멀티' && (await me(3143)) === '멀티', 'A 에서 로그인한 세션이 B·C 에서도 유효');

// 라이브 시작은 A, 송출은 B 로
const live = await (await fetch('http://localhost:3141/api/lives', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ title: '인계 테스트' }) })).json();
const id = live.broadcast.id;
const buf = fs.readFileSync(webm);
function stream(port) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws/ingest?id=${id}&key=${live.streamKey}`, { headers: { Cookie: cookie } });
    ws.on('unexpected-response', (_q, res) => resolve({ status: res.statusCode }));
    ws.on('open', async () => {
      resolve({ status: 101, ws });
      const n = 20, size = Math.ceil(buf.length / n);
      for (let i = 0; i < buf.length && ws.readyState === ws.OPEN; i += size) { ws.send(buf.subarray(i, i + size)); await sleep(250); }
    });
  });
}
const s1 = await stream(3142);
ok(s1.status === 101, 'A 에서 만든 방송을 B 로 송출 연결 (DB claim)');
const dup = await stream(3143);
ok(dup.status === 403, 'B 가 송출 중일 때 C 로 두 번째 송출 연결 → 403');
await sleep(3000);
const raw = async () => (await fetch(`http://localhost:3143/api/broadcasts/${id}`)).json();
ok((await raw()).status === 'live', 'C 에서 보면 방송 중');
ok((await fetch(`http://localhost:3141${live.broadcast.videoUrl}`)).ok, 'A 에서도 HLS 재생목록 제공 (공유 볼륨)');

// 송출 중인 B 를 종료(스케일 인) → 소켓 1012 → 휴대폰이 C 로 재연결
const closed = new Promise((r) => s1.ws.on('close', (code) => r(code)));
B.kill('SIGTERM');
const code = await closed;
ok(code === 1012, `B 종료 시 송출 소켓 close code = 1012 (got ${code})`);
await sleep(500);
ok((await raw()).status === 'live', 'B 가 내려가도 방송은 종료되지 않음 (재연결 대기)');
const s2 = await stream(3143);
ok(s2.status === 101, 'C 로 재연결 → 이어받기');
await sleep(4000);
const pl = await (await fetch(`http://localhost:3141${live.broadcast.videoUrl}`)).text();
ok(pl.includes('#EXT-X-DISCONTINUITY') && !pl.includes('#EXT-X-ENDLIST'), `재생목록 이어 붙임 (조각 ${pl.split('.ts').length - 1}개, discontinuity O, ENDLIST X)`);

// 종료 요청은 A 로 (송출은 C 가 맡고 있음)
const t0 = Date.now();
const end = await fetch(`http://localhost:3141/api/lives/${id}/end`, { method: 'POST', headers: { Cookie: cookie } });
ok(end.status === 200, `A 로 들어온 종료 요청 → C 가 종료 (${Date.now() - t0}ms)`);
const fin = await raw();
const pl2 = await (await fetch(`http://localhost:3141${live.broadcast.videoUrl}`)).text();
ok(fin.status === 'ended' && pl2.includes('#EXT-X-ENDLIST'), '종료 후 status=ended + ENDLIST');

// 송출이 한 번도 안 붙은 라이브는 30초 뒤 정리 (reaper) — 다른 인스턴스가 시작해도
const idle = await (await fetch('http://localhost:3141/api/lives', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ title: '송출 없음' }) })).json();
A.kill('SIGTERM');
console.log('   … 35초 대기 (송출 없는 라이브 정리 확인, A 는 내려간 상태)');
await sleep(36_000);
ok((await raw().then(() => fetch(`http://localhost:3143/api/broadcasts/${idle.broadcast.id}`)).then((r) => r.json())).status === 'ended', '만든 인스턴스(A)가 사라져도 C 의 reaper 가 정리');

C.kill('SIGTERM');
await sleep(500);
fs.rmSync(S, { recursive: true, force: true });
console.log(fails ? `✘ ${fails}개 실패` : '모두 통과 🎉');
process.exit(fails ? 1 : 0);
