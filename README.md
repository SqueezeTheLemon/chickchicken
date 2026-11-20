# chickchicken 🐔 — 치지직 만들기

## ① 인증·인가 없는 녹화방송

로그인 없이 녹화된 방송(VOD)을 등록하고 시청하는 서비스예요.

### 기술 스택

- **Node.js 22.13+** / Express 4
- **multer** — 영상 파일 업로드 (디스크 저장)
- **node:sqlite** (Node 내장 SQLite) — 방송 정보 영속화, 별도 DB 설치 불필요
- 프론트엔드: 빌드 없는 정적 HTML + ES Module

### 실행 방법

```bash
npm install
cp .env.example .env   # 필요하면 값 수정 (없어도 기본값으로 동작)
npm start              # http://localhost:3000
```

개발 중에는 `npm run dev` (파일 변경 시 자동 재시작).

### 환경변수

| 이름 | 기본값 | 설명 |
| --- | --- | --- |
| `PORT` | `3000` | 서버 포트 |
| `DATA_DIR` | `./data` | SQLite DB(`chickchicken.db`)와 업로드 영상(`videos/`)이 저장되는 폴더 |
| `MAX_UPLOAD_MB` | `500` | 업로드 최대 크기(MB) |

이번 단계에는 비밀 값이 없어요. `.env`와 `data/`는 `.gitignore`에 포함돼 있어요.

### 구현 범위

- **영상 등록**: 제목(필수, 100자 이하) · 설명(선택) · 영상 파일(mp4/webm/ogg/mov) 업로드
  - 파일은 `DATA_DIR/videos/`에 랜덤 파일명으로 저장, 영상 위치(파일명)·MIME·크기는 DB에 저장
- **방송 목록** (`/`): 최신순 카드 목록, 영상 첫 프레임을 썸네일로 표시
- **방송 상세** (`/watch?id=N`): 영상 재생(HTTP Range 지원 → 탐색 가능), 제목·설명·등록일
- **영속화**: SQLite 파일 + 디스크 영상 → 서버 재시작 후에도 그대로 조회
- **이번 단계 제외**: 인증·인가, 라이브 송출, 댓글(채팅), 도네이션

### API

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| `GET` | `/api/broadcasts` | 방송 목록 (최신순) |
| `GET` | `/api/broadcasts/:id` | 방송 상세 (없으면 404) |
| `POST` | `/api/broadcasts` | `multipart/form-data` — `title`, `description`, `video` → 201 |
| `GET` | `/videos/:file` | 영상 파일 (Range 요청 지원) |

```bash
# curl로 등록해 보기
curl -F title="테스트 방송" -F description="설명" -F video=@sample.mp4 http://localhost:3000/api/broadcasts
```

### 직접 확인 절차

1. `npm start` 후 http://localhost:3000 접속 → "아직 등록된 방송이 없어요" 확인
2. **+ 영상 등록** → 제목 입력, mp4 파일 선택 → **등록하기**
3. 업로드가 끝나면 상세 화면으로 이동 → 영상이 재생되고, 재생바로 앞뒤 탐색되는지 확인
4. 로고를 눌러 목록으로 → 방금 등록한 방송 카드가 보이는지 확인 → 카드 클릭 시 상세로 이동
5. 제목 없이 / 영상이 아닌 파일로 등록 시도 → 에러 메시지 확인
6. 터미널에서 `Ctrl+C`로 서버 종료 → 다시 `npm start`
7. 목록·상세·재생이 재시작 전과 동일하게 동작하는지 확인 (`data/` 폴더에 DB와 영상이 남아 있음)

### 폴더 구조

```
src/
  server.js            진입점 (listen)
  app.js               Express 앱 조립, 정적 파일·에러 처리
  config.js            환경변수 → 설정
  db.js                SQLite 스키마 + broadcastRepo
  routes/broadcasts.js 방송 API (목록/상세/등록)
public/
  index.html           목록
  watch.html           상세·재생
  upload.html          등록
  app.js, style.css    공통 유틸·스타일
```
