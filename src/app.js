import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { loadUser } from './auth/middleware.js';
import { config } from './config.js';
import { pool } from './db.js';
import { authRouter } from './routes/auth.js';
import { broadcastsRouter } from './routes/broadcasts.js';
import { commentsRouter } from './routes/comments.js';
import { donationsRouter } from './routes/donations.js';
import { paymentGateway } from './payments/index.js';
import { mockPayRouter } from './payments/mockRoutes.js';
import { livesRouter } from './routes/lives.js';

const VERSION = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')).version;
const startedAt = new Date();

// 💡 6단계: 데스크톱 클라이언트(다른 출처)가 쓰는 "공개 조회" 경로만 CORS 허용
//    쿠키(로그인)는 허용하지 않아요(Allow-Credentials 없음) → 조회 전용이라 안전해요
const CORS_PUBLIC_PATHS = [/^\/api\/broadcasts(\/\d+(\/(comments|donations))?)?$/, /^\/api\/health$/, /^\/hls\//, /^\/videos\//];

export function createApp(state = { draining: false }) {
  const app = express();
  const publicDir = path.resolve('public');
  app.set('trust proxy', config.trustProxy); // Caddy 뒤: 실제 프로토콜(https)·클라이언트 IP

  // 5단계: 어느 인스턴스가 응답했는지 보이게 (부하 분산 확인용)
  app.use((_req, res, next) => {
    res.setHeader('X-Instance', config.instanceId);
    next();
  });

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (!origin || !['GET', 'HEAD', 'OPTIONS'].includes(req.method) || !CORS_PUBLIC_PATHS.some((re) => re.test(req.path))) {
      return next();
    }
    const allowAll = config.corsPublicOrigins.includes('*');
    if (allowAll || config.corsPublicOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', allowAll ? '*' : origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Range');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, X-Instance');
      if (!allowAll) res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });

  // 5단계: 쿠버네티스 헬스체크
  //   /healthz: 프로세스가 살아 있는지 (liveness)  /readyz: DB 연결 OK + 종료 중 아님 → 트래픽 받아도 됨 (readiness)
  app.get('/healthz', (_req, res) => res.json({ ok: true, instance: config.instanceId }));
  app.get('/readyz', async (_req, res) => {
    if (state.draining) return res.status(503).json({ ok: false, reason: 'draining' });
    try {
      await pool.query('SELECT 1');
      res.json({ ok: true, instance: config.instanceId });
    } catch {
      res.status(503).json({ ok: false, reason: 'db' });
    }
  });
  // 6단계: 배포 상태 확인 (사람·모니터링용) — 버전·커밋·DB·업타임. 비밀 값은 넣지 않아요
  app.get('/api/health', async (_req, res) => {
    let db = 'ok';
    try {
      await pool.query('SELECT 1');
    } catch {
      db = 'down';
    }
    res.status(db === 'ok' && !state.draining ? 200 : 503).json({
      status: db === 'ok' && !state.draining ? 'ok' : 'degraded',
      version: VERSION,
      commit: config.gitSha,
      db,
      payment: paymentGateway.name,
      instance: config.instanceId,
      publicBaseUrl: config.publicBaseUrl || null,
      startedAt: startedAt.toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
    });
  });
  app.get('/api/instance', (_req, res) => res.json({ instance: config.instanceId }));

  // 💡 모든 API 요청에서 쿠키 → req.user (비로그인이면 undefined). 막는 건 각 라우트의 requireAuth 몫
  app.use('/api', loadUser);
  app.use('/api/auth', authRouter);
  app.use('/api', commentsRouter); // /api/broadcasts/:id/comments, /api/comments/:commentId
  app.use('/api', donationsRouter); // /api/broadcasts/:id/donations, /api/donations/*, /api/payments/*
  app.use('/api/broadcasts', broadcastsRouter);
  app.use('/api/lives', livesRouter);
  app.use('/api', (_req, res) => res.status(404).json({ error: '찾을 수 없어요.' }));

  // 모의 결제창은 mock 모드에서만 존재해요 (토스 모드에선 404)
  if (paymentGateway.name === 'mock') app.use(mockPayRouter);

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
    res.status(status).json({ error: message, ...(status < 500 && err.code ? { code: err.code } : {}) });
  });

  return app;
}
