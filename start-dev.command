#!/bin/zsh

set -u

ROOT="${0:A:h}"
FRONTEND_URL="http://127.0.0.1:11422/"
BACKEND_URL="http://127.0.0.1:18766/api/status"
VITE_BIN="$ROOT/node_modules/.bin/vite"
ELECTRON_BIN="$ROOT/node_modules/.bin/electron"

cd "$ROOT" || exit 1

echo "=========================================="
echo "T8-penguin-canvas 网页开发启动器"
echo "=========================================="

if [[ ! -x "$VITE_BIN" || ! -x "$ELECTRON_BIN" ]]; then
  echo "[失败] 根目录依赖未安装。请先运行："
  echo "  cd \"$ROOT\" && npm install"
  exit 1
fi

if [[ ! -f "$ROOT/backend/src/server.js" ]]; then
  echo "[失败] 找不到后端入口：$ROOT/backend/src/server.js"
  exit 1
fi

backend_pid=""
frontend_pid=""
started_backend=0
started_frontend=0

cleanup() {
  if [[ "$started_frontend" == "1" && -n "$frontend_pid" ]]; then
    kill "$frontend_pid" 2>/dev/null || true
  fi
  if [[ "$started_backend" == "1" && -n "$backend_pid" ]]; then
    kill "$backend_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

wait_for_url() {
  local url="$1"
  local label="$2"
  local attempts=0
  while (( attempts < 60 )); do
    if curl --silent --fail --max-time 1 "$url" >/dev/null 2>&1; then
      echo "[就绪] $label：$url"
      return 0
    fi
    sleep 1
    (( attempts += 1 ))
  done
  echo "[失败] $label启动超时：$url"
  return 1
}

if curl --silent --fail --max-time 1 "$BACKEND_URL" >/dev/null 2>&1; then
  echo "[复用] 后端已经运行"
else
  echo "[启动] 后端：18766"
  (cd "$ROOT" && ELECTRON_RUN_AS_NODE=1 "$ELECTRON_BIN" backend/src/server.js) &
  backend_pid=$!
  started_backend=1
  wait_for_url "$BACKEND_URL" "后端" || exit 1
fi

if curl --silent --fail --max-time 1 "$FRONTEND_URL" >/dev/null 2>&1; then
  echo "[复用] 前端已经运行"
else
  echo "[启动] 前端：11422"
  (cd "$ROOT" && "$VITE_BIN") &
  frontend_pid=$!
  started_frontend=1
  wait_for_url "$FRONTEND_URL" "前端" || exit 1
fi

echo "------------------------------------------"
echo "已启动：$FRONTEND_URL"
echo "关闭此终端窗口会停止本次由启动器启动的服务。"
echo "------------------------------------------"
open "$FRONTEND_URL"

while true; do
  if [[ "$started_backend" == "1" ]] && ! kill -0 "$backend_pid" 2>/dev/null; then
    echo "[退出] 后端进程已结束。"
    exit 1
  fi
  if [[ "$started_frontend" == "1" ]] && ! kill -0 "$frontend_pid" 2>/dev/null; then
    echo "[退出] 前端进程已结束。"
    exit 1
  fi
  sleep 2
done
