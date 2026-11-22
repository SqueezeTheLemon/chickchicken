#!/usr/bin/env bash
# 6단계: 리눅스 VM 한 대에 chickchicken 을 배포/업데이트해요 (여러 번 실행해도 안전)
#   OCI Always Free (Ubuntu 22.04/24.04, ARM64 A1 또는 x86 E2.1.Micro) 기준으로 만들었지만 다른 Ubuntu VM 에서도 동작해요.
#
#   사용법 (VM 에 SSH 접속한 뒤):
#     curl -fsSLO https://raw.githubusercontent.com/SqueezeTheLemon/chickchicken/main/deploy/setup-vm.sh
#     sudo bash setup-vm.sh --domain chickchicken.example.com --email you@example.com
#   업데이트: sudo bash /opt/chickchicken/deploy/setup-vm.sh   (기존 .env.prod 를 그대로 써요)
set -euo pipefail

REPO=https://github.com/SqueezeTheLemon/chickchicken.git
BRANCH=main
APP_DIR=/opt/chickchicken
DOMAIN=""
EMAIL=""
while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN=$2; shift 2 ;;
    --email) EMAIL=$2; shift 2 ;;
    --repo) REPO=$2; shift 2 ;;
    --branch) BRANCH=$2; shift 2 ;;
    *) echo "알 수 없는 옵션: $1"; exit 1 ;;
  esac
done

step() { printf '\n\033[1;32m▶ %s\033[0m\n' "$*"; }
[ "$(id -u)" -eq 0 ] || { echo "sudo 로 실행해 주세요"; exit 1; }

step "1/6 패키지 (git, Docker, Compose)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y git ca-certificates curl iptables-persistent docker.io docker-compose-v2 || \
  apt-get install -y git ca-certificates curl iptables-persistent docker.io docker-compose-plugin
systemctl enable --now docker
SUDO_USER_NAME=${SUDO_USER:-ubuntu}
id "$SUDO_USER_NAME" >/dev/null 2>&1 && usermod -aG docker "$SUDO_USER_NAME" || true

step "2/6 메모리가 작으면 스왑 2GB (E2.1.Micro 1GB 대비, 이미지 빌드·ffmpeg 용)"
MEM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
if [ "$MEM_MB" -lt 3000 ] && ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q /swapfile /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

step "3/6 VM 방화벽 80/443 열기"
# 💡 OCI 의 Ubuntu 이미지는 iptables 에 REJECT 규칙이 기본으로 있어서, VCN 보안 목록과 별개로 여기서도 열어야 해요
for PORT in 80 443; do
  iptables -C INPUT -p tcp --dport "$PORT" -j ACCEPT 2>/dev/null || iptables -I INPUT 5 -p tcp --dport "$PORT" -j ACCEPT
done
iptables -C INPUT -p udp --dport 443 -j ACCEPT 2>/dev/null || iptables -I INPUT 5 -p udp --dport 443 -j ACCEPT
netfilter-persistent save || true

step "4/6 소스 받기 ($REPO@$BRANCH → $APP_DIR)"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch --depth 1 origin "$BRANCH"
  git -C "$APP_DIR" reset --hard "origin/$BRANCH"
else
  git clone --depth 1 --branch "$BRANCH" "$REPO" "$APP_DIR"
fi
cd "$APP_DIR/deploy"
export GIT_SHA=$(git -C "$APP_DIR" rev-parse --short HEAD)

step "5/6 운영 설정 (deploy/.env.prod)"
if [ ! -f .env.prod ]; then
  [ -n "$DOMAIN" ] && [ -n "$EMAIL" ] || { echo "처음 설치에는 --domain 과 --email 이 필요해요"; exit 1; }
  cp .env.prod.example .env.prod
  sed -i "s|^DOMAIN=.*|DOMAIN=$DOMAIN|; s|^ACME_EMAIL=.*|ACME_EMAIL=$EMAIL|" .env.prod
  sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 24)|" .env.prod # 랜덤 비밀번호
  chmod 600 .env.prod
  echo "   .env.prod 를 만들었어요 (DB 비밀번호 자동 생성). 토스 테스트 키는 필요하면 직접 넣으세요."
fi
DOMAIN=$(grep -E '^DOMAIN=' .env.prod | cut -d= -f2-)

step "6/6 빌드·실행 (commit $GIT_SHA)"
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
docker image prune -f >/dev/null

echo "   상태 확인 대기…"
for i in $(seq 1 60); do
  if curl -fsS "https://$DOMAIN/api/health" >/dev/null 2>&1; then
    echo
    curl -fsS "https://$DOMAIN/api/health"; echo
    echo "✅ https://$DOMAIN  (다운로드 페이지: https://$DOMAIN/download)"
    exit 0
  fi
  sleep 5
done
echo "⚠️  아직 https://$DOMAIN 에 연결되지 않아요. DNS(A 레코드)·OCI 보안 목록(80/443)·'docker compose logs caddy' 를 확인하세요."
docker compose -f docker-compose.prod.yml --env-file .env.prod ps
