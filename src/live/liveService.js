import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { broadcastRepo } from '../db.js';

/**
 * 라이브 송출 흐름
 *   휴대폰 MediaRecorder 조각(webm/mp4) ──WebSocket──▶ (아무 인스턴스) ffmpeg stdin ──▶ 공유 볼륨 live/{id}/index.m3u8
 *   시청자는 어느 인스턴스로 가든 /hls/{id}/index.m3u8 을 같은 공유 볼륨에서 받아요.
 *
 * 💡 5단계: 인스턴스가 여러 개라 "누가 송출을 받고 있는지"를 메모리가 아니라 DB 에 둬요.
 *   - 송출 소켓이 붙은 인스턴스가 DB 에 claim(live_instance_id) 하고, 3초마다 하트비트를 남겨요.
 *   - 종료 요청이 다른 인스턴스로 가면 DB 에 end_requested_at 을 남기고 → 맡은 인스턴스가 하트비트 때 보고 종료해요.
 *   - 인스턴스가 줄어들면(스케일 인) 소켓을 1012 로 닫고 claim 을 놓아요 → 휴대폰이 재연결하면
 *     다른 인스턴스가 이어받아 같은 재생목록에 이어 붙여요(append_list + discontinuity).
 *   - 하트비트가 30초 넘게 끊긴 라이브는 어느 인스턴스든 정리(reaper)해요.
 */

/**
 * 이 인스턴스가 지금 받고 있는 송출들
 * @type {Map<number, { ws: import('ws').WebSocket, ffmpeg: import('node:child_process').ChildProcess,
 *   finishOnClose: boolean, draining: boolean, done: Promise<void> }>}
 */
const sessions = new Map();

export const liveDirOf = (id) => path.join(config.liveDir, String(id));
const playlistOf = (id) => path.join(liveDirOf(id), 'index.m3u8');
export const hashStreamKey = (key) => crypto.createHash('sha256').update(String(key)).digest('hex');

// 진짜로 끝난 방송에만 ENDLIST 를 붙여요 (중간 재연결 동안엔 붙이지 않아야 시청자가 계속 기다려요)
function closePlaylist(id) {
  const file = playlistOf(id);
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  if (!text.includes('#EXT-X-ENDLIST')) fs.appendFileSync(file, '#EXT-X-ENDLIST\n');
}

/** DB 에서 종료 처리 + 재생목록 닫기 (여러 인스턴스가 동시에 불러도 안전) */
async function markEnded(id, reason) {
  if (await broadcastRepo.end(id)) {
    closePlaylist(id);
    console.log(`[live ${id}] ended (${reason}) @${config.instanceId}`);
  }
}

function spawnFfmpeg(id) {
  const dir = liveDirOf(id);
  fs.mkdirSync(dir, { recursive: true });
  const gop = config.hlsSegmentSeconds;
  const resuming = fs.existsSync(playlistOf(id)); // 다른 인스턴스(또는 이전 연결)가 쓰던 재생목록에 이어 붙이기
  const flags = ['independent_segments', 'temp_file', 'omit_endlist', 'append_list', ...(resuming ? ['discont_start'] : [])];

  const args = [
    '-hide_banner', '-loglevel', 'error',
    '-fflags', '+genpts',
    '-i', 'pipe:0', // 브라우저 MediaRecorder 조각이 이어서 들어와요
    '-map', '0:v:0', '-map', '0:a:0?', // 오디오는 있으면 사용
    // 영상: 휴대폰마다 코덱이 달라서(vp8/vp9/h264) H.264 로 통일, 짝수 해상도로 맞춤
    '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-pix_fmt', 'yuv420p',
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-r', '30',
    // 세그먼트 길이마다 키프레임을 강제해야 HLS 조각이 일정하게 잘려요
    '-force_key_frames', `expr:gte(t,n_forced*${gop})`, '-sc_threshold', '0',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '48000',
    '-f', 'hls',
    '-hls_time', String(gop),
    '-hls_list_size', '0', // 모든 조각을 남겨서 종료 후 다시보기로 재생 가능
    '-hls_playlist_type', 'event',
    '-hls_flags', flags.join('+'),
    // 연결마다 다른 접두어 → 이어 붙일 때 이전 조각을 덮어쓰지 않아요
    '-hls_segment_filename', path.join(dir, `seg_${Date.now().toString(36)}_%05d.ts`),
    playlistOf(id),
  ];

  const ffmpeg = spawn(config.ffmpegPath, args, { stdio: ['pipe', 'ignore', 'pipe'] });
  ffmpeg.stderr.on('data', (d) => console.error(`[live ${id}] ffmpeg: ${d.toString().trim()}`));
  ffmpeg.stdin.on('error', () => {}); // ffmpeg 가 먼저 죽으면 EPIPE → close 이벤트에서 처리
  return ffmpeg;
}

/** 이 인스턴스의 송출을 끝내도록 신호 (ffmpeg 마무리 → close 이벤트에서 정리) */
function stopLocal(id, { finish, code = 1000, reason = 'ended' }) {
  const s = sessions.get(id);
  if (!s) return Promise.resolve();
  if (finish) s.finishOnClose = true;
  else s.draining = true;
  s.ffmpeg.stdin.end(); // 입력을 닫으면 ffmpeg 가 남은 조각을 쓰고 끝나요
  if (s.ws.readyState === s.ws.OPEN) s.ws.close(code, reason);
  return s.done;
}

// ---------- 하트비트 + 정리(reaper): 모든 인스턴스에서 돌아요 ----------
let timers = [];
async function heartbeatTick() {
  const ids = [...sessions.keys()];
  if (!ids.length) return;
  const rows = await broadcastRepo.heartbeat(ids, config.instanceId);
  const mine = new Map(rows.map((r) => [r.id, r]));
  for (const id of ids) {
    const row = mine.get(id);
    if (!row) {
      // claim 을 잃었어요 (DB 에서 다른 인스턴스로 넘어감) → 이쪽은 조용히 내려놓기
      console.warn(`[live ${id}] claim lost @${config.instanceId}`);
      stopLocal(id, { finish: false, code: 1012, reason: 'claim lost' });
    } else if (row.end_requested_at || row.status !== 'live') {
      // 다른 인스턴스로 들어온 종료 요청
      stopLocal(id, { finish: true });
    }
  }
}
async function reaperTick() {
  // 송출이 끊긴 채(재연결 없이) 오래된 라이브, 또는 만들고 나서 송출이 한 번도 안 붙은 라이브
  for (const id of await broadcastRepo.findStaleLiveIds(config.liveConnectTimeoutMs)) {
    if (!sessions.has(id)) await markEnded(id, 'no ingest');
  }
}
const safe = (fn, name) => () => fn().catch((e) => console.error(`[live] ${name} 실패`, e.message));

export const liveService = {
  /** 하트비트·정리 루프 시작 (서버 시작 시 1번) */
  startBackgroundJobs() {
    timers = [
      setInterval(safe(heartbeatTick, 'heartbeat'), config.liveHeartbeatMs),
      setInterval(safe(reaperTick, 'reaper'), 5_000),
    ];
    timers.forEach((t) => t.unref());
  },

  async start({ title, description, ownerId }) {
    // 💡 소유자 확인(쿠키)에 더해, "이번 송출" 을 가리키는 키도 같이 검사해요. DB 에는 해시만 저장
    const streamKey = crypto.randomBytes(16).toString('hex');
    const broadcast = await broadcastRepo.createLive({ title, description, ownerId, streamKeyHash: hashStreamKey(streamKey) });
    console.log(`[live ${broadcast.id}] created "${broadcast.title}" by user ${ownerId} @${config.instanceId}`);
    return { broadcast, streamKey };
  },

  /** 송출 소켓을 이 인스턴스가 맡을 수 있으면 DB 에 claim (소유자 검사는 ingest 에서 먼저 해요) */
  async tryClaim(id, streamKey) {
    if (sessions.has(id)) return false;
    return broadcastRepo.claimLive(id, hashStreamKey(streamKey), config.instanceId, config.liveClaimStaleMs);
  },

  /** 송출 WebSocket 연결 → ffmpeg 로 파이프 */
  attach(id, ws) {
    let resolveDone;
    const done = new Promise((r) => (resolveDone = r));
    const session = { ws, ffmpeg: spawnFfmpeg(id), finishOnClose: false, draining: false, done };
    sessions.set(id, session);
    console.log(`[live ${id}] ingest connected @${config.instanceId}`);

    ws.on('message', (data, isBinary) => {
      if (isBinary) session.ffmpeg.stdin.write(data);
    });
    ws.on('close', (code) => {
      // 1000 = 송출자가 "종료" 버튼으로 정상 종료. 그 외(네트워크 끊김 등)는 재연결을 기다려요
      if (code === 1000 && !session.draining) session.finishOnClose = true;
      session.ffmpeg.stdin.end();
    });
    session.ffmpeg.on('close', async (code) => {
      if (code !== 0) console.error(`[live ${id}] ffmpeg exited with ${code}`);
      if (ws.readyState === ws.OPEN) ws.close(1011, 'encoder stopped');
      sessions.delete(id);
      try {
        if (session.finishOnClose) await markEnded(id, 'broadcaster ended');
        else {
          // 끊김·스케일 인: claim 만 놓아요 → 30초 안에 재연결되면 다른 인스턴스가 이어받고, 아니면 reaper 가 종료
          await broadcastRepo.releaseLive(id, config.instanceId);
          console.log(`[live ${id}] released @${config.instanceId} (재연결 대기)`);
        }
      } catch (e) {
        console.error(`[live ${id}] 정리 실패`, e.message);
      } finally {
        resolveDone();
      }
    });
  },

  /**
   * 송출 종료 (권한 검사는 호출하는 쪽에서 끝낸 뒤 불러요). 다른 인스턴스가 맡고 있어도 끝날 때까지 기다려요.
   * @returns {Promise<boolean>} 방송 중이던 걸 종료했는지
   */
  async end(id) {
    if (sessions.has(id)) {
      await stopLocal(id, { finish: true });
      return true;
    }
    const row = await broadcastRepo.requestEnd(id); // 다른 인스턴스에게 "끝내 주세요"
    if (!row) return false; // 이미 종료된 방송
    if (!row.live_instance_id) {
      await markEnded(id, 'end requested (no ingest)');
      return true;
    }
    // 맡은 인스턴스가 하트비트 때(≤3초) 종료해요. 그 인스턴스가 죽어 있으면 직접 정리
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 300));
      const cur = await broadcastRepo.findRawById(id);
      if (!cur || cur.status !== 'live') return true;
    }
    await markEnded(id, 'end requested (owner unresponsive)');
    return true;
  },

  /** 인스턴스 종료(스케일 인·재배포) 시: 송출은 끝내지 않고 넘겨줘요 */
  async shutdown() {
    clearInterval(timers[0]);
    clearInterval(timers[1]);
    await Promise.all(
      [...sessions.keys()].map((id) => stopLocal(id, { finish: false, code: 1012, reason: 'server restarting' })),
    );
  },

  localSessionCount: () => sessions.size,
};
