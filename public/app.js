// 💡 공통 유틸: 세 페이지가 함께 써요

export async function api(path, options) {
  const res = await fetch(`/api${path}`, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `요청 실패 (${res.status})`);
  return body;
}

// SQLite datetime('now')는 UTC라서 'Z'를 붙여 로컬 시간으로 보여줘요
export const formatDate = (s) => new Date(`${s.replace(' ', 'T')}Z`).toLocaleString('ko-KR');

export const formatSize = (bytes) =>
  bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

// XSS 방지: 사용자 입력은 항상 textContent로 넣기
export function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}
