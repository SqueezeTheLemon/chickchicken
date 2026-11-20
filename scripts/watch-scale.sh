#!/usr/bin/env bash
# 인스턴스 수 변화를 5초마다 기록해요 (README 에 남길 증거용)
#   ./scripts/watch-scale.sh                 # 화면에만
#   ./scripts/watch-scale.sh docs/scale.log  # 파일에도 저장
set -uo pipefail
NS=chickchicken
OUT=${1:-/dev/null}
printf '%-8s %-14s %-9s %-8s %-6s %s\n' "시각" "CPU(현재/목표)" "희망Pod" "현재Pod" "Ready" "Pod별 CPU" | tee -a "$OUT"
while true; do
  T=$(date +%H:%M:%S)
  HPA=$(kubectl -n $NS get hpa chickchicken -o jsonpath='{.status.currentMetrics[0].resource.current.averageUtilization}/{.spec.metrics[0].resource.target.averageUtilization} {.status.desiredReplicas} {.status.currentReplicas}' 2>/dev/null)
  read -r CPU DESIRED CURRENT <<<"$HPA"
  READY=$(kubectl -n $NS get pods -l app=chickchicken --no-headers 2>/dev/null | awk '$2 ~ /^1\/1/ && $3=="Running"' | wc -l | tr -d ' ')
  TOP=$(kubectl -n $NS top pods -l app=chickchicken --no-headers 2>/dev/null | awk '{printf "%s=%s ", substr($1, length($1)-4), $2}')
  printf '%-8s %-14s %-9s %-8s %-6s %s\n' "$T" "${CPU:-?}%" "${DESIRED:-?}" "${CURRENT:-?}" "$READY" "$TOP" | tee -a "$OUT"
  sleep 5
done
