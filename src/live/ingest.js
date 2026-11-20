import { WebSocketServer } from 'ws';
import { userFromCookieHeader } from '../auth/middleware.js';
import { broadcastRepo } from '../db.js';
import { liveService } from './liveService.js';

const HEARTBEAT_MS = 15_000;

function reject(socket, status, text) {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

/**
 * /ws/ingest?id=N&key=STREAM_KEY 로 들어오는 송출 WebSocket 을 받아요.
 * 💡 HTTP 서버의 upgrade 이벤트를 직접 처리해서, 검사에 실패하면 소켓을 열기 전에 끊어요.
 *    WebSocket 도 REST API 와 똑같이 서버에서 권한을 검사해야 해요:
 *      1) 로그인 쿠키 → 401   2) 방송 소유자 → 403   3) 이번 송출 세션의 streamKey → 403
 */
export function attachIngest(server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 * 1024 });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/ws/ingest') return socket.destroy();

    const user = userFromCookieHeader(req.headers.cookie);
    if (!user) return reject(socket, 401, 'Unauthorized');

    const id = Number(url.searchParams.get('id'));
    const broadcast = Number.isInteger(id) ? broadcastRepo.findById(id) : undefined;
    if (!broadcast) return reject(socket, 404, 'Not Found');
    if (broadcast.owner?.id !== user.id) return reject(socket, 403, 'Forbidden');
    if (!liveService.canAttach(id, url.searchParams.get('key') ?? '')) return reject(socket, 403, 'Forbidden');

    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.isAlive = true;
      ws.on('pong', () => (ws.isAlive = true));
      liveService.attach(id, ws);
    });
  });

  // 휴대폰 네트워크가 조용히 끊기면 close 가 안 올 수 있어요 → ping 으로 죽은 연결 정리
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, HEARTBEAT_MS);
  wss.on('close', () => clearInterval(heartbeat));

  return wss;
}
