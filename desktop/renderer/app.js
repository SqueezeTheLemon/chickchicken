// Chickchicken 데스크톱 클라이언트 — 화면
// 배포한 백엔드의 공개 API 로 방송 목록을 받고, VOD(mp4)·라이브(HLS)를 재생해요.
//   GET {server}/api/broadcasts       → 목록
//   GET {server}/api/broadcasts/:id   → 상세 (videoUrl: /videos/... 또는 /hls/:id/index.m3u8)
// 💡 서버는 이 공개 조회 경로에만 CORS 를 열어 둬요 (로그인 쿠키 없이 조회 전용)
'use strict';

const info = window.appInfo ?? { version: 'dev', defaultServerUrl: 'http://localhost:3000', platform: '?', arch: '?' };
const STORAGE_KEY = 'chickchicken.serverUrl';
const $ = (id) => document.getElementById(id);

let hls = null;
let livePoll = null;

// ---------- 서버 주소 ----------
const normalize = (url) => url.trim().replace(/\/+$/, '');
function getServer() {
  try {
    return localStorage.getItem(STORAGE_KEY) || normalize(info.defaultServerUrl);
  } catch {
    return normalize(info.defaultServerUrl);
  }
}
function setServer(url) {
  try {
    if (url) localStorage.setItem(STORAGE_KEY, normalize(url));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* 저장 실패해도 이번 실행에는 반영 */
  }
  renderServerLabel();
}
const abs = (p) => (/^https?:\/\//.test(p) ? p : getServer() + p);

async function api(path) {
  const res = await fetch(abs(`/api${path}`), { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`서버 응답 ${res.status}`);
  return res.json();
}

// ---------- 공통 ----------
function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props); // 서버 문자열은 textContent 로만 (XSS 방지)
  node.append(...children);
  return node;
}
const formatDate = (s) => (s ? new Date(s).toLocaleString('ko-KR') : '');
function badge(b) {
  if (b.kind === 'live' && b.status === 'live') return el('span', { className: 'badge live', textContent: '● LIVE' });
  if (b.kind === 'live') return el('span', { className: 'badge ended', textContent: '종료된 라이브' });
  return el('span', { className: 'badge', textContent: '다시보기' });
}
function renderServerLabel() {
  $('server-label').textContent = getServer().replace(/^https?:\/\//, '');
}

// ---------- 목록 ----------
async function loadList() {
  const status = $('status');
  status.className = 'status';
  status.textContent = '불러오는 중…';
  status.hidden = false;
  try {
    const list = await api('/broadcasts');
    $('grid').replaceChildren(...list.map(card));
    if (list.length) status.hidden = true;
    else status.textContent = '아직 방송이 없어요.';
  } catch (e) {
    $('grid').replaceChildren();
    status.className = 'status error';
    status.textContent = `방송 목록을 불러오지 못했어요 (${e.message}). ⚙️ 서버 설정에서 주소를 확인해 주세요: ${getServer()}`;
  }
}

function card(b) {
  const thumb = el('div', { className: 'thumb' });
  if (b.kind === 'vod') {
    thumb.append(el('video', { src: `${abs(b.videoUrl)}#t=1`, preload: 'metadata', muted: true }));
  } else {
    thumb.append(el('div', { className: `live-thumb ${b.status}`, textContent: b.status === 'live' ? '📡 ON AIR' : '📼 LIVE 다시보기' }));
  }
  const tag = badge(b);
  tag.classList.add('corner');
  thumb.append(tag);
  const c = el('button', { className: 'card', type: 'button' },
    thumb,
    el('div', { className: 'title', textContent: b.title }),
    el('div', { className: 'meta', textContent: `${b.owner?.nickname ?? '알 수 없음'} · ${formatDate(b.createdAt)}` }),
  );
  c.onclick = () => openPlayer(b.id);
  return c;
}

// ---------- 재생 ----------
function stopPlayback() {
  if (hls) {
    hls.destroy();
    hls = null;
  }
  clearInterval(livePoll);
  livePoll = null;
  const v = $('video');
  v.pause();
  v.removeAttribute('src');
  v.load();
}

function showOverlay(text) {
  $('overlay').hidden = !text;
  $('overlay').textContent = text ?? '';
}

async function openPlayer(id) {
  stopPlayback();
  $('list-view').hidden = true;
  $('player-view').hidden = false;
  $('title').textContent = '불러오는 중…';
  $('meta').textContent = '';
  $('notice').textContent = '';
  $('desc').textContent = '';
  showOverlay('');

  let b;
  try {
    b = await api(`/broadcasts/${id}`);
  } catch (e) {
    $('title').textContent = '방송을 불러오지 못했어요';
    $('meta').textContent = e.message;
    return;
  }
  $('title').replaceChildren(badge(b), ' ', b.title);
  $('meta').textContent = `${b.owner?.nickname ?? '알 수 없음'} · ${formatDate(b.createdAt)}${b.endedAt ? ` ~ ${formatDate(b.endedAt)}` : ''}`;
  $('desc').textContent = b.description || '';
  $('open-web').href = `${getServer()}/watch?id=${b.id}`;

  const video = $('video');
  const src = abs(b.videoUrl);
  if (b.kind === 'vod') {
    video.src = src; // mp4 는 <video> 로 바로 재생 (Range 요청으로 탐색)
    video.play().catch(() => {});
    return;
  }

  // 라이브(HLS): 재생목록이 생길 때까지 기다렸다가 hls.js 로 재생
  for (let i = 0; i < 40; i++) {
    const ok = await fetch(src, { method: 'HEAD', cache: 'no-store' }).then((r) => r.ok).catch(() => false);
    if (ok) break;
    if (b.status === 'ended') return showOverlay('송출된 영상이 없는 방송이에요.');
    showOverlay('방송 준비 중이에요…');
    await new Promise((r) => setTimeout(r, 3000));
    if ($('player-view').hidden) return; // 그 사이 목록으로 돌아감
  }
  showOverlay('');
  if (window.Hls?.isSupported()) {
    hls = new window.Hls({ manifestLoadingMaxRetry: 6, levelLoadingMaxRetry: 6 });
    hls.loadSource(src);
    hls.attachMedia(video);
    hls.on(window.Hls.Events.ERROR, (_e, data) => {
      if (data.fatal) showOverlay(`재생 오류: ${data.details}`);
    });
  } else {
    video.src = src;
  }
  video.play().catch(() => {});

  if (b.status === 'live') {
    $('notice').textContent = '실시간 방송 중이에요. (HLS 특성상 5~10초 지연될 수 있어요)';
    livePoll = setInterval(async () => {
      const cur = await api(`/broadcasts/${b.id}`).catch(() => null);
      if (cur && cur.status !== 'live') {
        clearInterval(livePoll);
        $('title').replaceChildren(badge(cur), ' ', cur.title);
        $('notice').textContent = '방송이 종료됐어요. 마지막 장면까지 재생된 뒤 멈춰요.';
      }
    }, 3000);
  } else {
    $('notice').textContent = '종료된 라이브예요. 다시보기로 재생하고 있어요.';
  }
}

function backToList() {
  stopPlayback();
  $('player-view').hidden = true;
  $('list-view').hidden = false;
  loadList();
}

// ---------- 설정 ----------
async function testServer(url) {
  const msg = $('settings-msg');
  msg.textContent = '확인 중…';
  try {
    const res = await fetch(`${normalize(url)}/api/health`, { signal: AbortSignal.timeout(8000) });
    const h = await res.json();
    msg.textContent = res.ok ? `✅ 연결됨 — 서버 v${h.version} (${h.commit}), DB ${h.db}` : `⚠️ 서버 상태: ${h.status}`;
    return res.ok;
  } catch (e) {
    msg.textContent = `❌ 연결 실패: ${e.message}`;
    return false;
  }
}

$('open-settings').onclick = () => {
  $('server-input').value = getServer();
  $('settings-msg').textContent = '';
  $('settings').showModal();
};
$('test-server').onclick = () => testServer($('server-input').value);
$('reset-server').onclick = () => {
  $('server-input').value = normalize(info.defaultServerUrl);
};
$('settings').addEventListener('close', () => {
  if ($('settings').returnValue === 'save' && $('server-input').value) {
    setServer($('server-input').value === normalize(info.defaultServerUrl) ? '' : $('server-input').value);
    backToList();
  }
});
$('refresh').onclick = () => ($('player-view').hidden ? loadList() : null);
$('back').onclick = backToList;

// ---------- 시작 ----------
$('footer').textContent = `Chickchicken Desktop v${info.version} · ${info.platform}/${info.arch}`;
renderServerLabel();
loadList();
