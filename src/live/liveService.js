import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { broadcastRepo } from '../db.js';

/**
 * 라이브 송출 흐름
 *   휴대폰 MediaRecorder 조각(webm/mp4) ──WebSocket──▶ ffmpeg stdin ──▶ data/live/{id}/index.m3u8 + seg_*.ts
 *   시청자는 /hls/{id}/index.m3u8 을 HLS 로 재생해요.
 *
 * 💡 진행 중인 세션(ffmpeg 프로세스, 소켓)은 메모리에만 있어요.
 *    서버가 재시작되면 이어 갈 수 없으므로 recoverStaleLives() 가 종료 처리해요.
 * 💡 권한(로그인·소유자)은 라우터/ingest 에서 검사하고, 여기서는 송출 세션만 관리해요.
 */

/**
 * @typedef {{ streamKey: string, ws?: import('ws').WebSocket, ffmpeg?: import('node:child_process').ChildProcess,
 *             timer?: NodeJS.Timeout, done: Promise<void>, resolveDone: () => void }} LiveSession
 * @type {Map<number, LiveSession>}
 */
const sessions = new Map();

export const liveDirOf = (id) => path.join(config.liveDir, String(id));
const playlistOf = (id) => path.join(liveDirOf(id), 'index.m3u8');

// 비정상 종료로 ENDLIST 가 빠진 재생목록은 플레이어가 "아직 라이브"로 착각해요 → 직접 닫아줘요
function closePlaylist(id) {
  const file = playlistOf(id);
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  if (!text.includes('#EXT-X-ENDLIST')) fs.appendFileSync(file, '#EXT-X-ENDLIST\n');
}

function finish(id) {
  const session = sessions.get(id);
  if (session?.timer) clearTimeout(session.timer);
  sessions.delete(id);
  closePlaylist(id);
  if (broadcastRepo.end(id)) console.log(`[live ${id}] ended`);
  session?.resolveDone();
}

function spawnFfmpeg(id) {
  const dir = liveDirOf(id);
  fs.mkdirSync(dir, { recursive: true });
  const gop = config.hlsSegmentSeconds;

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
    '-hls_playlist_type', 'event', // 끝나면 #EXT-X-ENDLIST 가 붙어요
    '-hls_flags', 'independent_segments+temp_file',
    '-hls_segment_filename', path.join(dir, 'seg_%05d.ts'),
    path.join(dir, 'index.m3u8'),
  ];

  const ffmpeg = spawn(config.ffmpegPath, args, { stdio: ['pipe', 'ignore', 'pipe'] });
  ffmpeg.stderr.on('data', (d) => console.error(`[live ${id}] ffmpeg: ${d.toString().trim()}`));
  ffmpeg.stdin.on('error', () => {}); // ffmpeg 가 먼저 죽으면 EPIPE → close 이벤트에서 처리
  return ffmpeg;
}

export const liveService = {
  start({ title, description, ownerId }) {
    const broadcast = broadcastRepo.createLive({ title, description, ownerId });
    // 💡 소유자 확인(쿠키)에 더해, "이번 송출 세션" 을 가리키는 1회용 키도 같이 검사해요
    //    → 소유자가 다른 탭에서 같은 방송에 끼어드는 것도 막아요
    const streamKey = crypto.randomBytes(16).toString('hex');
    const timer = setTimeout(() => {
      if (!sessions.get(broadcast.id)?.ws) finish(broadcast.id);
    }, config.liveConnectTimeoutMs);
    let resolveDone;
    const done = new Promise((r) => (resolveDone = r));
    sessions.set(broadcast.id, { streamKey, timer, done, resolveDone });
    console.log(`[live ${broadcast.id}] created "${broadcast.title}" by user ${ownerId}`);
    return { broadcast, streamKey };
  },

  /** 업그레이드 전에 송출 소켓을 받아도 되는지 검사 (소유자 검사는 ingest 에서 먼저 해요) */
  canAttach(id, streamKey) {
    const session = sessions.get(id);
    return Boolean(session && !session.ws && session.streamKey === streamKey);
  },

  /** 송출 WebSocket 연결 → ffmpeg 로 파이프 */
  attach(id, ws) {
    const session = sessions.get(id);
    clearTimeout(session.timer);
    session.ws = ws;
    session.ffmpeg = spawnFfmpeg(id);
    console.log(`[live ${id}] ingest connected`);

    ws.on('message', (data, isBinary) => {
      if (isBinary) session.ffmpeg.stdin.write(data);
    });
    // 소켓이 닫히면(종료 버튼·탭 닫기·네트워크 끊김) 입력을 닫아 ffmpeg 가 마무리하게 해요
    ws.on('close', () => session.ffmpeg.stdin.end());
    session.ffmpeg.on('close', (code) => {
      if (code !== 0) console.error(`[live ${id}] ffmpeg exited with ${code}`);
      if (ws.readyState === ws.OPEN) ws.close(1011, 'encoder stopped');
      finish(id);
    });
  },

  /**
   * 송출 종료 (권한 검사는 호출하는 쪽에서 끝낸 뒤 불러요)
   * @returns {Promise<boolean>} 진행 중인 송출이 있었는지. ffmpeg 마무리까지 기다려요.
   */
  async end(id) {
    const session = sessions.get(id);
    if (!session) return false;
    if (session.ws) {
      // 입력을 바로 닫아 ffmpeg 가 마무리 → close 이벤트에서 finish (소켓 close 핸드셰이크를 기다리지 않음)
      session.ffmpeg.stdin.end();
      session.ws.close(1000, 'ended');
    } else finish(id);
    await session.done;
    return true;
  },

  /** 서버 시작 시: 이전 실행에서 방송 중으로 남은 라이브를 종료 처리 */
  recoverStaleLives() {
    for (const b of broadcastRepo.findLiveRows()) {
      if (!sessions.has(b.id)) finish(b.id);
    }
  },

  /** 종료 시 진행 중 송출을 정리 */
  shutdown() {
    for (const [id, s] of sessions) {
      if (s.ws) {
        s.ffmpeg.stdin.end();
        s.ws.terminate();
      } else finish(id);
    }
  },
};
