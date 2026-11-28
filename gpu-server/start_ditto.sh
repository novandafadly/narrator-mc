#!/usr/bin/env bash
# Launcher satu perintah untuk menjalankan Ditto TalkingHead + Edge TTS + Cloudflare Tunnel
# di GPU cloud (RunPod / Vast.ai / Ubuntu GPU VM).
#
# Contoh pakai:
#   SOURCE_IMAGE=/workspace/nara.jpg ./start_ditto.sh
#
# Opsional:
#   DITTO_BACKEND=auto|trt|pytorch  (default: auto)
#   DITTO_SAMPLING_TIMESTEPS=15     (15-20 untuk latensi rendah <3 detik)
#   ENABLE_TUNNEL=true|false        (default: true — ekspos https://xxxx.trycloudflare.com)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DITTO_DIR="${DITTO_DIR:-$SCRIPT_DIR/ditto-talkinghead}"
SOURCE_IMAGE="${SOURCE_IMAGE:-}"
DITTO_BACKEND="${DITTO_BACKEND:-auto}"
DITTO_SAMPLING_TIMESTEPS="${DITTO_SAMPLING_TIMESTEPS:-15}"
PORT="${PORT:-8000}"
ENABLE_TUNNEL="${ENABLE_TUNNEL:-true}"

if [ -z "$SOURCE_IMAGE" ] || [ ! -f "$SOURCE_IMAGE" ]; then
  echo "ERROR: Set SOURCE_IMAGE ke path foto potret Nara (mis. SOURCE_IMAGE=/workspace/nara.jpg $0)"
  exit 1
fi

if [ ! -d "$DITTO_DIR" ]; then
  echo ">>> Cloning antgroup/ditto-talkinghead ke $DITTO_DIR ..."
  git clone --depth 1 https://github.com/antgroup/ditto-talkinghead.git "$DITTO_DIR"
fi

echo ">>> Memastikan dependensi Python terpasang..."
pip install -q -r "$SCRIPT_DIR/requirements.txt"

CKPT_DIR="$DITTO_DIR/checkpoints"
if [ ! -d "$CKPT_DIR/ditto_pytorch" ] && [ ! -d "$CKPT_DIR/ditto_trt_Ampere_Plus" ]; then
  echo ">>> Mengunduh checkpoint Ditto PyTorch + config dari HuggingFace..."
  python3 - "$CKPT_DIR" <<'PY'
import sys
from huggingface_hub import snapshot_download

ckpt_dir = sys.argv[1]
snapshot_download(
    repo_id="digital-avatar/ditto-talkinghead",
    local_dir=ckpt_dir,
    allow_patterns=["ditto_cfg/*", "ditto_pytorch/**"],
)
print("Download selesai:", ckpt_dir)
PY
fi

if [ "$ENABLE_TUNNEL" = "true" ]; then
  if ! command -v cloudflared >/dev/null 2>&1; then
    echo ">>> Mengunduh cloudflared..."
    curl -sL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
      -o /usr/local/bin/cloudflared || curl -sL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o "$SCRIPT_DIR/cloudflared"
    chmod +x /usr/local/bin/cloudflared 2>/dev/null || chmod +x "$SCRIPT_DIR/cloudflared"
  fi
  CF_BIN="$(command -v cloudflared || echo "$SCRIPT_DIR/cloudflared")"
  echo ">>> Menjalankan Cloudflare Tunnel ke http://127.0.0.1:$PORT ..."
  "$CF_BIN" tunnel --url "http://127.0.0.1:$PORT" --no-autoupdate > /tmp/nara_cloudflared.log 2>&1 &
  CF_PID=$!
  trap 'kill $CF_PID 2>/dev/null || true' EXIT

  for _ in $(seq 1 25); do
    URL="$(grep -oE 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' /tmp/nara_cloudflared.log | head -1 || true)"
    if [ -n "$URL" ]; then
      echo "============================================================"
      echo "  NARA DITTO HTTPS URL: $URL"
      echo "  Tempel URL ini di Panel Operator kanan atas narrator-mc!"
      echo "  Unduh idle video: $URL/idle  |  poster: $URL/poster"
      echo "============================================================"
      break
    fi
    sleep 1
  done
fi

exec python3 "$SCRIPT_DIR/ditto_server.py" \
  --ditto-dir "$DITTO_DIR" \
  --source-image "$SOURCE_IMAGE" \
  --backend "$DITTO_BACKEND" \
  --sampling-timesteps "$DITTO_SAMPLING_TIMESTEPS" \
  --generate-idle \
  --port "$PORT"
