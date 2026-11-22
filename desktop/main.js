// Chickchicken 데스크톱 클라이언트 — 메인 프로세스
// 💡 화면(renderer)은 Node 권한 없이 격리해서 실행하고(contextIsolation + sandbox),
//    필요한 정보(앱 버전·기본 서버 주소)만 preload 로 넘겨줘요.
const { app, BrowserWindow, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

// 기본 서버 주소: config.json (빌드할 때 CI 가 배포 도메인으로 바꿔 넣을 수 있어요) → 환경변수로 덮어쓰기 가능
function readDefaultServerUrl() {
  if (process.env.CHICKCHICKEN_SERVER_URL) return process.env.CHICKCHICKEN_SERVER_URL;
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8')).defaultServerUrl;
  } catch {
    return 'http://localhost:3000';
  }
}

// 하나만 실행 (이미 켜져 있으면 그 창을 앞으로)
if (!app.requestSingleInstanceLock()) app.quit();

let win;
function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 520,
    backgroundColor: '#0e0f11',
    title: 'Chickchicken',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [
        `--cc-default-server=${readDefaultServerUrl()}`,
        `--cc-version=${app.getVersion()}`,
      ],
    },
  });
  win.removeMenu?.(); // Windows 기본 메뉴바 숨김
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // 링크(웹에서 보기 등)는 앱 안이 아니라 기본 브라우저로 열어요
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) {
      e.preventDefault();
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
    }
  });
}

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});
app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
