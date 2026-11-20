import express, { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { broadcastRepo } from '../db.js';
import { commentRepo } from '../repos/commentRepo.js';

export const commentsRouter = Router();
commentsRouter.use(express.json({ limit: '10kb' }));

const MAX_LEN = 500;

function readContent(body) {
  const content = String(body?.content ?? '').trim();
  if (!content) return { error: '댓글 내용을 입력해 주세요.' };
  if (content.length > MAX_LEN) return { error: `댓글은 ${MAX_LEN}자 이하로 입력해 주세요.` };
  return { content };
}

function findBroadcast(req, res) {
  const id = Number(req.params.id);
  const broadcast = Number.isInteger(id) ? broadcastRepo.findById(id) : undefined;
  if (!broadcast) res.status(404).json({ error: '방송을 찾을 수 없어요.' });
  return broadcast;
}

function findComment(req, res) {
  const id = Number(req.params.commentId);
  const comment = Number.isInteger(id) ? commentRepo.findById(id) : undefined;
  if (!comment) res.status(404).json({ error: '댓글을 찾을 수 없어요.' });
  return comment;
}

// 공개: 방송별 댓글 목록 (최신 300개, 오래된 순)
commentsRouter.get('/broadcasts/:id/comments', (req, res) => {
  const broadcast = findBroadcast(req, res);
  if (broadcast) res.json(commentRepo.listByBroadcast(broadcast.id));
});

// 로그인 필요: 댓글 작성
commentsRouter.post('/broadcasts/:id/comments', requireAuth, (req, res) => {
  const broadcast = findBroadcast(req, res);
  if (!broadcast) return;
  const input = readContent(req.body);
  if (input.error) return res.status(400).json({ error: input.error });
  res.status(201).json(commentRepo.create({ broadcastId: broadcast.id, userId: req.user.id, content: input.content }));
});

// 작성자만: 수정
commentsRouter.patch('/comments/:commentId', requireAuth, (req, res) => {
  const comment = findComment(req, res);
  if (!comment) return;
  if (comment.author.id !== req.user.id) return res.status(403).json({ error: '작성자만 수정할 수 있어요.' });
  const input = readContent(req.body);
  if (input.error) return res.status(400).json({ error: input.error });
  res.json(commentRepo.update(comment.id, input.content));
});

// 작성자 또는 방송 소유자(관리 목적): 삭제
commentsRouter.delete('/comments/:commentId', requireAuth, (req, res) => {
  const comment = findComment(req, res);
  if (!comment) return;
  const broadcast = broadcastRepo.findById(comment.broadcastId);
  const isAuthor = comment.author.id === req.user.id;
  const isBroadcastOwner = broadcast?.owner?.id === req.user.id;
  if (!isAuthor && !isBroadcastOwner) {
    return res.status(403).json({ error: '작성자나 방송 소유자만 삭제할 수 있어요.' });
  }
  commentRepo.delete(comment.id);
  res.status(204).end();
});
