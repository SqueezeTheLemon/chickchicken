# chickchicken 🐔 — 치지직 만들기

| 단계 | 내용 |
| --- | --- |
| ① | 인증·인가 없는 녹화방송 (VOD 등록·목록·상세·재생) |
| ② | 휴대폰 라이브 송출·시청, 방송 중·종료 상태 표시 |
| ③ | 회원가입·로그인·로그아웃, 방송 소유자 권한 검사, 댓글 |
| ④ | 방송자 후원(도네이션): 토스페이먼츠 테스트 결제, 서버 승인 확인, 중복 통지 방지, 방송별 내역·합계 |
| ⑤ | 컨테이너 이미지, 로컬 쿠버네티스(kind)에서 여러 인스턴스 + HPA 자동 스케일, 상태를 공용 저장소(PostgreSQL·공유 볼륨)로 |
| **⑥ (현재)** | **OCI Always Free VM 배포 설정, 도메인 + HTTPS(Caddy), 데스크톱 클라이언트(Windows·macOS) 빌드와 다운로드 페이지** → [⑥ 배포·도메인·데스크톱](#-배포도메인데스크톱-6단계) |

## 기술 스택

- **Node.js 22.13+** / Express 4
- **multer**: 녹화 영상 업로드
- **PostgreSQL 17** (`pg`): 사용자·세션·방송·댓글·후원·라이브 진행 상태를 담는 **공용 DB**. ④단계까지는 SQLite였고, 여러 인스턴스가 같이 쓰도록 ⑤단계에서 바꿨어요.
- **Docker** 이미지 + **kind**(로컬 쿠버네티스) + **HPA**(metrics-server CPU 지표)
- **ws** (WebSocket): 휴대폰 → 서버 라이브 영상 전송
- **ffmpeg**: 받은 영상을 **HLS**(`.m3u8` + `.ts`)로 변환
- **인증**: 서버 세션 + `HttpOnly` 쿠키, 비밀번호는 Node 내장 `crypto.scrypt` 해시 (추가 라이브러리 없음)
- **결제**: [토스페이먼츠](https://docs.tosspayments.com) 결제창 v2 **테스트 모드**. 토스 키가 없을 때는 같은 규칙을 흉내 내는 로컬 모의 결제를 써요.
- 프론트엔드: 빌드 없는 정적 HTML + ES Module, 라이브 재생은 [hls.js](https://github.com/video-dev/hls.js) (CDN)

## 실행 방법

### 준비물

- Node.js **22.13 이상**
- **ffmpeg**: macOS `brew install ffmpeg` / Ubuntu `sudo apt install ffmpeg`. `ffmpeg -version`으로 확인하세요.
- **Docker** (Docker Desktop): PostgreSQL 컨테이너용. 클러스터 실행에도 필요해요.

### A. 개발용: 인스턴스 1개

```bash
npm install
cp .env.example .env   # 필요하면 값 수정 (없어도 기본값으로 동작)
npm run db:up          # PostgreSQL 컨테이너 (localhost:5433)
npm start              # http://localhost:3000
```

개발 중에는 `npm run dev`로 실행하면 파일이 바뀔 때마다 서버가 자동 재시작돼요.

### B. 로컬 쿠버네티스: 여러 인스턴스 + 오토스케일 (⑤단계)

준비물: Docker Desktop, `kind`(`brew install kind`), `kubectl`

```bash
npm run cluster:up     # kind 클러스터 + metrics-server + 이미지 빌드·적재 + Postgres·앱·HPA 배포
# → http://localhost:8080  (Service 가 여러 Pod 로 나눠 보내요)
npm run cluster:down   # 클러스터 삭제
```

자세한 구조와 확인 절차는 아래 "⑤ 여러 인스턴스 + 오토스케일"을 보세요.

## ⑥ 배포·도메인·데스크톱 (6단계)

> ⏳ 표시는 **아직 하지 않은 일**이에요. OCI 계정 가입이 계속 실패해서 VM 생성·도메인 구매·외부 접속 확인은 진행하지 못했어요.
> 계정·도메인이 준비되면 해당 칸을 실제 값으로 채워요. 아래 설정과 절차는 그 값만 넣으면 그대로 배포되도록 만들어 뒀어요.

### 구성

```
 사용자 브라우저 / 데스크톱 앱 (Windows·macOS)
        │ https://<도메인>
        ▼
 DNS  A 레코드 <도메인> → VM 공인 IP
        ▼
 ┌──────────── OCI Always Free VM (Ubuntu, Docker Compose) ────────────┐
 │ caddy :80/:443  ── Let's Encrypt 인증서 자동 발급·갱신, http→https   │
 │   └▶ app :3000 (chickchicken 이미지, /api/health · /readyz · /healthz)│
 │        ├▶ db  (PostgreSQL 17, 볼륨 dbdata)                          │
 │        └▶ 볼륨 media (업로드 영상 · 라이브 HLS)                     │
 └──────────────────────────────────────────────────────────────────────┘
 패키지 파일: GitHub Releases (GitHub Actions 가 Windows·macOS 러너에서 빌드·업로드)
```

### 1. 도메인과 HTTPS

| 항목 | 내용 |
| --- | --- |
| 도메인 등록 여부 | ⏳ **미등록** (구매 예정) |
| 등록한 도메인 | ⏳ 채워야 함 |
| 등록처 | ⏳ 채워야 함 |
| 최초 등록 비용 | ⏳ 채워야 함 (구매 영수증 기준, 원·달러 표기) |
| 갱신 비용(1년) | ⏳ 채워야 함. 첫해 할인 뒤 갱신가가 더 비싼 경우가 많아서 구매 화면의 갱신가를 그대로 옮겨요 |
| 공개 주소 | ⏳ `https://<도메인>` · 다운로드 `https://<도메인>/download` · 상태 `https://<도메인>/api/health` |

**DNS 구성** (등록처의 DNS 관리 화면)

| 타입 | 이름 | 값 | TTL |
| --- | --- | --- | --- |
| A | `@` (도메인 자체) | VM 공인 IPv4 | 300 |
| A 또는 CNAME | `www` | VM 공인 IPv4 또는 `@` | 300 |

- 확인: `dig +short <도메인>` → VM 공인 IP가 나와야 해요.
- Caddy는 DNS가 VM을 가리킬 때까지 인증서 발급을 재시도해요. 그래서 VM을 먼저 띄우고 DNS를 나중에 맞춰도 괜찮아요.

**TLS(HTTPS) 구성**: [deploy/Caddyfile](deploy/Caddyfile)
- `{$DOMAIN}` 블록 하나로 끝나요. Caddy가 **Let's Encrypt(ACME HTTP-01)** 로 인증서를 자동 발급하고, 만료 전에 자동으로 갱신해요. 인증서는 `caddy_data` 볼륨에 저장돼요.
- http(80)로 들어온 요청은 https로 이동(308)시키고, HSTS 헤더를 붙여요. `www.<도메인>`은 `<도메인>`으로 보내요.
- 백엔드는 `COOKIE_SECURE=true`(세션 쿠키 Secure), `TRUST_PROXY=1`(Caddy 한 단계)로 실행해요.
- 필요한 포트: **OCI VCN 보안 목록** 인그레스 TCP 80·443 (+ UDP 443), **VM 안의 iptables** 80·443. 후자는 `setup-vm.sh`가 열어요.
- 로컬 확인(완료): `DOMAIN=localhost`로 운영 구성을 띄워서 아래를 확인했어요.
  - HTTPS 응답, http→https 308, HSTS 헤더
  - `/api/health` 200
  - 권한 점검 54/54 (WebSocket 송출 포함)

### 2. OCI Always Free VM

| 항목 | 계획 | 실제 |
| --- | --- | --- |
| 홈 리전 | 서울(`ap-seoul-1`) 또는 춘천(`ap-chuncheon-1`): 가입할 때 정해지고 바꿀 수 없어요 | ⏳ 채워야 함 |
| Shape | **`VM.Standard.A1.Flex`** (Ampere ARM64) | ⏳ 채워야 함 |
| OCPU / 메모리 | **2 OCPU / 12 GB** | ⏳ 채워야 함 |
| 부트 볼륨 | 50 GB (Always Free 블록 스토리지 200GB 안) | ⏳ |
| OS 이미지 | Canonical Ubuntu 24.04 (aarch64) | ⏳ |
| 가용성·한도 확인 | 콘솔 → **Governance → Limits, Quotas and Usage**에서 `Compute / Cores for Standard.A1 based VM`과 `Memory`의 사용 가능 값, 다른 A1 인스턴스 유무 | ⏳ 확인 결과 기록 |

**Always Free 선택 근거**
- A1.Flex는 Always Free 범위(계정 전체 A1 합계 **4 OCPU / 24GB**까지 무료)에서 가장 성능이 좋은 선택지예요. 과제 기준인 2 OCPU·12GB를 쓰면 무료 할당량의 절반만 써서, 같은 계정에 VM 하나를 더 둘 여유도 남아요.
- 이 서비스는 **ffmpeg 라이브 변환(H.264 인코딩)** 과 PostgreSQL을 한 VM에서 돌려요. 그래서 1GB 메모리 VM보다 12GB가 안정적이에요.
- 서버 이미지가 `node:22-alpine` 기반이라 **ARM64에서 그대로 빌드**돼요. VM 안에서 `docker compose build`로 만들어요.

**재고·리전 제한이 있을 때의 무료 대안** (실제로 쓰게 되면 그 이유를 여기에 남겨요)
1. 같은 A1.Flex를 **1 OCPU / 6GB**로 낮춰서 다시 시도해요. 작은 용량은 재고가 있는 경우가 많아요. 가용성 도메인(AD)도 바꿔서 시도해요.
2. **`VM.Standard.E2.1.Micro`** (AMD x86, 1/8 OCPU, 1GB, Always Free 2대): `setup-vm.sh`가 메모리가 3GB 미만이면 **스왑 2GB**를 자동으로 만들어요. 다만 라이브 변환은 느릴 수 있어요.
3. ⏳ 실제 선택과 이유: 채워야 함

### 3. 백엔드 배포 (재현 절차)

배포 설정 파일
- [deploy/docker-compose.prod.yml](deploy/docker-compose.prod.yml): db + app + caddy. DB 포트는 외부에 열지 않아요.
- [deploy/Caddyfile](deploy/Caddyfile)
- [deploy/.env.prod.example](deploy/.env.prod.example): 서비스 주소(`DOMAIN`)와 비밀 값(`POSTGRES_PASSWORD`, 토스 키)은 **VM의 `deploy/.env.prod`에만** 둬요(커밋 금지, `.gitignore`).
- [deploy/setup-vm.sh](deploy/setup-vm.sh): 설치부터 실행까지 한 번에, 여러 번 실행해도 안전해요.
- [deploy/cloud-init.yaml](deploy/cloud-init.yaml): 인스턴스를 만들 때 붙여 넣으면 첫 부팅에 자동 배포해요.

절차
1. OCI 콘솔 → **Compute → Instances → Create instance**
   - 이미지 Ubuntu 24.04, Shape `VM.Standard.A1.Flex` 2 OCPU / 12GB
   - 공인 IPv4 할당, SSH 키 등록
   - (선택) 고급 옵션 → 관리 → Cloud-init에 `deploy/cloud-init.yaml`을 붙여 넣기 (도메인·메일만 바꿔서)
2. **Networking → VCN → Security List → Ingress Rules**에 TCP 80, TCP 443(+UDP 443) `0.0.0.0/0` 추가
3. 도메인 DNS A 레코드 → VM 공인 IP (위 표)
4. VM에 SSH로 접속해서 실행해요(cloud-init을 썼다면 생략).

   ```bash
   ssh ubuntu@<VM 공인 IP>
   curl -fsSLO https://raw.githubusercontent.com/SqueezeTheLemon/chickchicken/main/deploy/setup-vm.sh
   sudo bash setup-vm.sh --domain <도메인> --email <메일>
   ```

   이 스크립트가 하는 일이에요.
   - Docker·Compose 설치
   - (메모리가 작으면) 스왑 생성
   - iptables 80·443 열기
   - 소스를 `/opt/chickchicken`에 받기
   - `.env.prod` 생성(DB 비밀번호 **랜덤**)
   - `docker compose up -d --build`
   - `https://<도메인>/api/health`가 응답할 때까지 대기

5. 업데이트: `sudo bash /opt/chickchicken/deploy/setup-vm.sh` (기존 `.env.prod` 유지)
6. 로그: `cd /opt/chickchicken/deploy && docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f app caddy`

**상태 확인 경로**

| 경로 | 용도 | 응답 |
| --- | --- | --- |
| `GET /api/health` | 배포 상태 확인 (사람·모니터링) | `{status, version, commit, db, payment, instance, publicBaseUrl, startedAt, uptimeSeconds}`. DB가 안 되면 503 |
| `GET /readyz` | 트래픽을 받아도 되는지 (DB 연결 + 종료 중 아님) | 200 / 503. Caddy `health_uri`, compose healthcheck에서 써요 |
| `GET /healthz` | 프로세스 생존 | 200 |

**기존 기능 유지**: 방송(VOD·라이브)·계정·댓글·후원 코드는 그대로예요. 6단계에서 바뀐 건 공개 조회 CORS, 프록시 설정, `/api/health`뿐이에요. 회귀 점검: 권한 54/54, 도네이션 36/36 통과.

### 4. 데스크톱 클라이언트 (Windows · macOS)

- **소스**: [desktop/](desktop/). **Electron 33** + **electron-builder 25**, 재생은 앱에 넣은 **hls.js**.
  - [desktop/main.js](desktop/main.js): 창, 보안 설정(contextIsolation·sandbox), 외부 링크는 기본 브라우저로
  - [desktop/renderer/app.js](desktop/renderer/app.js): 배포 백엔드의 `GET /api/broadcasts`(목록), `GET /api/broadcasts/:id`(상세)로 **방송 목록 조회**. 녹화방송은 `<video>`(mp4, Range 탐색), 라이브·종료된 라이브는 hls.js로 **재생**
  - 서버 주소: [desktop/config.json](desktop/config.json)의 `defaultServerUrl`이 기본값이에요. CI가 빌드할 때 배포 도메인으로 바꿔 넣고, 앱의 **⚙️ 서버 설정**에서도 바꿀 수 있어요(연결 테스트는 `/api/health`).
  - 백엔드는 앱이 쓰는 **공개 조회 경로만 CORS**를 열어요. 로그인 쿠키는 허용하지 않고, 로그인 같은 경로는 열지 않아요(확인 완료).
- **빌드 설정**: [desktop/package.json](desktop/package.json)의 `build`

  | OS | 아키텍처 | 파일 | 형식 |
  | --- | --- | --- | --- |
  | Windows 10/11 | x64 | `Chickchicken-win-x64-setup.exe`, `Chickchicken-win-x64.zip` | NSIS 설치 파일 / 설치 없이 실행 |
  | Windows 10/11 | ARM64 | `Chickchicken-win-arm64-setup.exe`, `Chickchicken-win-arm64.zip` | 〃 |
  | macOS 11+ | Apple Silicon (arm64) | `Chickchicken-mac-arm64.dmg`, `Chickchicken-mac-arm64.zip` | 디스크 이미지 / 앱 압축 |
  | macOS 11+ | Intel (x64) | `Chickchicken-mac-x64.dmg`, `Chickchicken-mac-x64.zip` | 〃 |

- **빌드 방법**
  - 로컬: `cd desktop && npm ci && npm run dist:mac` (macOS), `npm run dist:win` (Windows 또는 macOS. macOS에서는 electron-builder가 내장 wine을 받아서 NSIS를 만들어요) → `desktop/dist/`
  - CI: [.github/workflows/desktop.yml](.github/workflows/desktop.yml). `git tag desktop-v1.0.0 && git push origin desktop-v1.0.0`을 하면 **macOS 러너·Windows 러너**에서 각각 빌드하고, GitHub Release(latest)에 올려요. 저장소 Variables `CHICKCHICKEN_SERVER_URL`에 배포 주소를 넣으면 앱의 기본 서버가 돼요.
  - 코드 서명·공증은 하지 않았어요. 설치할 때 뜨는 OS 경고를 넘기는 방법은 다운로드 페이지에 적어 뒀어요.

### 5. 다운로드 페이지

- **소스**: [public/download.html](public/download.html) → `https://<도메인>/download` (⏳ 공개 주소는 도메인 연결 후)
  - OS별 파일 링크는 `https://github.com/SqueezeTheLemon/chickchicken/releases/latest/download/<파일명>`이에요. 파일명에 버전이 없어서 항상 최신 Release를 가리켜요.
  - 지원 아키텍처, OS별 설치·실행 방법(SmartScreen "추가 정보 → 실행", macOS "Control+클릭 → 열기"·`xattr`), 처음 실행 안내가 들어 있어요.
  - 접속한 OS를 감지해서 해당 카드를 강조하고, GitHub API로 최신 버전을 표시해요.
  - 헤더의 **⬇️ 앱 다운로드**로 들어가요.
- ⚠️ 링크가 동작하려면 GitHub 저장소가 **공개(public)** 이고, `desktop-v*` 태그로 Release가 한 번 이상 올라가 있어야 해요. ⏳ 아직 Release를 올리지 않았어요.

### 6. OS별 설치·실행 확인 절차

**macOS**
1. `https://<도메인>/download`에서 칩에 맞는 `.dmg`를 받아요( → 이 Mac에 관하여 → 칩).
2. dmg를 열고 Chickchicken을 응용 프로그램으로 끌어 놓아요.
3. 처음 실행은 **Control+클릭 → 열기**. "손상됨"이 뜨면 `xattr -dr com.apple.quarantine /Applications/Chickchicken.app`
4. 앱 첫 화면에 배포 서버의 **방송 목록**이 뜨는지 확인해요. 녹화방송 카드를 눌러 **재생·탐색**, 라이브(또는 종료된 라이브) 카드를 눌러 **HLS 재생**을 확인해요.
5. ⚙️ 서버 설정 → 연결 테스트에 `✅ 연결됨 — 서버 vX (commit)`이 나오는지 확인해요.

**Windows**
1. `https://<도메인>/download`에서 `Chickchicken-win-x64-setup.exe`를 받아요(ARM PC는 arm64).
2. 실행해서 SmartScreen이 뜨면 **추가 정보 → 실행** → 설치해요. 또는 zip을 풀고 `Chickchicken.exe`를 실행해요.
3. 시작 메뉴·바탕화면의 Chickchicken 실행 → 방송 목록 → 녹화방송·라이브 재생, 서버 설정 연결 테스트(macOS 4~5와 같아요)

**테스트 결과**

| OS | 아키텍처 | 패키지 | 받은 경로 | 설치·실행 | 목록 조회 | 재생 | 비고 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| macOS 14 (MacBook, Apple Silicon) | arm64 | `Chickchicken-mac-arm64` (로컬 빌드한 `.app`) | 로컬 빌드 | ✅ 실행 | ✅ 9개 (로컬 백엔드) | ✅ VOD mp4 / ✅ HLS 다시보기 | 2026-11-22. 배포 백엔드가 아닌 `http://localhost:3000`으로 확인 |
| macOS | x64 (Intel) | `Chickchicken-mac-x64.dmg` | ⏳ | ⏳ 빌드만 확인 (Mach-O x86_64) | ⏳ | ⏳ | Intel Mac에서 확인 필요 |
| Windows 10/11 | x64 | `Chickchicken-win-x64-setup.exe` | ⏳ | ⏳ 빌드만 확인 (PE32+ x86-64) | ⏳ | ⏳ | Windows PC에서 확인 필요 |
| Windows 11 | arm64 | `Chickchicken-win-arm64-setup.exe` | ⏳ | ⏳ 빌드만 확인 (PE32+ Aarch64) | ⏳ | ⏳ | |
| 외부 네트워크 → 도메인 HTTPS·다운로드 | - | - | ⏳ | - | - | - | 도메인·VM 준비 후 (휴대폰 LTE 등 외부망에서 `https://<도메인>`, `/download`, `/api/health`) |

## 환경변수

| 이름 | 기본값 | 설명 |
| --- | --- | --- |
| `PORT` | `3000` | 서버 포트 |
| `DATABASE_URL` | `postgres://chickchicken:devpassword@localhost:5433/chickchicken` | 공용 PostgreSQL 주소. 클러스터에서는 Secret의 랜덤 비밀번호로 만들어요 |
| `POSTGRES_PASSWORD` | `devpassword` | `docker compose`로 띄우는 **로컬 개발용** DB 비밀번호 (실제 비밀 값 아님) |
| `DB_POOL_MAX` | `10` | 인스턴스당 DB 연결 수 |
| `INSTANCE_ID` | 호스트 이름 | 인스턴스 이름. 응답 헤더 `X-Instance`와 라이브 송출 담당 기록에 써요. 쿠버네티스에선 Pod 이름 |
| `DATA_DIR` | `./data` | 업로드 영상(`videos/`), 라이브 HLS(`live/{id}/`) 저장 폴더. 여러 인스턴스면 **공유 볼륨** |
| `MAX_UPLOAD_MB` | `500` | 업로드 최대 크기(MB) |
| `FFMPEG_PATH` | `ffmpeg` | ffmpeg 실행 파일 경로 |
| `HLS_SEGMENT_SECONDS` | `2` | HLS 조각 길이(초) |
| `HTTPS_KEY_PATH` / `HTTPS_CERT_PATH` | (없음) | 지정하면 HTTPS로 실행돼요 (휴대폰 카메라용, 아래 참고) |
| `SESSION_TTL_HOURS` | `168` | 로그인 유지 시간(시간 단위, 기본 7일) |
| `COOKIE_SECURE` | `false` | `true`면 세션 쿠키에 `Secure`를 붙여요. HTTPS로 서비스할 때 켜요. `HTTPS_KEY_PATH`를 쓰면 자동으로 켜져요 |
| `PAYMENT_PROVIDER` | 토스 키가 있으면 `toss`, 없으면 `mock` | `toss` = 토스페이먼츠 테스트 모드, `mock` = 로컬 모의 결제 |
| `TOSS_CLIENT_KEY` | (없음) | 토스페이먼츠 **API 개별 연동 테스트 클라이언트 키** (`test_ck_…`). 브라우저에 공개돼도 되는 키예요 |
| `TOSS_SECRET_KEY` | (없음) | 토스페이먼츠 **테스트 시크릿 키** (`test_sk_…`). 서버에만 둬요. **절대 커밋 금지** |
| `PUBLIC_BASE_URL` | (없음) | 공개 주소 (예: `https://<도메인>`). `/api/health`에 표시돼요. 운영 compose는 `https://${DOMAIN}`으로 넣어요 |
| `GIT_SHA` | `dev` | 배포한 커밋. `/api/health`의 `commit`에 표시돼요. `setup-vm.sh`가 넣어요 |
| `TRUST_PROXY` | `1` | 앞단 리버스 프록시 단계 수 (Caddy 1단계) |
| `CORS_PUBLIC_ORIGINS` | `*` | 데스크톱 앱 등 다른 출처에 **공개 조회(GET)** 를 허용할 출처 (쉼표 구분) |
| `DOMAIN`, `ACME_EMAIL` | - | **운영 전용** (`deploy/.env.prod`). Caddy가 이 도메인으로 인증서를 받고, 만료 알림을 이 메일로 보내요 |

- 세션은 서명 키가 필요 없는 구조예요. 토큰은 서버가 랜덤으로 만들고, DB에는 해시만 저장해요.
- 결제 키는 [토스페이먼츠 개발자센터 → API 키](https://developers.tosspayments.com/my/api-keys)에서 **본인 테스트 키**를 발급받아 `.env`에만 넣으세요. 저장소에는 키를 넣지 않았어요.
- 서버는 `test_`로 시작하지 않는 키(실결제 키)를 받으면 **시작을 거부**해요.
- `.env`, `data/`, `certs/`는 `.gitignore`에 포함돼 있어요.

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
- 송출 연결이 끊기면 **30초 동안 재연결을 기다렸다가**(⑤단계부터, 다른 인스턴스로 이어받기) 그래도 없으면 종료 처리해요. 30초 안에 송출이 시작되지 않은 방송도 종료해요.

### ③ 인증·인가 + 댓글 (유지)

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

### ④ 도네이션 (유지)

- **방송자와 금액 선택**
  - 방송 상세 화면 오른쪽의 💰 후원 패널에서 금액(1,000·5,000·10,000·50,000원 또는 직접 입력)과 메시지를 고르고 **후원하기**를 눌러요.
  - 받는 사람은 그 방송의 소유자예요. 로그인하지 않았거나, 내 방송이거나, 소유자가 없는 방송이면 후원할 수 없어요. 서버도 같은 규칙으로 막아요.
- **결제 흐름** (토스페이먼츠 결제창 v2, 리다이렉트 방식)
  1. `POST /api/broadcasts/:id/donations`: 서버가 **주문(PENDING)** 을 만들어요. 이때 **수신 방송자와 금액을 DB에 고정**하고, `orderId`와 `metadata`(broadcastId, streamerId)를 돌려줘요.
  2. 브라우저가 결제창을 열어요. 결제가 끝나면 `/donate/success?paymentKey&orderId&amount`로, 실패·취소하면 `/donate/fail?orderId&code&message`로 돌아와요.
  3. `/donate/success` 페이지는 **아무것도 확정하지 않고** 서버에 `POST /api/donations/confirm`을 보내요.
  4. 서버는 아래 순서로 확인하고, 모두 통과해야 **DONE**으로 바꿔요.
     - 주문자 본인인지 확인
     - 주문 상태(PENDING, 30분 이내) 확인
     - **요청 금액 = 주문 금액** 대조. 다르면 결제사에 승인 요청조차 하지 않아요.
     - 토스 승인 API 호출 (시크릿 키는 서버에만, `Idempotency-Key` 사용)
     - 결제사 응답의 **상태 DONE, 주문번호, 금액, metadata 수신자 = 주문의 방송자**, 그리고 방송 소유자가 바뀌지 않았는지 검증
  5. 결제는 승인됐는데 검증에 실패하면 **결제사 취소 API로 자동 취소**하고, 주문을 FAILED로 둬요.
- **중복 적립 방지** (같은 승인 통지가 여러 번 와도 1번만)
  - 확정은 `UPDATE … SET status='DONE' WHERE order_id=? AND status='PENDING'`예요. 실제로 바뀐 행이 있을 때만 적립돼요.
  - `payment_key`는 `UNIQUE`라서 같은 결제를 다른 주문에 쓸 수 없어요.
  - 주문별 처리 잠금이 있어서, 승인 요청과 웹훅이 동시에 와도 한 줄로 처리해요.
  - 이미 확정된 주문에 같은 승인이 다시 오면(새로고침, 뒤로가기, 웹훅 재전송) 결과는 그대로 주고 `duplicated: true`로 응답해요.
- **결제사 웹훅** `POST /api/payments/webhook` (`PAYMENT_STATUS_CHANGED`)
  - 본문은 위조될 수 있으니 **paymentKey로 결제사에 다시 조회한 결과만** 믿어요.
  - DONE이면 위와 같은 방식으로 확정(중복이면 무시)하고, 결제사에서 취소됐으면 후원을 CANCELED로 바꿔 합계에서 빼요.
  - 결제사에 없는 결제(위조)는 200으로 무시해요. 결제사 조회가 일시적으로 실패하면 500을 돌려줘 재전송을 받아요.
- **실패·취소**: `/donate/fail`이 서버에 보고해서 주문을 FAILED 또는 CANCELED로 정리해요. 확정된 주문은 바뀌지 않아요.
- **방송별 후원 내역·합계**: 상세 화면 후원 패널에 **확정(DONE)된 후원만** 합계·건수·최근 내역(후원자, 금액, 메시지, 시각)으로 보여요. 5초마다 갱신돼요.
- 방송을 삭제해도 후원 기록은 남아요(`broadcast_id`만 NULL, 방송 제목은 스냅샷으로 저장).

### ⑤ 여러 인스턴스 + 오토스케일 (유지)

```
                        localhost:8080
                              │  (kind extraPortMappings → NodePort 30080)
                     ┌────────▼────────┐
                     │ Service (L4)    │  kube-proxy 가 연결 단위로 Pod 에 분산
                     └──┬─────┬─────┬──┘
           ┌────────────┘     │     └────────────┐
     ┌─────▼─────┐      ┌─────▼─────┐      ┌─────▼─────┐
     │ Pod (app) │      │ Pod (app) │  …   │ Pod (app) │   ← HPA 가 CPU 50% 기준으로 2~6개 조절
     └─────┬─────┘      └─────┬─────┘      └─────┬─────┘
           │  상태는 Pod 안에 두지 않아요         │
     ┌─────▼──────────────────▼──────────────────▼─────┐
     │ PostgreSQL (Deployment + PVC)                    │  사용자·세션·방송·댓글·후원·라이브 진행 상태
     │ 공유 볼륨 media (PVC, 모든 Pod 가 /data 에 마운트) │  업로드 영상 · 라이브 HLS 조각
     └──────────────────────────────────────────────────┘
```

- **컨테이너 이미지** ([Dockerfile](Dockerfile)): `node:22-alpine` + `ffmpeg`, 비밀 값 없음. 설정은 실행 환경(Secret·Env)에서 넣어요.
- **오케스트레이터**: kind(로컬 쿠버네티스, 노드 1개). [k8s/](k8s/)의 매니페스트와 [scripts/cluster-up.sh](scripts/cluster-up.sh) 한 번으로 아래를 모두 해요.
  - 클러스터 생성, metrics-server 설치
  - 이미지 빌드 후 `kind load`로 클러스터에 넣기
  - Secret 생성(DB 비밀번호는 **랜덤으로 생성**하고 저장소에 남기지 않아요)
  - Postgres·앱·HPA 배포
- **부하 분산**: NodePort Service. 응답마다 `X-Instance: <Pod 이름>` 헤더가 붙어서 어느 Pod가 처리했는지 보여요.
- **자동 스케일** ([k8s/hpa.yaml](k8s/hpa.yaml)): HPA `autoscaling/v2`
  - 기준: CPU 사용률 평균 **50%**(Pod 요청량 200m 대비)
  - 범위: **최소 2 ~ 최대 6**
  - 늘릴 때: 바로, 15초마다 최대 2배
  - 줄일 때: 1분 안정화 후 30초마다 2개씩. 쿠버네티스 기본값은 5분인데, 확인하기 쉽게 줄였어요.
- **헬스체크와 우아한 종료**
  - `readinessProbe /readyz`: DB 연결을 확인하고, 종료 중이면 503을 돌려줘요. 준비된 Pod에만 요청이 가요.
  - `livenessProbe /healthz`
  - `preStop sleep 5`로 Service에서 빠질 시간을 준 뒤 SIGTERM을 받아요. 처리 중인 요청을 마치고, DB 연결을 닫고 종료해요.
- **상태를 인스턴스 밖으로** (Pod가 늘거나 줄어도 그대로 유지)

  | 상태 | ④단계까지 | ⑤단계 |
  | --- | --- | --- |
  | 사용자·로그인 세션 | SQLite 파일 | **PostgreSQL** `sessions` (토큰 해시). 어느 Pod로 가도 같은 로그인 상태라 sticky session이 필요 없어요 |
  | 방송·댓글·후원 | SQLite 파일 | **PostgreSQL** |
  | 업로드 영상·라이브 HLS | 로컬 폴더 | **공유 볼륨**(PVC `media`), 모든 Pod가 `/data`에 마운트 |
  | 라이브 송출 담당·종료 요청 | 메모리(`Map`) | **PostgreSQL** `broadcasts.live_instance_id`, `live_heartbeat_at`, `end_requested_at`, `stream_key_hash` |
  | 모의 결제사 결제 정보 | 메모리 | **PostgreSQL** `mock_payments` |
  | 후원 주문 처리 잠금 | 메모리 잠금 | **Postgres advisory lock** (모든 Pod에 걸쳐 같은 주문을 한 줄로) |
  | DB 스키마 생성 | 시작 시 | 시작 시 + advisory lock (여러 Pod가 동시에 떠도 한 번씩) |

- **라이브 송출과 스케일** (어려운 부분)
  - 송출 WebSocket은 **아무 Pod에나** 붙을 수 있어요. 받은 Pod가 DB에 "내가 맡음(claim)"을 기록하고 3초마다 하트비트를 남겨요.
  - 다른 Pod가 같은 방송에 송출을 받으려 하면 403이에요.
  - **종료 요청이 다른 Pod로 가도** DB에 `end_requested_at`을 남기면, 송출을 맡은 Pod가 하트비트 때 보고 종료해요(약 1~3초).
  - **스케일 인으로 송출 중인 Pod가 내려가면** 방송을 끝내지 않아요.
    - 소켓을 `1012`(service restart)로 닫고 claim을 놓아요.
    - 휴대폰 송출 페이지가 **자동으로 재연결**하면 다른 Pod가 이어받아요.
    - ffmpeg `append_list`로 **같은 재생목록에 이어 붙이고**, 끊긴 자리에 `#EXT-X-DISCONTINUITY`를 넣어요.
  - 하트비트가 30초 넘게 끊긴 라이브(재연결 없음, Pod 강제 종료 등)는 **어느 Pod든** 정리해요(reaper).
- **부하 발생** ([scripts/load.mjs](scripts/load.mjs)): 외부 도구 없이 Node만으로 동시 N개 작업자가 요청을 보내요.
  - 요청 구성: 방송 목록 60%, 댓글 20%, 로그인 20%(비밀번호 해시라 CPU를 씀)
  - 요청마다 새 연결로 보내서 Pod에 고르게 나뉘어요.
  - 5초마다 처리량, p95 지연, Pod별 처리 수를 출력해요.
- **상태 유지 확인** ([scripts/check-continuity.mjs](scripts/check-continuity.mjs)): 스케일 중에 3초마다 **새 연결**로 아래를 확인해요. 처음 보는 Pod가 응답하면 🆕로 표시해요.
  - 로그인 상태
  - 방송 목록, 댓글 수, 후원 합계
  - 업로드 영상(공유 볼륨) 응답

### 이번 단계에서 하지 않은 것

- 클라우드 배포, 노드 여러 대(그 경우 공유 볼륨을 RWX(NFS 등)나 오브젝트 스토리지로 바꿔야 해요), DB 이중화
- 실제 금전 결제(테스트 키만 허용), 방송자 정산·출금, 부분 환불 UI
- 웹훅 서명(`tosspayments-webhook-signature`) 검증: 대신 **결제사 재조회**로 본문을 검증해요.
- 비밀번호 변경·탈퇴, 로그인 시도 횟수 제한(rate limit)

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
| 방송별 후원 내역·합계 조회 | ✅ 공개 | ✅ |
| 후원 주문·결제 | ❌ 401 | ✅ (내 방송은 400) |
| 후원 승인 확인·실패 보고·주문 조회 | ❌ 401 | 주문자 본인만 ✅ (그 외 403/404) |
| 결제사 웹훅 | 결제사 호출용 (로그인 없음, 결제사 재조회로 검증) | |

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
| `GET` | `/api/payments/config` | 공개 | `{ provider, clientKey }` (시크릿 키는 내려가지 않아요) |
| `GET` | `/api/broadcasts/:id/donations` | 공개 | `{ total, count, donations[] }` 확정된 후원만 |
| `POST` | `/api/broadcasts/:id/donations` | 로그인 | `{ amount, message }` → 주문 생성 (수신자는 방송 소유자로 서버가 고정) |
| `POST` | `/api/donations/confirm` | 주문자 | `{ orderId, paymentKey, amount }` → 서버 승인·검증 → `{ donation, duplicated }` |
| `POST` | `/api/donations/:orderId/fail` | 주문자 | `{ code, message }` 실패·취소 보고 |
| `GET` | `/api/donations/:orderId` | 주문자 | 내 주문 상태 |
| `POST` | `/api/payments/webhook` | 결제사 | `PAYMENT_STATUS_CHANGED` 통지 (재조회 후 반영, 중복 무시) |
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

### ⑤ 여러 인스턴스 + 오토스케일

터미널 3개를 열어요.

```bash
npm run cluster:up                                   # 0) 클러스터 띄우기 (처음 한 번, 몇 분 걸려요)
./scripts/watch-scale.sh docs/scaling-log.txt        # 1) 터미널 A: Pod 수·CPU 를 5초마다 기록
node scripts/check-continuity.mjs --duration 450     # 2) 터미널 B: 스케일 중 로그인·방송·댓글·후원·영상 유지 확인
node scripts/load.mjs --duration 180 --concurrency 60  # 3) 터미널 C: 3분 부하
```

- 부하가 시작되면 터미널 A에서 **희망Pod / 현재Pod 가 2 → 4 → 6**으로 늘어나요.
- 부하가 끝나고 약 1분 뒤에는 **6 → 4 → 2**로 줄어요.
- `kubectl -n chickchicken get hpa -w`나 `kubectl -n chickchicken describe hpa chickchicken`의 Events로도 볼 수 있어요.
- 터미널 B는 스케일이 바뀌는 내내 ✔만 나와야 해요. 새로 생긴 Pod가 처음 응답하면 🆕가 붙어요.
- 화면으로 확인하려면 브라우저 두 개로 `http://localhost:8080`에 로그인하고 방송·댓글을 남긴 채 부하를 걸어요. 새로고침할 때마다 다른 Pod가 응답해도(개발자 도구 → 응답 헤더 `X-Instance`) 로그인과 방송 목록·댓글이 그대로예요.
- 기존 점검 스크립트를 **클러스터 주소로** 그대로 돌릴 수도 있어요. 이번 확인에서 `54/54`, `36/36`이 모두 통과했어요.

  ```bash
  BASE_URL=http://localhost:8080 npm run verify:auth
  BASE_URL=http://localhost:8080 npm run verify:donations
  ```

- **라이브 송출 인계**(스케일 인 때 송출 중인 인스턴스가 내려가는 상황): 로컬에서 인스턴스 3개를 띄워 12개 항목을 확인해요(모두 통과).

  ```bash
  npm run db:up && npm run verify:live-handover
  ```

#### 실제로 확인한 결과 (2026-11-20, MacBook Docker Desktop 8 CPU, kind 1노드)

전체 기록은 [docs/scaling-log.txt](docs/scaling-log.txt), [docs/load-log.txt](docs/load-log.txt), [docs/continuity-log.txt](docs/continuity-log.txt), [docs/hpa-events.txt](docs/hpa-events.txt)에 있어요.

**인스턴스 수 변화** (`watch-scale.sh` 출력 일부, CPU는 요청량 200m 대비 평균 사용률)

```
시각      CPU(현재/목표) 희망Pod 현재Pod Ready
22:18:20  2/50%          2       2       2      ← 부하 전
22:18:26  373/50%        4       2       2      ← 부하 시작 → 4개로
22:18:41  495/50%        6       4       4      ← 아직 높음 → 6개(최대)로
22:18:57  444/50%        6       6       6
  … (부하 3분 동안 6개 유지, CPU 220~300%)
22:21:28  68/50%         6       6       6      ← 부하 종료
22:22:24  1/50%          6       6       6      ← 1분 안정화 대기
22:22:30  1/50%          4       6       4      ← 스케일 인 6 → 4
22:23:00  1/50%          2       4       2      ← 스케일 인 4 → 2 (최소)
22:23:16  1/50%          2       2       2
```

**HPA 이벤트** (`kubectl describe hpa`)

```
Normal  SuccessfulRescale  New size: 4; reason: cpu resource utilization (percentage of request) above target
Normal  SuccessfulRescale  New size: 6; reason: cpu resource utilization (percentage of request) above target
Normal  SuccessfulRescale  New size: 4; reason: All metrics below target
Normal  SuccessfulRescale  New size: 2; reason: All metrics below target
```

**부하 분산** (`load.mjs`, 5초 구간별 Pod당 처리 수)

```
22:18:24   162 req/s  p95 2222ms  Pod 2개 → 828k5:409 nrlbb:401
22:18:34   326 req/s  p95 1911ms  Pod 4개 → 828k5:404 lxvwv:407 nrlbb:378 zkq88:439
22:18:54   340 req/s  p95 1023ms  Pod 6개 → 828k5:272 lxvwv:268 ndr2f:298 nrlbb:300 t2xz4:269 zkq88:294
✅ 끝: 성공 44073 · 실패 1 · 응답한 Pod 6개
```

- Pod가 늘어나면서 p95 지연이 약 2.2초에서 약 1.1초로 줄었어요.
- 실패 1건(0.002%)은 스케일 아웃 중(22:18:44)에 발생했어요. 이유는 확인하지 못했어요.

**스케일 중 상태 유지** (`check-continuity.mjs`): 새로 생긴 Pod 4개도 첫 응답부터 같은 상태를 봤어요.

```
시각      Pod         로그인  방송목록  댓글  후원합계  영상
22:17:44  8967-828k5 🆕  ✔       ✔         ✔     ✔        ✔
22:18:29  8967-lxvwv 🆕  ✔       ✔         ✔     ✔        ✔     ← 스케일 아웃으로 생긴 Pod
22:18:37  8967-zkq88 🆕  ✔       ✔         ✔     ✔        ✔
22:18:47  8967-t2xz4 🆕  ✔       ✔         ✔     ✔        ✔
22:19:33  8967-ndr2f 🆕  ✔       ✔         ✔     ✔        ✔
22:22:35  8967-t2xz4     ✔       ✔         ✔     ✔        ✔     ← 스케일 인 중
22:23:02  8967-828k5     ✔       ✔         ✔     ✔        ✔
✅ 확인 130회 · 실패 0회 · 응답한 Pod 6개
```

### ④ 도네이션 — 토스페이먼츠 테스트 결제 (실제 결제 서비스 샌드박스)

1. [토스페이먼츠 개발자센터](https://developers.tosspayments.com)에 가입 → **API 키** 메뉴에서 **API 개별 연동 키**의 테스트 클라이언트 키(`test_ck_…`)와 테스트 시크릿 키(`test_sk_…`)를 복사해요.
2. `.env`에 키를 넣고 서버를 켜요. 콘솔에 `💳 결제: 토스페이먼츠 테스트 모드`가 찍혀야 해요.

   ```
   TOSS_CLIENT_KEY=test_ck_발급받은값
   TOSS_SECRET_KEY=test_sk_발급받은값
   ```

3. 브라우저 두 개(또는 일반 창 + 시크릿 창)를 준비해요.
   - 방송자로 가입해 영상을 등록해요.
   - 다른 계정(시청자)으로 그 방송에 들어가요.
4. **성공**: 후원 패널에서 금액을 고르고 **후원하기** → 토스 결제창에서 카드를 선택해 결제를 진행해요(테스트 키라 실제 출금 없음).
   - `/donate/success`에 잠깐 "결제 승인을 확인하고 있어요…"가 보인 뒤, **서버가 확인하면** "○○님에게 N원 후원 완료!"가 떠요.
   - 서버 콘솔에 `[donation don_…] 확정 N원 (confirm)`이 찍혀요.
   - 방송 화면의 후원 합계·건수·내역이 늘어나요.
   - [개발자센터 → 결제 내역(테스트)](https://developers.tosspayments.com/my/payment-logs)에서 같은 주문번호를 확인할 수 있어요.
5. **취소**: 결제창에서 닫기(취소)를 눌러요 → `/donate/fail`에 "결제를 취소했어요 (PAY_PROCESS_CANCELED)"가 떠요. 합계는 그대로예요.
6. **실패**: 결제창에서 카드사 인증을 실패시키거나 중단해요 → `/donate/fail`에 실패 코드가 표시되고, 합계는 그대로예요.
   - 승인 단계 실패는 토스의 테스트 헤더(`TossPayments-Test-Code: REJECT_CARD_PAYMENT`)로 재현할 수 있어요. 화면에서 하기 어렵다면 아래 모의 결제의 "⚠️ 승인 단계 거절"로 같은 경로를 확인해요.
7. **중복 통지 (새로고침)**: 성공 페이지(`/donate/success?…`)에서 **새로고침**을 여러 번 해요 → "이미 확정된 후원이에요. 같은 승인이 다시 와도 한 번만 적립돼요."가 뜨고, 합계는 늘지 않아요.
8. **중복 통지 (웹훅)**: 같은 결제의 웹훅을 여러 번 보내요(아래 명령을 반복). 응답은 `{"result":"duplicate"}`이고, 합계는 늘지 않아요.

   ```bash
   curl -s -H 'Content-Type: application/json' http://localhost:3000/api/payments/webhook \
     -d '{"eventType":"PAYMENT_STATUS_CHANGED","data":{"paymentKey":"<성공 페이지 주소의 paymentKey>","orderId":"<orderId>","status":"DONE"}}'
   ```

   - 실제 토스 웹훅을 받으려면 [개발자센터 → 웹훅](https://developers.tosspayments.com/my/webhooks)에 `https://<터널주소>/api/payments/webhook`을 `PAYMENT_STATUS_CHANGED`로 등록하세요(`cloudflared` 터널 등 공개 주소 필요).
   - 대시보드의 "재전송"으로 같은 통지를 다시 보내도 중복 적립되지 않아요.

### ④ 도네이션 — 키 없이 모의 결제로 확인

토스 키가 없으면 서버가 자동으로 **모의 결제**(`💳 결제: 로컬 모의 결제`)로 떠요. 후원하기를 누르면 `/mock-pay` 모의 결제창이 열리고, 버튼으로 각 상황을 고를 수 있어요.

| 버튼 | 재현하는 상황 | 기대 결과 |
| --- | --- | --- |
| ✅ 결제하기 (승인) | 결제 성공 | `/donate/success` → 서버 확인 후 "후원 완료!", 합계 증가 |
| ❌ 카드사 거절 | 결제창 단계 실패 (`REJECT_CARD_COMPANY`) | `/donate/fail` "결제에 실패했어요", 주문 FAILED |
| ⚠️ 승인 단계 거절 | 결제창은 통과했지만 **서버 승인 시 결제사가 거절** (`REJECT_CARD_PAYMENT`) | 성공 페이지로 오지만 "후원이 확정되지 않았어요", 합계 그대로 |
| ↩️ 결제 취소 | 사용자가 결제창을 닫음 (`PAY_PROCESS_CANCELED`) | `/donate/fail` "결제를 취소했어요", 주문 CANCELED |

#### 자동 점검 스크립트 (성공·실패·취소·위변조·중복 통지 36개 항목)

```bash
PAYMENT_PROVIDER=mock npm start     # 터미널 1
npm run verify:donations            # 터미널 2
```

스크립트는 결제창 버튼과 같은 요청을 보내고, 결과를 서버 API로만 판단해요. 주요 항목은 이래요.

- 결제창이 성공해도 **서버가 승인하기 전에는 합계 0원**
- 남의 주문을 승인하면 403
- 같은 승인을 다시 요청하면 `duplicated: true`
- **웹훅 5회 동시 통지**, **승인 3회 + 웹훅 2회 동시**에도 적립은 1회
- 결제창 금액을 조작하면 400, 주문 금액으로 승인을 요청하면 결제사가 거절(402)
- **수신 방송자를 조작하면 검증 실패 + 자동 취소**
- 위조 웹훅은 결제사 재조회로 무시
- 카드사 거절·승인 단계 거절·취소, 확정된 주문은 취소 보고로 바뀌지 않음
- 방송별 합계·건수는 확정된 후원만 집계

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
  db.js                  PostgreSQL 연결 풀·스키마·advisory lock + broadcastRepo(라이브 claim·하트비트 포함)
  asyncHandler.js        async 라우트 에러 전달
  auth/passwords.js      scrypt 해시·검증
  auth/middleware.js     쿠키 → req.user, requireAuth(401), requireBroadcastOwner(403)
  repos/                 userRepo, sessionRepo, commentRepo
  routes/auth.js         회원가입·로그인·로그아웃·me
  routes/broadcasts.js   방송 목록·상세·업로드·수정·삭제
  routes/lives.js        라이브 시작·종료
  routes/comments.js     댓글 목록·작성·수정·삭제
  routes/donations.js    후원 주문·승인 확인·실패 보고·내역, 결제사 웹훅
  donations/donationService.js  주문 생성, 서버 승인·검증, 중복 방지(주문 잠금 + PENDING→DONE 원자 전이)
  payments/              결제 게이트웨이: tossGateway(테스트 모드) · mockGateway(모의) · mockRoutes(모의 결제창)
  repos/donationRepo.js  후원 주문 저장·상태 전이·방송별 합계
  live/liveService.js    라이브 세션 관리, ffmpeg → HLS 변환
  live/ingest.js         송출 WebSocket 수신 (쿠키·소유자·streamKey·DB claim 검사), 하트비트
public/
  index.html             방송 목록
  watch.html             상세·재생, 소유자 제어, 댓글
  live.html              휴대폰 송출
  upload.html            녹화 영상 등록
  login.html, signup.html
  donate/success.html    결제 후 돌아오는 곳 → 서버 승인 확인 결과 표시
  donate/fail.html       결제 실패·취소 결과 표시 + 서버에 보고
  payments.js            결제창 열기 (토스 SDK v2 / 모의 결제창)
  app.js, style.css      공통 유틸(로그인 상태·헤더)·스타일
scripts/
  verify-auth.mjs        권한 매트릭스 자동 점검 (npm run verify:auth)
  verify-donations.mjs   도네이션 성공·실패·취소·위변조·중복 통지 점검 (npm run verify:donations)
  cluster-up.sh          kind 클러스터 + metrics-server + 이미지 + 배포 (npm run cluster:up)
  cluster-down.sh        클러스터 삭제
  load.mjs               부하 발생 (npm run load -- --duration 180 --concurrency 60)
  watch-scale.sh         HPA·Pod 수 변화 5초마다 기록
  check-continuity.mjs   스케일 중 로그인·방송·댓글·후원·영상 유지 확인
  verify-live-handover.mjs  인스턴스 3개로 라이브 송출 인계 점검 (npm run verify:live-handover)
k8s/
  kind-config.yaml       kind 클러스터 (localhost:8080 → NodePort 30080)
  namespace.yaml, postgres.yaml, app.yaml(공유 볼륨·Deployment·Service), hpa.yaml
docs/
  scaling-log.txt        실제 실험의 인스턴스 수 변화 기록
  hpa-events.txt         HPA 스케일 이벤트
  load-log.txt           부하 실행 출력
  continuity-log.txt     스케일 중 상태 유지 확인 출력
deploy/                  6단계: VM 운영 배포
  docker-compose.prod.yml  caddy(HTTPS) + app + db
  Caddyfile              도메인 HTTPS 자동 발급·갱신, http→https, 보안 헤더
  .env.prod.example      운영 설정 예시 (실제 .env.prod 는 커밋 금지)
  setup-vm.sh            Ubuntu VM 설치·방화벽·배포·업데이트 (여러 번 실행해도 안전)
  cloud-init.yaml        OCI 인스턴스 생성 시 자동 배포
desktop/                 6단계: Electron 데스크톱 클라이언트
  main.js, preload.js    창·보안 설정, 앱 정보 전달
  renderer/              방송 목록·재생 화면 (index.html, app.js, style.css)
  config.json            기본 서버 주소
  package.json           electron-builder 설정 (Windows NSIS·zip, macOS dmg·zip)
.github/workflows/desktop.yml  Windows·macOS 러너에서 빌드 → GitHub Release
public/download.html     다운로드 페이지 (OS별 링크·아키텍처·설치 방법)
Dockerfile, .dockerignore, docker-compose.yml(개발용 Postgres)
```
