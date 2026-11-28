# Nara: build produksi. Dijalankan lewat deploy/docker-compose.yml (context = root repo).
# Tidak ada API key asli di image ini: browser hanya memegang PROXY_TOKEN, dan Caddy
# menukarnya dengan key asli dari deploy/.env.
FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund --ignore-scripts

COPY . .

ARG PROXY_TOKEN
ARG LLM_MODEL=gemini-3.1-flash-lite
ARG LLM_PATH=/v1beta/openai/chat/completions
ARG LLM_REASONING_EFFORT=
ARG FALLBACK_MODEL=
ARG FALLBACK_PATH=/openai/v1/chat/completions
ARG FALLBACK_REASONING_EFFORT=low
ARG MAX_TOKENS=1024
ARG HEDGE_MS=1500
ARG VIDEO_AVATAR_URL=
ARG VIDEO_AVATAR_ENABLED=
ARG VIDEO_AVATAR_IDLE_URL=/avatar/nara_idle.mp4
ARG VIDEO_AVATAR_VOICE=id-ID-GadisNeural
ARG TTS_BACKEND=edge_tts
ARG STT_BACKEND=browser_speech
ARG WHISPER_MODEL=whisper-large-v3-turbo
ARG VRM_URL=/avatar/model.glb

# Variabel NEXT_PUBLIC_* tertanam saat build. URL dibuat relatif (/llm, /llm2, /stt, /tts)
# sehingga image tidak bergantung pada nama domain.
RUN test -n "$PROXY_TOKEN" \
 && export NEXT_TELEMETRY_DISABLED=1 \
    NEXT_PUBLIC_DEVELOPMENT_BASE_URL=http://localhost:3000 \
    NEXT_PUBLIC_CHATBOT_BACKEND=chatgpt \
    NEXT_PUBLIC_OPENAI_URL=/llm \
    NEXT_PUBLIC_OPENAI_CHAT_PATH="$LLM_PATH" \
    NEXT_PUBLIC_OPENAI_APIKEY="$PROXY_TOKEN" \
    NEXT_PUBLIC_OPENAI_MODEL="$LLM_MODEL" \
    NEXT_PUBLIC_OPENAI_REASONING_EFFORT="$LLM_REASONING_EFFORT" \
    NEXT_PUBLIC_OPENAI_MAX_TOKENS="$MAX_TOKENS" \
    NEXT_PUBLIC_OPENAI_HEDGE_MS="$HEDGE_MS" \
    NEXT_PUBLIC_TTS_BACKEND="$TTS_BACKEND" \
    NEXT_PUBLIC_EDGE_TTS_URL=/tts \
    NEXT_PUBLIC_EDGE_TTS_VOICE="$VIDEO_AVATAR_VOICE" \
    NEXT_PUBLIC_STT_BACKEND="$STT_BACKEND" \
    NEXT_PUBLIC_OPENAI_WHISPER_URL=/stt \
    NEXT_PUBLIC_OPENAI_WHISPER_APIKEY="$PROXY_TOKEN" \
    NEXT_PUBLIC_OPENAI_WHISPER_MODEL="$WHISPER_MODEL" \
    NEXT_PUBLIC_OPENAI_WHISPER_LANGUAGE=id \
    NEXT_PUBLIC_VIDEO_AVATAR_URL="$VIDEO_AVATAR_URL" \
    NEXT_PUBLIC_VIDEO_AVATAR_IDLE_URL="$VIDEO_AVATAR_IDLE_URL" \
    NEXT_PUBLIC_VIDEO_AVATAR_VOICE="$VIDEO_AVATAR_VOICE" \
    NEXT_PUBLIC_VRM_HASH="$VRM_URL" \
    NEXT_PUBLIC_AMICA_LIFE_ENABLED=false \
    NEXT_PUBLIC_SHOW_INTRODUCTION=false \
    NEXT_PUBLIC_SHOW_ADD_TO_HOMESCREEN=false \
    NEXT_PUBLIC_NAME=Nara \
    NEXT_PUBLIC_BG_COLOR="#1c2a3a" \
 && if [ -n "$VIDEO_AVATAR_ENABLED" ]; then \
      export NEXT_PUBLIC_VIDEO_AVATAR_ENABLED="$VIDEO_AVATAR_ENABLED"; \
    fi \
 && if [ -n "$FALLBACK_MODEL" ]; then \
      export NEXT_PUBLIC_OPENAI_FALLBACK_URL=/llm2 \
        NEXT_PUBLIC_OPENAI_FALLBACK_PATH="$FALLBACK_PATH" \
        NEXT_PUBLIC_OPENAI_FALLBACK_APIKEY="$PROXY_TOKEN" \
        NEXT_PUBLIC_OPENAI_FALLBACK_MODEL="$FALLBACK_MODEL" \
        NEXT_PUBLIC_OPENAI_FALLBACK_REASONING_EFFORT="$FALLBACK_REASONING_EFFORT"; \
    fi \
 && node scripts/nara-init-storage.mjs \
 && npm run build \
 && npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 3000
CMD ["node_modules/.bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]
