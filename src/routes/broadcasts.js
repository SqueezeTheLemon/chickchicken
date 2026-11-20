import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { Router } from 'express';
import multer from 'multer';
import { asyncHandler } from '../asyncHandler.js';
import { requireAuth, requireBroadcastOwner } from '../auth/middleware.js';
import { config } from '../config.js';
import { broadcastRepo } from '../db.js';
import { liveDirOf, liveService } from '../live/liveService.js';

fs.mkdirSync(config.uploadDir, { recursive: true });

const ALLOWED_MIME = new Set(['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime']);

// 💡 원본 파일명은 믿지 않고, 랜덤 이름 + 확장자로 저장해요 (경로 조작 방지)
const upload = multer({
  storage: multer.diskStorage({
    destination: config.uploadDir,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '');
      cb(null, `${Date.now()}-${crypto.randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: config.maxUploadBytes },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) return cb(null, true);
    cb(Object.assign(new Error('mp4 / webm / ogg / mov 영상만 업로드할 수 있어요.'), { status: 400 }));
  },
});

function readTitleAndDescription(body) {
  const title = String(body?.title ?? '').trim();
  const description = String(body?.description ?? '').trim();
  if (!title) return { error: '제목(title)이 필요해요.' };
  if (title.length > 100) return { error: '제목은 100자 이하로 입력해 주세요.' };
  if (description.length > 2000) return { error: '설명은 2000자 이하로 입력해 주세요.' };
  return { title, description };
}

export const broadcastsRouter = Router();

// ---- 공개: 목록·상세 ----
broadcastsRouter.get('/', asyncHandler(async (_req, res) => {
  res.json(await broadcastRepo.findAll());
}));

broadcastsRouter.get('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const broadcast = Number.isInteger(id) ? await broadcastRepo.findById(id) : undefined;
  if (!broadcast) return res.status(404).json({ error: '방송을 찾을 수 없어요.' });
  res.json(broadcast);
}));

// ---- 로그인 필요: 녹화 영상 등록 ----
// 💡 requireAuth 를 multer 보다 앞에 둬서, 비로그인 요청은 파일을 디스크에 쓰기 전에 거절해요
broadcastsRouter.post('/', requireAuth, upload.single('video'), asyncHandler(async (req, res) => {
  const fail = (msg) => {
    if (req.file) fs.rmSync(req.file.path, { force: true }); // 고아 파일 정리
    res.status(400).json({ error: msg });
  };

  if (!req.file) return fail('영상 파일(video)이 필요해요.');
  const input = readTitleAndDescription(req.body);
  if (input.error) return fail(input.error);

  const broadcast = await broadcastRepo.create({
    ...input,
    videoPath: req.file.filename,
    mimeType: req.file.mimetype,
    sizeBytes: req.file.size,
    ownerId: req.user.id,
  });
  res.status(201).json(broadcast);
}));

// ---- 소유자만: 수정·삭제 ----
broadcastsRouter.patch('/:id', express.json({ limit: '10kb' }), requireAuth, requireBroadcastOwner, asyncHandler(async (req, res) => {
  const input = readTitleAndDescription(req.body);
  if (input.error) return res.status(400).json({ error: input.error });
  res.json(await broadcastRepo.update(req.broadcast.id, input));
}));

broadcastsRouter.delete(
  '/:id',
  requireAuth,
  requireBroadcastOwner,
  asyncHandler(async (req, res) => {
    const { id, kind } = req.broadcast;
    const raw = await broadcastRepo.findRawById(id);

    if (kind === 'live') {
      // 방송 중이면 송출을 먼저 끝내고(다른 인스턴스가 맡고 있어도 종료될 때까지 기다림) 파일을 지워요
      await liveService.end(id);
      fs.rmSync(liveDirOf(id), { recursive: true, force: true });
    } else {
      // basename: DB 값이 이상해도 uploadDir 밖은 절대 지우지 않게
      fs.rmSync(path.join(config.uploadDir, path.basename(raw.video_path)), { force: true });
    }
    await broadcastRepo.delete(id); // 댓글은 ON DELETE CASCADE 로 함께 삭제
    res.status(204).end();
  }),
);
