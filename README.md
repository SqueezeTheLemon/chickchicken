# chickchicken 🐔 — 치지직 만들기

| 단계 | 내용 |
| --- | --- |
| ① | 인증·인가 없는 녹화방송 (VOD 등록·목록·상세·재생) |
| ② | 휴대폰 라이브 송출·시청, 방송 중·종료 상태 표시 |
| **③ (현재)** | **회원가입·로그인·로그아웃, 방송 소유자 권한 검사, 댓글** |

## 기술 스택

- **Node.js 22.13+** / Express 4
- **multer**: 녹화 영상 업로드
- **node:sqlite** (Node 내장 SQLite): 사용자·세션·방송·댓글 영속화, 별도 DB 설치 불필요
- **ws** (WebSocket): 휴대폰 → 서버 라이브 영상 전송
- **ffmpeg**: 받은 영상을 **HLS**(`.m3u8` + `.ts`)로 변환
- **인증**: 서버 세션 + `HttpOnly` 쿠키, 비밀번호는 Node 내장 `crypto.scrypt` 해시 (추가 라이브러리 없음)
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
| `SESSION_TTL_HOURS` | `168` | 로그인 유지 시간(시간 단위, 기본 7일) |
| `COOKIE_SECURE` | `false` | `true`면 세션 쿠키에 `Secure`를 붙여요. HTTPS로 서비스할 때 켜요. `HTTPS_KEY_PATH`를 쓰면 자동으로 켜져요 |

비밀 값(세션 서명 키 등)이 필요 없는 구조예요. 세션 토큰은 서버가 랜덤으로 만들고, DB에는 해시만 저장해요. `.env`, `data/`, `certs/`는 `.gitignore`에 포함돼 있어요.

## 구현 범위

### ① 녹화방송 (유지)

- 제목(필수, 100자 이하), 설명(선택), 영상 파일(mp4/webm/ogg/mov)을 업로드해 등록
- 목록(`/`), 상세·재생(`/watch?id=N`, HTTP Range 지원)
- 서버를 재시작해도 등록 정보가 유지됨

### ② 휴대폰 라이브 송출·시청 (유지)

- **송출 페이지 `/live`** (휴대폰): 카메라·마이크 미리보기, 전면·후면 전환, **● 방송 시작** / **■ 방송 종료**
- **시청**: 목록에서 `● LIVE` 카드를 선택하면 HLS로 실시간 시청해요(약 5~10초 지연). 방송이 끝나면 종료가 표시돼요.
- **상태 구분**: `● LIVE`(방송 중), `종료된 라이브`, `다시보기`(업로드 영상). 방송 중인 라이브가 목록 맨 위에 와요.
- 종료된 라이브는 다시보기로 재생돼요.
- 연결 끊김, 30초 안에 송출 미시작, 서버 재시작 시 자동으로 종료 처리해요.

### ③ 인증·인가 + 댓글 (이번 단계)

- **회원가입·로그인·로그아웃** (`/signup`, `/login`, 헤더의 로그아웃 버튼)
  - 아이디: 영문·숫자·_ 3~20자, 대소문자 구분 없이 유일
  - 비밀번호: 8~72자, **scrypt + 사용자별 salt**로 해시해서 저장
  - 가입하면 바로 로그인돼요.
  - 로그인에 실패하면 "아이디 또는 비밀번호가 올바르지 않아요"만 보여줘요. 아이디가 있는지 없는지 알려주지 않아요. 응답 시간으로도 알 수 없게 했어요.
  - 세션 토큰은 `cc_session` 쿠키(`HttpOnly`, `SameSite=Lax`)에 넣고, DB에는 **SHA-256 해시만** 저장해요.
  - 로그아웃하면 **서버에서 세션 행을 지워서**, 같은 쿠키를 다시 써도 바로 무효예요.
- **방송 소유자**
  - 방송을 등록하거나 라이브를 시작한 사용자가 소유자(`owner_id`)예요.
  - ①·②단계에서 만든 방송은 소유자가 없어요. 목록에 "알 수 없음"으로 보이고, **아무도 수정·삭제할 수 없어요.**
- **서버 권한 검사** (화면 버튼 숨김과 별개로 **모든 요청을 서버가 검사**해요)
  - 녹화 업로드: 로그인이 필요해요. 업로드 처리(multer)보다 **먼저** 검사해서, 비로그인 요청의 파일은 디스크에 아예 저장되지 않아요.
  - 라이브 시작: 로그인이 필요해요.
  - 수정·삭제·라이브 종료: **소유자만** 할 수 있어요.
  - **송출 WebSocket**(`/ws/ingest`): 연결 요청 단계에서 ① 로그인 쿠키(401) ② 방송 소유자(403) ③ 이번 송출 세션의 `streamKey`(403)를 차례로 검사해요.
  - 방송 중인 라이브를 삭제하면 송출을 먼저 끝내고(ffmpeg 종료까지 기다림) HLS 파일, DB 행, 댓글을 함께 지워요.
- **댓글**
  - 방송별 목록(최신 300개, 오래된 순)은 3초마다 자동 갱신돼요. 라이브 중에는 채팅처럼 써요.
  - 작성: 로그인 필요, 1~500자
  - 수정: **작성자만**
  - 삭제: **작성자 또는 방송 소유자**(관리 목적)
  - 방송 소유자가 쓴 댓글에는 `방송인` 배지가 붙어요.
  - 방송을 삭제하면 댓글도 함께 지워져요(`ON DELETE CASCADE`).

### 이번 단계에서 하지 않은 것

- 도네이션, 비밀번호 변경·탈퇴, 로그인 시도 횟수 제한(rate limit)

## 공개 범위

| 기능 | 비로그인 | 로그인 |
| --- | --- | --- |
| 방송 목록 조회 (`/`, `GET /api/broadcasts`) | ✅ 공개 | ✅ |
| 방송 상세·시청 (`/watch`, VOD·HLS 파일) | ✅ 공개 | ✅ |
| 댓글 목록 조회 | ✅ 공개 | ✅ |
| 녹화 등록, 라이브 시작 | ❌ 401 | ✅ |
| 댓글 작성 | ❌ 401 | ✅ |
| 방송 수정·삭제·라이브 종료·송출 | ❌ 401 | 소유자만 ✅ (그 외 403) |
| 댓글 수정 | ❌ 401 | 작성자만 ✅ (그 외 403) |
| 댓글 삭제 | ❌ 401 | 작성자 또는 방송 소유자 ✅ (그 외 403) |

**목록·시청을 공개로 둔 이유**: 방송 플랫폼의 시청은 누구나 할 수 있어야 하고, 참여(방송하기, 댓글)만 계정에 묶는 게 자연스러워요. 그래서 "보는 것"은 공개, "쓰는 것"은 로그인, "바꾸는 것"은 소유자 또는 작성자로 나눴어요.

### 401 / 403 / 404 기준

- **401**: 로그인하지 않았어요(쿠키가 없거나, 만료되거나, 로그아웃된 세션).
- **403**: 로그인은 했지만 권한이 없어요(남의 방송, 남의 댓글).
- **404**: 대상이 없어요. 존재 확인을 먼저 하기 때문에, 없는 방송에는 누가 요청해도 404예요.

### 보안 메모

- **CSRF**: 세션 쿠키가 `SameSite=Lax`라서 다른 사이트에서 보낸 POST·PATCH·DELETE·WebSocket 요청에는 쿠키가 붙지 않아요.
- **XSS**: 댓글을 포함한 모든 사용자 입력은 `textContent`로 넣어요(`innerHTML` 미사용). 쿠키는 `HttpOnly`라서 JS로 읽을 수도 없어요.
- **오픈 리다이렉트**: 로그인 후 이동하는 `next`는 `/`로 시작하는 같은 사이트 경로만 허용해요.
- **HTTPS 터널 뒤에서 운영할 때**는 `COOKIE_SECURE=true`를 권장해요.

## API

| 메서드 | 경로 | 권한 | 설명 |
| --- | --- | --- | --- |
| `POST` | `/api/auth/signup` | 공개 | `{ username, nickname, password }` → 201 + 세션 쿠키 |
| `POST` | `/api/auth/login` | 공개 | `{ username, password }` → 200 + 세션 쿠키 / 401 |
| `POST` | `/api/auth/logout` | 공개 | 세션 삭제 + 쿠키 제거 → 204 |
| `GET` | `/api/auth/me` | 공개 | `{ user }` (비로그인이면 `null`) |
| `GET` | `/api/broadcasts` | 공개 | 방송 목록 (`owner` 포함) |
| `GET` | `/api/broadcasts/:id` | 공개 | 방송 상세 |
| `POST` | `/api/broadcasts` | 로그인 | 녹화 업로드 (`multipart/form-data`: `title`, `description`, `video`) |
| `PATCH` | `/api/broadcasts/:id` | 소유자 | `{ title, description }` 수정 |
| `DELETE` | `/api/broadcasts/:id` | 소유자 | 방송·파일·댓글 삭제 → 204 |
| `POST` | `/api/lives` | 로그인 | 라이브 시작 → `{ broadcast, streamKey }` |
| `POST` | `/api/lives/:id/end` | 소유자 | 라이브 종료 |
| `WS` | `/ws/ingest?id=N&key=…` | 소유자 + streamKey | 송출 영상 전송 (binary) |
| `GET` | `/api/broadcasts/:id/comments` | 공개 | 댓글 목록 |
| `POST` | `/api/broadcasts/:id/comments` | 로그인 | `{ content }` 댓글 작성 → 201 |
| `PATCH` | `/api/comments/:commentId` | 작성자 | `{ content }` 댓글 수정 |
| `DELETE` | `/api/comments/:commentId` | 작성자·방송 소유자 | 댓글 삭제 → 204 |
| `GET` | `/videos/:file`, `/hls/:id/*` | 공개 | 영상 파일 / HLS 재생목록·조각 |

## 라이브 구조

```
[휴대폰 /live]                         [서버]                                  [시청자 /watch]
getUserMedia (카메라·마이크)
  → MediaRecorder (1초 단위 webm/mp4)
  ──WebSocket /ws/ingest?id&key──▶  쿠키·소유자·streamKey 검사
       (세션 쿠키 자동 포함)           → ffmpeg stdin → H.264/AAC
                                    → data/live/{id}/index.m3u8 + seg_*.ts ◀── GET /hls/{id}/index.m3u8 (hls.js)
```

## 휴대폰 접속 환경 ⚠️

브라우저는 카메라·마이크(`getUserMedia`)를 **HTTPS 또는 `localhost`** 에서만 허용해요. 그래서 휴대폰에서 `http://192.168.x.x:3000`으로 접속하면 송출 페이지에 "보안 연결이 아니라서 카메라를 쓸 수 없어요"가 떠요. 아래 두 방법 중 하나를 쓰세요.

### 방법 A: 터널 (가장 간단, 다른 네트워크에서도 접속 가능)

```bash
npm start
# 다른 터미널에서 (brew install cloudflared)
cloudflared tunnel --url http://localhost:3000
```

출력된 `https://xxxx.trycloudflare.com` 주소를 휴대폰과 시청 화면 양쪽에서 열면 돼요. WebSocket도 터널을 그대로 통과해요. 이 방식으로 계속 운영한다면 `.env`에 `COOKIE_SECURE=true`를 권장해요.

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

- **Android Chrome**: webm(VP8/Opus)으로 녹화해 송출해요.
- **iOS Safari 14.3+**: mp4로 녹화해 송출해요. ffmpeg가 변환해 주지만, 기기·버전에 따라 차이가 있을 수 있어요.
- **시청**: PC Chrome·Edge·Firefox는 hls.js로, Safari와 iOS는 기본 HLS로 재생해요.

## 직접 확인 절차

### ③ 권한 검사 — 자동 점검 스크립트 (화면 없이 API 직접 호출)

화면에서 버튼을 숨기는 것과 상관없이 **서버가 직접 막는지** 확인하는 스크립트예요. 비로그인 사용자, 소유자(alice), 다른 사용자(bob)로 요청을 보내고, 허용·거절 결과를 표로 보여줘요.

```bash
npm start                 # 터미널 1
npm run verify:auth       # 터미널 2 (BASE_URL 기본값 http://localhost:3000)
```

- 실행할 때마다 랜덤 아이디로 가입하니 기존 데이터와 섞이지 않아요. 단, 점검용 방송과 사용자는 DB에 남아요.
- 라이브 송출 소켓 검사에는 ffmpeg로 만든 테스트 영상을 써요.
- 하나라도 기대와 다르면 `✘`가 표시되고, 종료 코드 1로 끝나요.

### ③ 권한 검사 — 화면에서 직접

1. **비로그인**: 목록과 방송 시청, 댓글 목록은 보여요. 댓글 입력창 대신 "로그인하고 댓글을 남겨보세요"가 보여요. `/upload`나 `/live`에 들어가면 로그인 페이지로 이동해요.
2. **회원가입(alice)**: 헤더에 "alice님"이 보여요. 영상을 등록하면 상세 화면에 **✏️ 수정 / 🗑 삭제** 버튼이 보여요. 제목을 수정하고 댓글을 달아봐요(`방송인` 배지).
3. **다른 브라우저나 시크릿 창에서 회원가입(bob)**: alice의 방송에 수정·삭제 버튼이 없어요. 댓글은 쓸 수 있고, 내 댓글만 수정·삭제할 수 있어요.
4. **alice 창**: bob의 댓글에 **삭제**만 보여요(방송 소유자의 관리 권한). 수정은 안 보여요.
5. **버튼 숨김이 아니라는 확인** (bob 창의 개발자 도구 콘솔에서 alice 방송 id로 직접 요청):

   ```js
   await fetch('/api/broadcasts/<alice방송id>', { method: 'DELETE' }).then(r => r.status)   // 403
   await fetch('/api/broadcasts/<alice방송id>', { method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ title: 'hack' }) }).then(r => r.status) // 403
   ```

   로그아웃한 창에서 같은 요청을 보내면 `401`이에요.
6. **로그아웃**: 헤더의 로그아웃을 누르면 비로그인 화면으로 돌아가요. 그 상태에서 5번 요청을 다시 보내면 `401`이에요.
7. **재시작**: 서버를 재시작해도 로그인이 유지되고(세션이 DB에 있음), 방송·댓글이 남아 있는지 확인해요.

### curl로 확인하기 (선택)

```bash
B=http://localhost:3000
curl -s -c alice.txt -H 'Content-Type: application/json' -d '{"username":"alice1","nickname":"앨리스","password":"password123"}' $B/api/auth/signup
curl -s -c bob.txt   -H 'Content-Type: application/json' -d '{"username":"bob1","nickname":"밥","password":"password123"}' $B/api/auth/signup
curl -s -o /dev/null -w '%{http_code}\n' -F title=x -F video=@sample.mp4 $B/api/broadcasts                 # 401 (비로그인)
curl -s -b alice.txt -F title=내방송 -F video=@sample.mp4 $B/api/broadcasts                                 # 201 → id 확인
curl -s -o /dev/null -w '%{http_code}\n' -b bob.txt -X DELETE $B/api/broadcasts/<id>                         # 403 (다른 사용자)
curl -s -o /dev/null -w '%{http_code}\n' -b alice.txt -X DELETE $B/api/broadcasts/<id>                       # 204 (소유자)
```

### ① 녹화방송 · ② 라이브 (이전 단계, 이제 로그인 후 진행)

1. 로그인 → **+ 영상 등록**에서 mp4를 올려요 → 상세 화면에서 재생과 탐색이 되는지 확인해요.
2. HTTPS 주소(위 "휴대폰 접속 환경")로 **휴대폰에서 로그인** → **📱 라이브 시작** → 카메라·마이크 권한을 **허용**해요.
   - 거부했다면 주소창의 🔒(또는 aA) → 사이트 설정 → 카메라·마이크를 허용하고 새로고침해요.
3. **● 방송 시작**을 눌러요.
   - 휴대폰에 `● LIVE 00:01`이 표시되고, 서버 콘솔에 `[live N] ingest connected`가 찍혀요.
4. 다른 화면에서 목록 → `● LIVE` 카드 → 5~10초 지연된 영상과 소리가 재생돼요. 댓글을 달면 3초 안에 휴대폰을 포함한 다른 시청 화면에도 보여요.
5. 휴대폰에서 **■ 방송 종료**를 눌러요.
   - 서버 콘솔에 `[live N] ended`가 찍히고, 시청 화면이 `종료된 라이브`로 바뀌어요.
   - 소유자는 시청 화면의 **■ 방송 종료** 버튼으로도 끝낼 수 있어요.
6. 서버를 재시작해도 방송·다시보기·댓글이 남아 있는지 확인해요.

## 폴더 구조

```
src/
  server.js              진입점: HTTP/HTTPS 서버, WebSocket 연결, 종료 처리, 만료 세션 정리
  app.js                 Express 앱 조립 (loadUser → 라우터), 정적 파일, 에러 처리
  config.js              환경변수 → 설정
  db.js                  SQLite 스키마·마이그레이션 + broadcastRepo
  asyncHandler.js        async 라우트 에러 전달
  auth/passwords.js      scrypt 해시·검증
  auth/middleware.js     쿠키 → req.user, requireAuth(401), requireBroadcastOwner(403)
  repos/                 userRepo, sessionRepo, commentRepo
  routes/auth.js         회원가입·로그인·로그아웃·me
  routes/broadcasts.js   방송 목록·상세·업로드·수정·삭제
  routes/lives.js        라이브 시작·종료
  routes/comments.js     댓글 목록·작성·수정·삭제
  live/liveService.js    라이브 세션 관리, ffmpeg → HLS 변환
  live/ingest.js         송출 WebSocket 수신 (쿠키·소유자·streamKey 검사), 하트비트
public/
  index.html             방송 목록
  watch.html             상세·재생, 소유자 제어, 댓글
  live.html              휴대폰 송출
  upload.html            녹화 영상 등록
  login.html, signup.html
  app.js, style.css      공통 유틸(로그인 상태·헤더)·스타일
scripts/
  verify-auth.mjs        권한 매트릭스 자동 점검 (npm run verify:auth)
```
