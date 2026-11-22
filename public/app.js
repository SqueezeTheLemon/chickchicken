// 💡 공통 유틸: 여러 페이지가 함께 써요

export async function api(path, options) {
  const res = await fetch(`/api${path}`, options);
  const body = res.status === 204 ? {} : await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error ?? `요청 실패 (${res.status})`), { status: res.status });
  return body;
}

/** JSON 바디로 보내는 요청 (POST/PATCH/DELETE) */
export const send = (method, path, body) =>
  api(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

// 서버는 ISO 시각(UTC, 'Z')으로 보내요 → 브라우저 시간대로 보여줘요
export const formatDate = (s) => new Date(s).toLocaleString('ko-KR');

export const formatSize = (bytes) =>
  bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

// XSS 방지: 사용자 입력은 항상 textContent로 넣기
export function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

// 방송 상태 배지: 방송 중 / 종료된 라이브 / 업로드한 다시보기
export function statusBadge(b) {
  if (b.kind === 'live' && b.status === 'live') return el('span', { className: 'badge live', textContent: '● LIVE' });
  if (b.kind === 'live') return el('span', { className: 'badge ended', textContent: '종료된 라이브' });
  return el('span', { className: 'badge', textContent: '다시보기' });
}

// ---------- 3단계: 로그인 상태 ----------

let mePromise;
/** 현재 로그인 사용자 (없으면 null). 페이지당 한 번만 요청해요 */
export function getMe() {
  mePromise ??= api('/auth/me').then((r) => r.user).catch(() => null);
  return mePromise;
}

const currentPath = () => location.pathname + location.search;

/** 로그인 후 돌아갈 주소: 같은 사이트 경로만 허용 (//evil.com 같은 오픈 리다이렉트 방지) */
export function safeNext() {
  const next = new URLSearchParams(location.search).get('next') ?? '/';
  return next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

export const loginUrl = () => `/login?next=${encodeURIComponent(currentPath())}`;

/**
 * 로그인이 필요한 페이지에서 호출 → 비로그인이면 로그인 페이지로 보내요.
 * 💡 이건 편의 기능일 뿐! 진짜 막는 건 서버의 requireAuth 예요.
 */
export async function requireLogin() {
  const me = await getMe();
  if (!me) location.replace(loginUrl());
  return me;
}

/** <header id="site-header"> 를 로그인 상태에 맞게 채워요 */
export async function mountHeader() {
  const header = document.getElementById('site-header');
  const me = await getMe();
  const nav = el('nav', { className: 'row' });
  nav.append(el('a', { className: 'btn ghost', href: '/download', textContent: '⬇️ 앱 다운로드' })); // 6단계

  if (me) {
    const logout = el('button', { className: 'btn ghost', type: 'button', textContent: '로그아웃' });
    logout.onclick = async () => {
      await send('POST', '/auth/logout').catch(() => {});
      location.href = '/';
    };
    nav.append(
      el('a', { className: 'btn ghost', href: '/live', textContent: '📱 라이브 시작' }),
      el('a', { className: 'btn', href: '/upload', textContent: '+ 영상 등록' }),
      el('span', { className: 'who', textContent: `${me.nickname}님` }),
      logout,
    );
  } else {
    nav.append(
      el('a', { className: 'btn ghost', href: loginUrl(), textContent: '로그인' }),
      el('a', { className: 'btn', href: `/signup?next=${encodeURIComponent(currentPath())}`, textContent: '회원가입' }),
    );
  }
  header.replaceChildren(el('a', { className: 'logo', href: '/', textContent: 'chickchicken' }), nav);
  return me;
}
