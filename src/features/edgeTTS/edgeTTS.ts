import { config } from "@/utils/config";

/**
 * Fetches Indonesian neural TTS audio (id-ID-GadisNeural) from the server /tts route
 * (or configured edge_tts_url) for 3D VRM fallback mode.
 */
export async function edgeTTS(
  message: string,
  signal?: AbortSignal,
): Promise<{ audio: ArrayBuffer }> {
  const rawUrl = (config("edge_tts_url") || "/tts/").trim();
  const url = rawUrl === "/tts" ? "/tts/" : rawUrl;
  const voice = (config("edge_tts_voice") || "id-ID-GadisNeural").trim();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  // In OCI Caddy deployment, /tts uses the same PROXY_TOKEN as /llm and /stt.
  const proxyToken = config("openai_apikey");
  if (proxyToken && proxyToken !== "default") {
    headers["Authorization"] = `Bearer ${proxyToken}`;
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      text: message,
      voice,
    }),
    signal,
  });

  if (!res.ok) {
    throw new Error(`Edge TTS error (HTTP ${res.status})`);
  }

  const audio = await res.arrayBuffer();
  return { audio };
}
