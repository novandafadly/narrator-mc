import crypto from "crypto";

export const EDGE_TTS_TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
export const EDGE_TTS_CHROMIUM_FULL_VERSION = "130.0.2849.68";
export const EDGE_TTS_SEC_MS_GEC_VERSION = `1-${EDGE_TTS_CHROMIUM_FULL_VERSION}`;
export const EDGE_TTS_DEFAULT_VOICE = "id-ID-GadisNeural";
export const EDGE_TTS_OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";

const WIN_EPOCH_OFFSET_SEC = 11644473600;
const TICKS_PER_SECOND = 10_000_000;

export function escapeXml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Generates the Sec-MS-GEC token required by Microsoft Edge Read Aloud WebSocket endpoint.
 * Matches the algorithm used by edge-tts (rounded 5-minute Windows FILETIME ticks + trusted token, SHA-256 uppercase).
 */
export function generateSecMsGec(nowMs: number = Date.now()): string {
  let ticks = Math.floor(nowMs / 1000) + WIN_EPOCH_OFFSET_SEC;
  ticks -= ticks % 300;
  const ticks100ns = BigInt(ticks) * BigInt(TICKS_PER_SECOND);
  const payload = `${ticks100ns.toString()}${EDGE_TTS_TRUSTED_CLIENT_TOKEN}`;
  return crypto.createHash("sha256").update(payload, "ascii").digest("hex").toUpperCase();
}

export function buildEdgeTtsWsUrl(connectionId: string, nowMs: number = Date.now()): string {
  const secMsGec = generateSecMsGec(nowMs);
  const params = new URLSearchParams({
    TrustedClientToken: EDGE_TTS_TRUSTED_CLIENT_TOKEN,
    ConnectionId: connectionId,
    "Sec-MS-GEC": secMsGec,
    "Sec-MS-GEC-Version": EDGE_TTS_SEC_MS_GEC_VERSION,
  });
  return `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?${params.toString()}`;
}

export function buildSsml(
  text: string,
  voice: string = EDGE_TTS_DEFAULT_VOICE,
  rate: string = "+0%",
  pitch: string = "+0Hz",
): string {
  const safeVoice = /^[a-zA-Z0-9-]+$/.test(voice) ? voice : EDGE_TTS_DEFAULT_VOICE;
  const safeRate = /^[+-]?\d+%$/.test(rate) ? rate : "+0%";
  const safePitch = /^[+-]?\d+Hz$/.test(pitch) ? pitch : "+0Hz";
  const langMatch = safeVoice.match(/^([a-z]{2}-[A-Z]{2})/);
  const lang = langMatch ? langMatch[1] : "id-ID";

  return (
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${lang}'>` +
    `<voice name='${safeVoice}'>` +
    `<prosody pitch='${safePitch}' rate='${safeRate}' volume='+0%'>` +
    `${escapeXml(text)}` +
    `</prosody></voice></speak>`
  );
}
