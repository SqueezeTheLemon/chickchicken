# chickchicken 🐔 — 치지직 만들기

| 단계 | 내용 |
| --- | --- |
| ① | 인증·인가 없는 녹화방송 (VOD 등록·목록·상세·재생) |
| **② (현재)** | **휴대폰 라이브 송출·시청**, 방송 중·종료 상태 표시 |

## 기술 스택

- **Node.js 22.13+** / Express 4
- **multer**: 녹화 영상 업로드
- **node:sqlite** (Node 내장 SQLite): 방송 정보 영속화, 별도 DB 설치 불필요
- **ws** (WebSocket): 휴대폰 → 서버 라이브 영상 전송
- **ffmpeg**: 받은 영상을 **HLS**(`.m3u8` + `.ts`)로 변환
- 프론트엔드: 빌드 없는 정적 HTML + ES Module, 라이브 재생은 [hls.js](https://github.com/video-dev/hls.js) (CDN)

## 실행 방법

### 준비물

- Node.js **22.13 이상**
- **ffmpeg**: macOS `brew install ffmpeg` / Ubuntu `sudo apt install ffmpeg`. `ffmpeg -version`으로 확인하세요.

```bash
npm install
cp .env.example .env   # 필요하면 값 수정 (없어도 기본값으로 동작)
npm start              # http://localhost:3000
```

개발 중에는 `npm run dev`로 실행하면 파일이 바뀔 때마다 서버가 자동 재시작돼요.

## 환경변수

| 이름 | 기본값 | 설명 |
| --- | --- | --- |
| `PORT` | `3000` | 서버 포트 |
| `DATA_DIR` | `./data` | SQLite DB(`chickchicken.db`), 업로드 영상(`videos/`), 라이브 HLS(`live/{id}/`) 저장 폴더 |
| `MAX_UPLOAD_MB` | `500` | 업로드 최대 크기(MB) |
| `FFMPEG_PATH` | `ffmpeg` | ffmpeg 실행 파일 경로 |
| `HLS_SEGMENT_SECONDS` | `2` | HLS 조각 길이(초) |
| `HTTPS_KEY_PATH` / `HTTPS_CERT_PATH` | (없음) | 지정하면 HTTPS로 실행돼요 (휴대폰 카메라용, 아래 참고) |

실제 비밀 값은 없어요. `.env`, `data/`, `certs/`는 `.gitignore`에 포함돼 있어요.

## 구현 범위

### ① 녹화방송 (유지)

- 제목(필수, 100자 이하), 설명(선택), 영상 파일(mp4/webm/ogg/mov)을 업로드해 등록
- 목록(`/`), 상세·재생(`/watch?id=N`, HTTP Range 지원)
- 서버를 재시작해도 등록 정보가 유지됨

### ② 휴대폰 라이브 송출·시청 (이번 단계)

- **송출 페이지 `/live`** (휴대폰)
  - 카메라·마이크 권한을 요청하고 미리보기를 보여줘요. 전면·후면 카메라를 전환할 수 있어요.
  - 제목을 입력하고 **● 방송 시작**을 누르면 송출이 시작돼요. 경과 시간이 표시되고, 방송 중에는 화면이 꺼지지 않게 막아요.
  - **■ 방송 종료**를 누르면 마지막 조각까지 보낸 뒤 종료해요.
- **시청**
  - 목록에서 `● LIVE` 카드를 선택하면 실시간으로 시청해요(HLS, 약 5~10초 지연).
  - 시청 중에 방송이 끝나면 "방송이 종료됐어요"가 표시돼요.
- **상태 구분**
  - 배지가 세 가지예요: `● LIVE`(방송 중), `종료된 라이브`, `다시보기`(업로드 영상)
  - 방송 중인 라이브가 목록 맨 위에 와요. 목록은 10초마다 자동 갱신돼요.
- **종료된 라이브는 다시보기로 재생돼요.** HLS 조각을 모두 보관해 두기 때문이에요.
- **안정성**
  - 송출 연결이 끊기면(탭 닫기, 네트워크 끊김) 자동으로 종료 처리해요. 15초 간격 ping으로 확인해요.
  - 방송을 만들고 30초 안에 송출이 시작되지 않으면 종료 처리해요.
  - 서버를 재시작하면 "방송 중"으로 남은 방송을 종료로 정리해요.
- **송출 권한**
  - 로그인이 없는 단계라서, 방송 시작 시 발급되는 `streamKey`를 아는 페이지만 송출·종료할 수 있어요.

### 이번 단계에서 하지 않은 것

- 로그인과 권한 검사, 댓글(채팅), 도네이션

## 라이브 구조

```
[휴대폰 /live]                         [서버]                                  [시청자 /watch]
getUserMedia (카메라·마이크)
  → MediaRecorder (1초 단위 webm/mp4)
  ──WebSocket /ws/ingest?id&key──▶  ffmpeg stdin
                                    → H.264/AAC 로 변환
                                    → data/live/{id}/index.m3u8 + seg_*.ts ◀── GET /hls/{id}/index.m3u8 (hls.js)
```

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| `GET` | `/api/broadcasts` | 전체 방송 목록 (방송 중인 라이브가 먼저) |
| `GET` | `/api/broadcasts/:id` | 방송 상세: `kind`(vod/live), `status`(live/ended), `videoUrl` |
| `POST` | `/api/broadcasts` | 녹화 영상 업로드 (`multipart/form-data`: `title`, `description`, `video`) |
| `POST` | `/api/lives` | 라이브 시작 (`{ title, description }`) → `{ broadcast, streamKey }` |
| `POST` | `/api/lives/:id/end` | 라이브 종료 (`{ streamKey }`) |
| `WS` | `/ws/ingest?id=N&key=…` | 송출 영상 전송 (binary) |
| `GET` | `/videos/:file`, `/hls/:id/*` | 영상 파일 / HLS 재생목록·조각 |

## 휴대폰 접속 환경 ⚠️

브라우저는 카메라·마이크(`getUserMedia`)를 **HTTPS 또는 `localhost`** 에서만 허용해요. 그래서 휴대폰에서 `http://192.168.x.x:3000`으로 접속하면 송출 페이지에 "보안 연결이 아니라서 카메라를 쓸 수 없어요"가 떠요. 아래 두 방법 중 하나를 쓰세요.

### 방법 A: 터널 (가장 간단, 다른 네트워크에서도 접속 가능)

```bash
npm start
# 다른 터미널에서 (brew install cloudflared)
cloudflared tunnel --url http://localhost:3000
```

출력된 `https://xxxx.trycloudflare.com` 주소를 휴대폰과 시청 화면 양쪽에서 열면 돼요. WebSocket도 터널을 그대로 통과해요.

### 방법 B: 같은 와이파이 + mkcert 로컬 HTTPS

```bash
brew install mkcert && mkcert -install
mkdir -p certs && mkcert -key-file certs/key.pem -cert-file certs/cert.pem <PC의 LAN IP> localhost
# .env
#   HTTPS_KEY_PATH=./certs/key.pem
#   HTTPS_CERT_PATH=./certs/cert.pem
npm start   # 콘솔에 표시되는 "LAN → https://192.168.x.x:3000" 주소로 접속
```

휴대폰이 이 인증서를 신뢰하려면 루트 인증서(`mkcert -CAROOT` 폴더의 `rootCA.pem`)를 휴대폰에 설치하고 신뢰 설정을 켜야 해요.
- iOS: 설정 → 일반 → 정보 → 인증서 신뢰 설정
- Android: 설정 → 보안 → 인증서 설치

과정이 번거로우면 방법 A를 추천해요.

### 지원 브라우저

- **Android Chrome**: webm(VP8/Opus)으로 녹화해 송출해요. 검증한 방식이에요.
- **iOS Safari 14.3+**: mp4로 녹화해 송출해요. ffmpeg가 변환해 주지만, 기기·버전에 따라 차이가 있을 수 있어요.
- **시청**: PC Chrome·Edge·Firefox는 hls.js로, Safari와 iOS는 기본 HLS로 재생해요.

## 직접 확인 절차

### ① 녹화방송

1. `npm start` → `http://localhost:3000`에 접속해서 빈 목록을 확인해요.
2. **+ 영상 등록**에서 제목을 입력하고 mp4를 올려요 → 상세 화면에서 재생되고 탐색이 되는지 확인해요.
3. 목록으로 돌아가 `다시보기` 카드가 보이는지 확인해요.
4. 서버를 재시작(`Ctrl+C` → `npm start`)해도 목록·재생이 그대로인지 확인해요.

### ② 라이브 (휴대폰 송출 → 다른 화면 시청)

1. **접속 준비**: 위 "휴대폰 접속 환경"의 방법 A 또는 B로 HTTPS 주소를 만들어요.
2. **휴대폰**: HTTPS 주소로 접속 → **📱 라이브 시작**(`/live`)을 눌러요.
3. **권한 허용**: 브라우저가 카메라·마이크 권한을 물으면 **허용**해요.
   - 실수로 거부했다면 주소창의 🔒(또는 aA) → 사이트 설정 → 카메라·마이크를 "허용"으로 바꾸고 새로고침해요.
   - 미리보기에 내 얼굴이 보이면 준비가 끝난 거예요. 🔄로 후면 카메라로 바꿀 수 있어요.
4. **송출 시작 확인**: 제목을 입력하고 **● 방송 시작**을 눌러요.
   - 휴대폰 상단에 빨간 `● LIVE 00:01`이 표시되고 시간이 올라가요.
   - 서버 콘솔에 `[live N] ingest connected`가 찍혀요.
   - `data/live/N/`에 `index.m3u8`과 `seg_00000.ts` 같은 파일이 2초마다 생겨요.
5. **다른 화면(PC 등)에서 시청**: 같은 주소의 목록(`/`)으로 들어가요. 10초 안에 맨 위에 `● LIVE` 카드가 나타나요.
   - 카드를 클릭하면 "방송 준비 중"이 잠깐 보인 뒤, 약 5~10초 늦게 휴대폰 화면과 소리가 재생돼요.
   - 휴대폰에 표시되는 시청 주소를 그대로 열어도 돼요.
6. **송출 종료 확인**: 휴대폰에서 **■ 방송 종료**를 눌러요.
   - 휴대폰에 "방송이 종료됐어요"가 표시돼요.
   - 서버 콘솔에 `[live N] ended`가 찍혀요.
   - 시청 화면은 몇 초 안에 배지가 `종료된 라이브`로 바뀌고, 남은 장면까지 재생한 뒤 멈춰요.
   - 목록의 카드도 `종료된 라이브`로 바뀌고, 클릭하면 처음부터 다시보기로 재생돼요.
7. **비정상 종료 확인**: 방송 중에 휴대폰 탭을 그냥 닫아요 → 수십 초 안에 종료 상태로 바뀌는지 확인해요.
8. **재시작 확인**: 서버를 재시작해도 종료된 라이브와 녹화방송이 목록에 남아 있고, 재생되는지 확인해요.

## 폴더 구조

```
src/
  server.js              진입점: HTTP/HTTPS 서버, WebSocket 연결, 종료 처리
  app.js                 Express 앱 조립, 정적 파일(/videos, /live), 에러 처리
  config.js              환경변수 → 설정
  db.js                  SQLite 스키마·마이그레이션 + broadcastRepo
  routes/broadcasts.js   방송 목록·상세·녹화 업로드 API
  routes/lives.js        라이브 시작·종료 API
  live/liveService.js    라이브 세션 관리, ffmpeg → HLS 변환
  live/ingest.js         송출 WebSocket(/ws/ingest) 수신, 하트비트
public/
  index.html             방송 목록 (상태 배지, 자동 갱신)
  watch.html             상세·재생 (VOD / HLS 라이브)
  live.html              휴대폰 송출
  upload.html            녹화 영상 등록
  app.js, style.css      공통 유틸·스타일
```
