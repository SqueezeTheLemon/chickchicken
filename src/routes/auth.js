import express, { Router } from 'express';
import { config } from '../config.js';
import { asyncHandler } from '../asyncHandler.js';
import { DUMMY_HASH, hashPassword, verifyPassword } from '../auth/passwords.js';
import { sessionTokenFrom } from '../auth/middleware.js';
import { sessionRepo } from '../repos/sessionRepo.js';
import { userRepo } from '../repos/userRepo.js';

export const authRouter = Router();
authRouter.use(express.json({ limit: '10kb' }));

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

// 💡 HttpOnly: JS 에서 못 읽음(XSS 로 토큰 탈취 방지) / SameSite=Lax: 다른 사이트의 POST·WebSocket 에 안 붙음(CSRF 완화)
const cookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: config.cookieSecure,
  path: '/',
  maxAge: config.sessionTtlHours * 60 * 60 * 1000,
});

async function startSession(res, user) {
  const token = await sessionRepo.create(user.id, config.sessionTtlHours);
  res.cookie(config.sessionCookieName, token, cookieOptions());
}

authRouter.post('/signup', asyncHandler(async (req, res) => {
  const username = String(req.body?.username ?? '').trim();
  const nickname = String(req.body?.nickname ?? '').trim();
  const password = String(req.body?.password ?? '');

  if (!USERNAME_RE.test(username)) return res.status(400).json({ error: '아이디는 영문·숫자·_ 3~20자로 입력해 주세요.' });
  if (!nickname || nickname.length > 20) return res.status(400).json({ error: '닉네임은 1~20자로 입력해 주세요.' });
  if (password.length < 8 || password.length > 72) return res.status(400).json({ error: '비밀번호는 8~72자로 입력해 주세요.' });
  if (await userRepo.existsByUsername(username)) return res.status(409).json({ error: '이미 사용 중인 아이디예요.' });

  let user;
  try {
    user = await userRepo.create({ username, nickname, passwordHash: await hashPassword(password) });
  } catch (e) {
    // 동시에 같은 아이디로 가입하면 유니크 인덱스가 막아줘요 (23505 = unique_violation)
    if (e.code === '23505') return res.status(409).json({ error: '이미 사용 중인 아이디예요.' });
    throw e;
  }
  await startSession(res, user); // 가입하면 바로 로그인
  res.status(201).json({ user });
}));

authRouter.post('/login', asyncHandler(async (req, res) => {
  const username = String(req.body?.username ?? '').trim();
  const password = String(req.body?.password ?? '');

  const row = await userRepo.findCredentials(username);
  // 아이디가 없어도 해시 비교를 똑같이 해서, 응답 시간으로 "아이디 존재 여부"를 알 수 없게 해요
  const ok = await verifyPassword(password, row?.password_hash ?? DUMMY_HASH);
  if (!row || !ok) return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않아요.' });

  await startSession(res, row);
  res.json({ user: await userRepo.findById(row.id) });
}));

authRouter.post('/logout', asyncHandler(async (req, res) => {
  await sessionRepo.delete(sessionTokenFrom(req.headers.cookie)); // 서버에서 세션을 지워야 진짜 로그아웃
  res.clearCookie(config.sessionCookieName, { ...cookieOptions(), maxAge: undefined });
  res.status(204).end();
}));

// 현재 로그인 사용자 (비로그인이면 user: null — 화면이 콘솔 에러 없이 상태를 알 수 있게 200)
authRouter.get('/me', (req, res) => {
  res.json({ user: req.user ?? null });
});
