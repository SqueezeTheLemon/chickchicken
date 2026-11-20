import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { config } from './config.js';
import { broadcastsRouter } from './routes/broadcasts.js';

export function createApp() {
  const app = express();
  const publicDir = path.resolve('public');

  app.use('/api/broadcasts', broadcastsRouter);

  // 💡 express.static은 Range 요청(206 Partial Content)을 지원해서 영상 탐색(seek)이 돼요
  app.use('/videos', express.static(config.uploadDir, { fallthrough: false }));
  app.use(express.static(publicDir, { extensions: ['html'] }));

  app.use((err, _req, res, _next) => {
    if (err instanceof multer.MulterError) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? '파일이 너무 커요.' : err.message;
      return res.status(400).json({ error: msg });
    }
    const status = err.status ?? err.statusCode ?? 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? '서버 오류가 발생했어요.' : err.message });
  });

  return app;
}
