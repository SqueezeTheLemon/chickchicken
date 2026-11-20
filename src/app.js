import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { loadUser } from './auth/middleware.js';
import { config } from './config.js';
import { authRouter } from './routes/auth.js';
import { broadcastsRouter } from './routes/broadcasts.js';
import { commentsRouter } from './routes/comments.js';
import { livesRouter } from './routes/lives.js';

export function createApp() {
  const app = express();
  const publicDir = path.resolve('public');

  // 💡 모든 API 요청에서 쿠키 → req.user (비로그인이면 undefined). 막는 건 각 라우트의 requireAuth 몫
  app.use('/api', loadUser);
  app.use('/api/auth', authRouter);
  app.use('/api', commentsRouter); // /api/broadcasts/:id/comments, /api/comments/:commentId
  app.use('/api/broadcasts', broadcastsRouter);
  app.use('/api/lives', livesRouter);
  app.use('/api', (_req, res) => res.status(404).json({ error: '찾을 수 없어요.' }));

  // 💡 express.static은 Range 요청(206 Partial Content)을 지원해서 영상 탐색(seek)이 돼요
  app.use('/videos', express.static(config.uploadDir, { fallthrough: false }));

  // HLS: 재생목록(.m3u8)은 계속 갱신되니 캐시 금지, 조각(.ts)은 한 번 만들어지면 불변
  app.use(
    '/hls', // 💡 송출 페이지 /live 와 겹치지 않게 HLS 는 /hls 아래로
    express.static(config.liveDir, {
      fallthrough: false,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.m3u8')) {
          res.setHeader('Cache-Control', 'no-cache, no-store');
          res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        }
      },
    }),
  );
  app.use(express.static(publicDir, { extensions: ['html'] }));

  app.use((err, _req, res, _next) => {
    if (err instanceof multer.MulterError) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? '파일이 너무 커요.' : err.message;
      return res.status(400).json({ error: msg });
    }
    const status = err.status ?? err.statusCode ?? 500;
    if (status >= 500) console.error(err);
    // 정적 파일 404 는 내부 경로가 담긴 ENOENT 메시지라 그대로 내보내지 않아요
    const message = status >= 500 ? '서버 오류가 발생했어요.' : status === 404 ? '찾을 수 없어요.' : err.message;
    res.status(status).json({ error: message });
  });

  return app;
}
