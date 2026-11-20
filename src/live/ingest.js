import { WebSocketServer } from 'ws';
import { liveService } from './liveService.js';

const HEARTBEAT_MS = 15_000;

/**
 * /ws/ingest?id=N&key=STREAM_KEY 로 들어오는 송출 WebSocket 을 받아요.
 * 💡 HTTP 서버의 upgrade 이벤트를 직접 처리해서, 검사에 실패하면 소켓을 열기 전에 끊어요.
 */
export function attachIngest(server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 * 1024 });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/ws/ingest') return socket.destroy();

    const id = Number(url.searchParams.get('id'));
    const key = url.searchParams.get('key') ?? '';
    if (!Number.isInteger(id) || !liveService.canAttach(id, key)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return socket.destroy();
    }

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
