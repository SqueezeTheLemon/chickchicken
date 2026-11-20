import express, { Router } from 'express';
import { asyncHandler } from '../asyncHandler.js';
import { requireAuth, requireBroadcastOwner } from '../auth/middleware.js';
import { liveService } from '../live/liveService.js';

export const livesRouter = Router();
livesRouter.use(express.json({ limit: '10kb' }));

// 라이브 시작 (로그인 필요): 방송을 만들고 송출용 streamKey 를 돌려줘요
livesRouter.post('/', requireAuth, asyncHandler(async (req, res) => {
  const title = String(req.body?.title ?? '').trim();
  const description = String(req.body?.description ?? '').trim();
  if (!title) return res.status(400).json({ error: '제목(title)이 필요해요.' });
  if (title.length > 100) return res.status(400).json({ error: '제목은 100자 이하로 입력해 주세요.' });

  const { broadcast, streamKey } = await liveService.start({ title, description, ownerId: req.user.id });
  res.status(201).json({ broadcast, streamKey });
}));

// 라이브 종료 (소유자만)
livesRouter.post('/:id/end', requireAuth, requireBroadcastOwner, asyncHandler(async (req, res) => {
  if (req.broadcast.kind !== 'live') return res.status(400).json({ error: '라이브 방송이 아니에요.' });
  const wasLive = await liveService.end(req.broadcast.id);
  res.json({ result: wasLive ? 'ok' : 'already-ended' });
}));
