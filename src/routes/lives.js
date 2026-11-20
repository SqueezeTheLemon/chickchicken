import express, { Router } from 'express';
import { liveService } from '../live/liveService.js';

export const livesRouter = Router();
livesRouter.use(express.json({ limit: '10kb' }));

// 라이브 시작: 방송을 만들고 송출용 streamKey 를 돌려줘요 (송출 페이지만 알고 있어요)
livesRouter.post('/', (req, res) => {
  const title = String(req.body?.title ?? '').trim();
  const description = String(req.body?.description ?? '').trim();
  if (!title) return res.status(400).json({ error: '제목(title)이 필요해요.' });
  if (title.length > 100) return res.status(400).json({ error: '제목은 100자 이하로 입력해 주세요.' });

  const { broadcast, streamKey } = liveService.start({ title, description });
  res.status(201).json({ broadcast, streamKey });
});

// 라이브 종료
livesRouter.post('/:id/end', (req, res) => {
  const result = liveService.end(Number(req.params.id), String(req.body?.streamKey ?? ''));
  const status = { ok: 200, 'already-ended': 200, forbidden: 403, 'not-found': 404 }[result];
  res.status(status).json({ result });
});
