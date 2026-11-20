import { config } from '../config.js';
import { broadcastRepo } from '../db.js';
import { sessionRepo } from '../repos/sessionRepo.js';

/** "a=1; b=2" → { a: '1', b: '2' } */
export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    try {
      out[key] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      /* 잘못된 쿠키는 무시 */
    }
  }
  return out;
}

export const sessionTokenFrom = (cookieHeader) => parseCookies(cookieHeader)[config.sessionCookieName];

/** 쿠키 헤더 → 로그인 사용자 (HTTP 요청과 WebSocket upgrade 에서 같이 써요) */
export const userFromCookieHeader = (cookieHeader) => sessionRepo.findUser(sessionTokenFrom(cookieHeader));

/** 모든 요청: 로그인 상태면 req.user 를 채워요 (비로그인이면 undefined, 막지는 않음) */
export function loadUser(req, _res, next) {
  req.user = userFromCookieHeader(req.headers.cookie);
  next();
}

/** 로그인 필수 → 아니면 401 */
export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: '로그인이 필요해요.' });
  next();
}

/**
 * :id 방송의 소유자만 통과 → req.broadcast 에 담아줘요
 * 💡 순서가 중요해요: 없으면 404 → 로그인 안 했으면 401 → 남의 방송이면 403
 *    (requireAuth 뒤에 붙여서 쓰세요)
 */
export function requireBroadcastOwner(req, res, next) {
  const id = Number(req.params.id);
  const broadcast = Number.isInteger(id) ? broadcastRepo.findById(id) : undefined;
  if (!broadcast) return res.status(404).json({ error: '방송을 찾을 수 없어요.' });
  if (broadcast.owner?.id !== req.user.id) {
    return res.status(403).json({ error: '방송 소유자만 할 수 있어요.' });
  }
  req.broadcast = broadcast;
  next();
}
