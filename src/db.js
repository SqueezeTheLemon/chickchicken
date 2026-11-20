import pg from 'pg';
import { config } from './config.js';

/**
 * 5단계: SQLite 파일 → PostgreSQL
 * 💡 인스턴스가 여러 개면 "각자 가진 파일"이 아니라 "모두가 같이 보는 DB"가 필요해요.
 *    사용자·세션·방송·댓글·후원·라이브 진행 상태가 전부 여기 있어서, 어느 인스턴스가 요청을 받아도 같은 결과예요.
 */
export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: config.dbPoolMax });
pool.on('error', (e) => console.error('[db] idle client error', e.message));

/** 쿼리 실행 → rows */
export const query = async (text, params) => (await pool.query(text, params)).rows;
/** 첫 행 하나 */
export const queryOne = async (text, params) => (await pool.query(text, params)).rows[0];
/** 영향받은 행 수 */
export const execute = async (text, params) => (await pool.query(text, params)).rowCount;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id             INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    username       TEXT        NOT NULL,                    -- 로그인 아이디
    nickname       TEXT        NOT NULL,                    -- 화면에 보이는 이름
    password_hash  TEXT        NOT NULL,                    -- scrypt 해시 (평문 저장 X)
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  -- 아이디는 대소문자 구분 없이 유일
  CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower ON users (lower(username));

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash  TEXT        PRIMARY KEY,                    -- 쿠키 토큰의 SHA-256 (DB 가 유출돼도 토큰은 모름)
    user_id     INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS broadcasts (
    id                INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    kind              TEXT        NOT NULL DEFAULT 'vod',     -- vod | live
    status            TEXT        NOT NULL DEFAULT 'ended',   -- live(방송 중) | ended(종료)
    title             TEXT        NOT NULL,
    description       TEXT        NOT NULL DEFAULT '',
    video_path        TEXT        NOT NULL,                   -- vod: uploadDir 기준 파일명 / live: liveDir 기준 폴더명
    mime_type         TEXT        NOT NULL,
    size_bytes        BIGINT      NOT NULL,
    owner_id          INTEGER     REFERENCES users(id) ON DELETE SET NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at          TIMESTAMPTZ,
    -- 5단계: 라이브 송출 상태 (메모리 → DB). 어느 인스턴스가 송출을 맡았고 살아 있는지
    stream_key_hash   TEXT,                                   -- 송출 키 해시 (어느 인스턴스로 붙어도 검사 가능)
    live_instance_id  TEXT,                                   -- 지금 송출을 받고 있는 인스턴스 (없으면 NULL)
    live_heartbeat_at TIMESTAMPTZ,                            -- 맡은 인스턴스의 마지막 생존 신호
    end_requested_at  TIMESTAMPTZ                             -- 다른 인스턴스가 받은 "종료" 요청
  );

  CREATE TABLE IF NOT EXISTS comments (
    id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    broadcast_id  INTEGER     NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
    user_id       INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content       TEXT        NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ
  );
  CREATE INDEX IF NOT EXISTS idx_comments_broadcast ON comments (broadcast_id, id);

  -- 4단계: 도네이션. 주문(PENDING)을 먼저 만들고, 서버가 결제 승인을 확인한 뒤에만 DONE 으로 바꿔요
  CREATE TABLE IF NOT EXISTS donations (
    id               INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id         TEXT        NOT NULL UNIQUE,            -- 결제사에 넘기는 주문번호
    broadcast_id     INTEGER     REFERENCES broadcasts(id) ON DELETE SET NULL, -- 방송이 지워져도 후원 기록은 남겨요
    broadcast_title  TEXT        NOT NULL,                   -- 주문 당시 방송 제목 스냅샷
    streamer_id      INTEGER     NOT NULL REFERENCES users(id), -- 수신 대상: 주문 생성 시 서버가 방송 소유자로 고정
    donor_id         INTEGER     NOT NULL REFERENCES users(id),
    amount           INTEGER     NOT NULL CHECK (amount > 0),
    message          TEXT        NOT NULL DEFAULT '',
    provider         TEXT        NOT NULL,                   -- toss | mock
    status           TEXT        NOT NULL DEFAULT 'PENDING', -- PENDING | DONE | FAILED | CANCELED
    payment_key      TEXT        UNIQUE,                     -- 같은 결제가 두 주문에 쓰이지 못하게
    method           TEXT,
    fail_code        TEXT,
    fail_message     TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    approved_at      TIMESTAMPTZ,
    updated_at       TIMESTAMPTZ
  );
  CREATE INDEX IF NOT EXISTS idx_donations_broadcast ON donations (broadcast_id, status);

  -- 5단계: 모의 결제사 상태도 메모리 → DB (결제창 인증과 승인 요청이 서로 다른 인스턴스로 가도 되게)
  CREATE TABLE IF NOT EXISTS mock_payments (
    payment_key        TEXT        PRIMARY KEY,
    order_id           TEXT        NOT NULL UNIQUE,
    order_name         TEXT        NOT NULL DEFAULT '',
    amount             INTEGER     NOT NULL,
    status             TEXT        NOT NULL,                 -- IN_PROGRESS | DONE | ABORTED | CANCELED
    metadata           JSONB       NOT NULL DEFAULT '{}',
    reject_on_confirm  BOOLEAN     NOT NULL DEFAULT false,
    requested_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    approved_at        TIMESTAMPTZ,
    cancel_reason      TEXT
  );
`;

/**
 * 스키마 준비. 💡 인스턴스 여러 개가 동시에 떠도 한 번에 하나만 만들도록 advisory lock 으로 줄 세워요
 * (CREATE TABLE IF NOT EXISTS 도 동시에 실행되면 충돌할 수 있어요)
 */
export async function initDb() {
  // DB 가 앱보다 늦게 뜰 수 있어요 (클러스터 첫 배포 등) → 최대 60초 재시도
  let client;
  for (let attempt = 1; ; attempt++) {
    try {
      client = await pool.connect();
      break;
    } catch (e) {
      if (attempt >= 30) throw e;
      console.log(`[db] 연결 대기 중… (${attempt}/30) ${e.code ?? e.message}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  try {
    await client.query('SELECT pg_advisory_lock(727001)');
    await client.query(SCHEMA);
  } finally {
    await client.query('SELECT pg_advisory_unlock(727001)').catch(() => {});
    client.release();
  }
}

/**
 * 같은 키(예: 주문번호)에 대한 작업을 모든 인스턴스에 걸쳐 한 번에 하나만 실행 (Postgres advisory lock)
 * 💡 메모리 잠금은 인스턴스 안에서만 통해요. 여러 인스턴스면 DB 가 줄을 세워야 해요.
 */
export async function withAdvisoryLock(key, fn) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [key]);
    try {
      return await fn();
    } finally {
      await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [key]);
    }
  } finally {
    client.release();
  }
}

export const HLS_MIME = 'application/vnd.apple.mpegurl';

const iso = (d) => (d ? new Date(d).toISOString() : null);

const toBroadcast = (row) =>
  row && {
    id: row.id,
    kind: row.kind,
    status: row.status,
    title: row.title,
    description: row.description,
    owner: row.owner_id ? { id: row.owner_id, nickname: row.owner_nickname } : null,
    videoUrl:
      row.kind === 'live'
        ? `/hls/${encodeURIComponent(row.video_path)}/index.m3u8`
        : `/videos/${encodeURIComponent(row.video_path)}`,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    createdAt: iso(row.created_at),
    endedAt: iso(row.ended_at),
  };

const SELECT_WITH_OWNER = `
  SELECT b.*, u.nickname AS owner_nickname
  FROM broadcasts b LEFT JOIN users u ON u.id = b.owner_id`;

export const broadcastRepo = {
  async create({ title, description, videoPath, mimeType, sizeBytes, ownerId }) {
    const { id } = await queryOne(
      `INSERT INTO broadcasts (kind, status, title, description, video_path, mime_type, size_bytes, owner_id)
       VALUES ('vod', 'ended', $1, $2, $3, $4, $5, $6) RETURNING id`,
      [title, description, videoPath, mimeType, sizeBytes, ownerId],
    );
    return this.findById(id);
  },
  async createLive({ title, description, ownerId, streamKeyHash }) {
    // 폴더명은 id 로 정해요. 하트비트를 "지금"으로 두면, 30초 안에 송출이 안 붙을 때 정리 대상이 돼요
    const { id } = await queryOne(
      `INSERT INTO broadcasts (kind, status, title, description, video_path, mime_type, size_bytes, owner_id,
                               stream_key_hash, live_heartbeat_at)
       VALUES ('live', 'live', $1, $2, '', $3, 0, $4, $5, now()) RETURNING id`,
      [title, description, HLS_MIME, ownerId, streamKeyHash],
    );
    await execute('UPDATE broadcasts SET video_path = $1 WHERE id = $2', [String(id), id]);
    return this.findById(id);
  },
  async update(id, { title, description }) {
    await execute('UPDATE broadcasts SET title = $1, description = $2 WHERE id = $3', [title, description, id]);
    return this.findById(id);
  },
  async delete(id) {
    return (await execute('DELETE FROM broadcasts WHERE id = $1', [id])) > 0;
  },
  /** 파일 정리·라이브 상태 확인용 원본 행 (video_path, live_instance_id 등 내부 값 포함) */
  findRawById(id) {
    return queryOne('SELECT * FROM broadcasts WHERE id = $1', [id]);
  },
  async findAll() {
    return (await query(`${SELECT_WITH_OWNER} ORDER BY (b.status = 'live') DESC, b.id DESC`)).map(toBroadcast);
  },
  async findById(id) {
    return toBroadcast(await queryOne(`${SELECT_WITH_OWNER} WHERE b.id = $1`, [id]));
  },

  // ---------- 5단계: 라이브 송출 상태 (인스턴스 간 공유) ----------

  /**
   * 송출 소켓을 이 인스턴스가 맡기 (원자적). 성공하면 true.
   * 아무도 안 맡았거나, 맡았던 인스턴스의 하트비트가 끊겼을 때만 가져올 수 있어요.
   */
  async claimLive(id, streamKeyHash, instanceId, staleMs) {
    const n = await execute(
      `UPDATE broadcasts SET live_instance_id = $3, live_heartbeat_at = now()
       WHERE id = $1 AND kind = 'live' AND status = 'live' AND end_requested_at IS NULL
         AND stream_key_hash = $2
         AND (live_instance_id IS NULL OR live_heartbeat_at < now() - make_interval(secs => $4))`,
      [id, streamKeyHash, instanceId, staleMs / 1000],
    );
    return n > 0;
  },
  /** 맡은 방송들의 하트비트 갱신 → 아직 내가 맡고 있는 방송과 종료 요청 여부를 돌려줘요 */
  heartbeat(ids, instanceId) {
    if (!ids.length) return [];
    return query(
      `UPDATE broadcasts SET live_heartbeat_at = now()
       WHERE id = ANY($1::int[]) AND live_instance_id = $2
       RETURNING id, status, end_requested_at`,
      [ids, instanceId],
    );
  },
  /** 송출 소켓을 놓기 (인스턴스 종료·스케일 인 시) → 다른 인스턴스가 이어받을 수 있게 */
  releaseLive(id, instanceId) {
    return execute(
      'UPDATE broadcasts SET live_instance_id = NULL, live_heartbeat_at = now() WHERE id = $1 AND live_instance_id = $2',
      [id, instanceId],
    );
  },
  /** 종료 요청 기록 → 송출을 맡은 인스턴스가 하트비트 때 보고 종료해요 */
  requestEnd(id) {
    return queryOne(
      `UPDATE broadcasts SET end_requested_at = COALESCE(end_requested_at, now())
       WHERE id = $1 AND status = 'live' RETURNING live_instance_id, live_heartbeat_at`,
      [id],
    );
  },
  /** @returns {Promise<boolean>} 실제로 방송 중 → 종료로 바뀌었는지 (여러 인스턴스가 동시에 불러도 한 번만 true) */
  async end(id) {
    return (
      (await execute(
        `UPDATE broadcasts SET status = 'ended', ended_at = now(), live_instance_id = NULL
         WHERE id = $1 AND status = 'live'`,
        [id],
      )) > 0
    );
  },
  /** 송출이 끊긴 채 오래된 라이브 (하트비트가 staleMs 이상 없음) */
  async findStaleLiveIds(staleMs) {
    const rows = await query(
      `SELECT id FROM broadcasts WHERE status = 'live' AND live_heartbeat_at < now() - make_interval(secs => $1)`,
      [staleMs / 1000],
    );
    return rows.map((r) => r.id);
  },
};
