import path from 'node:path';

// 💡 모든 환경변수는 여기서 한 번만 읽어요. 다른 파일은 config만 import!
const DATA_DIR = path.resolve(process.env.DATA_DIR ?? './data');

export const config = {
  port: Number(process.env.PORT ?? 3000),
  dataDir: DATA_DIR,
  dbPath: path.join(DATA_DIR, 'chickchicken.db'),
  uploadDir: path.join(DATA_DIR, 'videos'),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB ?? 500) * 1024 * 1024,
};
