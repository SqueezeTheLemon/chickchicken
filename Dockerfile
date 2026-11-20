# chickchicken 서버 이미지 (5단계)
#   docker build -t chickchicken:local .
FROM node:22-alpine

# 라이브 송출(WebM/MP4 → HLS) 변환용
RUN apk add --no-cache ffmpeg

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY public ./public

# DATA_DIR: 여러 인스턴스가 같이 마운트하는 공유 볼륨 (업로드 영상, 라이브 HLS)
# DATABASE_URL 등 나머지 설정은 실행 환경(k8s Secret/Env)에서 넣어요 — 이미지에 비밀 값 X
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data
RUN mkdir -p /data && chown node:node /data
EXPOSE 3000

USER node
CMD ["node", "--no-warnings", "src/server.js"]
