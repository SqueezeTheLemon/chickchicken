import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { broadcastRepo } from '../db.js';

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

export const broadcastsRouter = Router();

broadcastsRouter.get('/', (_req, res) => {
  res.json(broadcastRepo.findAll());
});

broadcastsRouter.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  const broadcast = Number.isInteger(id) ? broadcastRepo.findById(id) : undefined;
  if (!broadcast) return res.status(404).json({ error: '방송을 찾을 수 없어요.' });
  res.json(broadcast);
});

broadcastsRouter.post('/', upload.single('video'), (req, res) => {
  const title = (req.body.title ?? '').trim();
  const description = (req.body.description ?? '').trim();

  const fail = (msg) => {
    if (req.file) fs.rmSync(req.file.path, { force: true }); // 고아 파일 정리
    res.status(400).json({ error: msg });
  };

  if (!req.file) return fail('영상 파일(video)이 필요해요.');
  if (!title) return fail('제목(title)이 필요해요.');
  if (title.length > 100) return fail('제목은 100자 이하로 입력해 주세요.');

  const broadcast = broadcastRepo.create({
    title,
    description,
    videoPath: req.file.filename,
    mimeType: req.file.mimetype,
    sizeBytes: req.file.size,
  });
  res.status(201).json(broadcast);
});
