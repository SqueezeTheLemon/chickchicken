// 화면에 넘겨줄 정보만 골라서 노출 (Node API 는 노출하지 않아요)
const { contextBridge } = require('electron');

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? '';

contextBridge.exposeInMainWorld('appInfo', {
  version: arg('cc-version'),
  defaultServerUrl: arg('cc-default-server'),
  platform: process.platform, // darwin | win32 | linux
  arch: process.arch, // arm64 | x64
});
