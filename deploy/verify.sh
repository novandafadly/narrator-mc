#!/usr/bin/env bash
# Pemeriksaan Nara di server. Tidak mencetak key atau password.
#   BASIC_PASSWORD='...' ./verify.sh https://SITE [--live]
# Token proxy dibaca dari deploy/.env (atau variabel PROXY_TOKEN). --live mengirim
# SATU permintaan kecil ke Gemini lewat proxy (memakai sedikit kuota) dan mengukur waktunya.
set -u
SITE="${1:-}"; LIVE="${2:-}"
[ -n "$SITE" ] || { echo "Pakai: BASIC_PASSWORD='...' $0 https://SITE [--live]"; exit 2; }
SITE="${SITE%/}"
DIR="$(cd "$(dirname "$0")" && pwd)"
USER_NAME="${BASIC_USER:-nara}"
[ -n "${BASIC_PASSWORD:-}" ] || { echo "Set BASIC_PASSWORD dulu (mis. read -rs BASIC_PASSWORD; export BASIC_PASSWORD)"; exit 2; }
if [ -z "${PROXY_TOKEN:-}" ] && [ -f "$DIR/.env" ]; then
  PROXY_TOKEN="$(grep -E '^PROXY_TOKEN=' "$DIR/.env" | head -1 | cut -d= -f2- | tr -d "'\"")"
fi
[ -n "${PROXY_TOKEN:-}" ] || { echo "PROXY_TOKEN tidak ditemukan"; exit 2; }

pass=0; fail=0
chk() { if [ "$2" = "$3" ]; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1 (dapat: $2, seharusnya: $3)"; fail=$((fail+1)); fi; }
code() { curl -s -o /dev/null -w '%{http_code}' --max-time 30 "$@"; }
BODY='{"model":"x","messages":[{"role":"user","content":"hai"}],"stream":true,"max_tokens":8}'

chk "halaman tanpa password"            "$(code "$SITE/")" 401
chk "halaman password salah"            "$(code -u "$USER_NAME:salah-pasti" "$SITE/")" 401
chk "halaman password benar"            "$(code -u "$USER_NAME:$BASIC_PASSWORD" "$SITE/")" 200
chk "/api/dataHandler diblokir"         "$(code -u "$USER_NAME:$BASIC_PASSWORD" "$SITE/api/dataHandler?type=config")" 404
chk "/llm tanpa token"                  "$(code -X POST "$SITE/llm/v1beta/openai/chat/completions" -d "$BODY")" 401
chk "/llm token salah"                  "$(code -X POST -H 'Authorization: Bearer salah' "$SITE/llm/v1beta/openai/chat/completions" -d "$BODY")" 401
chk "/llm2 tanpa token"                 "$(code -X POST "$SITE/llm2/openai/v1/chat/completions" -d "$BODY")" 401
chk "/stt tanpa token"                  "$(code -X POST "$SITE/stt/v1/audio/transcriptions" -d x)" 401
chk "/tts tanpa token"                  "$(code -X POST -H 'Content-Type: application/json' "$SITE/tts" -d '{"text":"tes"}')" 401

case "$SITE" in https://*)
  # tanpa -k: gagal jika sertifikat tidak valid
  chk "sertifikat HTTPS valid" "$(code "$SITE/")" 401 ;;
esac

if [ "$LIVE" = "--live" ]; then
  MODEL="$(grep -E '^LLM_MODEL=' "$DIR/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d "'\"")"
  PATHP="$(grep -E '^LLM_PATH=' "$DIR/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d "'\"")"; PATHP="${PATHP:-/v1beta/openai/chat/completions}"
  LBODY="{\"model\":\"${MODEL:-gemini-3.1-flash-lite}\",\"messages\":[{\"role\":\"user\",\"content\":\"Jawab satu kata: halo\"}],\"stream\":true,\"max_tokens\":64}"
  echo "--- live: 1 permintaan ke LLM lewat proxy"
  OUT="$(curl -s --max-time 60 -o /tmp/nara-live.out -w '%{http_code} ttfb=%{time_starttransfer}s total=%{time_total}s' -X POST -H "Authorization: Bearer $PROXY_TOKEN" -H 'Content-Type: application/json' "$SITE/llm$PATHP" -d "$LBODY")"
  echo "live: $OUT"
  head -c 200 /tmp/nara-live.out | tr '\n' ' '; echo; rm -f /tmp/nara-live.out
  case "$OUT" in 200*) pass=$((pass+1));; *) fail=$((fail+1));; esac
fi

echo "ringkas: pass=$pass fail=$fail"
[ "$fail" -eq 0 ]
