#!/usr/bin/env bash
# 로컬 kind 클러스터 삭제 (DB·업로드 영상도 함께 사라져요)
set -euo pipefail
kind delete cluster --name chickchicken
