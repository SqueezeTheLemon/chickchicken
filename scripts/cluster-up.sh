#!/usr/bin/env bash
# 로컬 kind 클러스터에 chickchicken 을 여러 인스턴스 + 오토스케일로 띄워요 (여러 번 실행해도 안전)
#   ./scripts/cluster-up.sh
# 준비물: Docker Desktop, kind (brew install kind), kubectl
set -euo pipefail
cd "$(dirname "$0")/.."

CLUSTER=chickchicken
NS=chickchicken
IMAGE=chickchicken:local
METRICS_SERVER_VERSION=v0.7.2

step() { printf '\n\033[1;32m▶ %s\033[0m\n' "$*"; }

step "1/6 kind 클러스터"
if ! kind get clusters 2>/dev/null | grep -qx "$CLUSTER"; then
  kind create cluster --name "$CLUSTER" --config k8s/kind-config.yaml
fi
kubectl config use-context "kind-$CLUSTER" >/dev/null

step "2/6 metrics-server (HPA 가 CPU 사용률을 읽는 곳)"
kubectl apply -f "https://github.com/kubernetes-sigs/metrics-server/releases/download/${METRICS_SERVER_VERSION}/components.yaml" >/dev/null
# kind 의 kubelet 은 자체 서명 인증서라 이 옵션이 필요해요 (로컬 전용)
if ! kubectl -n kube-system get deploy metrics-server -o jsonpath='{.spec.template.spec.containers[0].args}' | grep -q kubelet-insecure-tls; then
  kubectl -n kube-system patch deployment metrics-server --type=json \
    -p '[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]' >/dev/null
fi

step "3/6 이미지 빌드 → 클러스터에 넣기"
docker build -t "$IMAGE" .
kind load docker-image "$IMAGE" --name "$CLUSTER"

step "4/6 네임스페이스 · Secret (비밀번호는 랜덤 생성, 저장소에 남기지 않아요)"
kubectl apply -f k8s/namespace.yaml >/dev/null
if ! kubectl -n "$NS" get secret chickchicken-db >/dev/null 2>&1; then
  kubectl -n "$NS" create secret generic chickchicken-db --from-literal=password="$(openssl rand -hex 16)" >/dev/null
fi
# .env 에 토스 테스트 키가 있으면 Secret 으로 (없으면 앱이 모의 결제로 떠요)
if [ -f .env ]; then
  TOSS_CLIENT_KEY=$(grep -E '^TOSS_CLIENT_KEY=' .env | cut -d= -f2- || true)
  TOSS_SECRET_KEY=$(grep -E '^TOSS_SECRET_KEY=' .env | cut -d= -f2- || true)
  if [ -n "${TOSS_CLIENT_KEY}" ] && [ -n "${TOSS_SECRET_KEY}" ]; then
    kubectl -n "$NS" create secret generic chickchicken-toss \
      --from-literal=clientKey="$TOSS_CLIENT_KEY" --from-literal=secretKey="$TOSS_SECRET_KEY" \
      --dry-run=client -o yaml | kubectl apply -f - >/dev/null
    echo "   토스 테스트 키 Secret 적용"
  fi
fi

step "5/6 Postgres · 앱 · HPA 배포"
kubectl apply -f k8s/postgres.yaml -f k8s/app.yaml -f k8s/hpa.yaml
kubectl -n "$NS" rollout status deploy/postgres --timeout=180s
# 같은 태그로 이미지를 다시 넣었으면 Pod 를 새로 띄워야 반영돼요
kubectl -n "$NS" rollout restart deploy/chickchicken >/dev/null
kubectl -n "$NS" rollout status deploy/chickchicken --timeout=240s

step "6/6 상태"
kubectl -n kube-system rollout status deploy/metrics-server --timeout=180s >/dev/null || true
kubectl -n "$NS" get pods -o wide
kubectl -n "$NS" get hpa
echo
echo "✅ http://localhost:8080 (Service → Pod 여러 개)"
echo "   부하 걸기:   node scripts/load.mjs --duration 180 --concurrency 60"
echo "   스케일 관찰: ./scripts/watch-scale.sh"
