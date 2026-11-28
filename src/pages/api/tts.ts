import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";
import WebSocket from "ws";
import {
  buildEdgeTtsWsUrl,
  buildSsml,
  EDGE_TTS_CHROMIUM_FULL_VERSION,
  EDGE_TTS_DEFAULT_VOICE,
  EDGE_TTS_OUTPUT_FORMAT,
} from "@/features/edgeTTS/edgeTtsProtocol";

const MAX_TEXT_LENGTH = 2000;
const WS_TIMEOUT_MS = 15000;

function synthesizeWithEdgeWs(
  text: string,
  voice: string,
  rate: string,
  pitch: string,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const connectionId = crypto.randomBytes(16).toString("hex");
    const requestId = crypto.randomBytes(16).toString("hex");
    const wsUrl = buildEdgeTtsWsUrl(connectionId);
    const chunks: Buffer[] = [];
    let settled = false;

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // ignore close errors
      }
      if (err) {
        reject(err);
      } else {
        resolve(Buffer.concat(chunks));
      }
    };

    const ws = new WebSocket(wsUrl, {
      headers: {
        Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
        "User-Agent": `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${EDGE_TTS_CHROMIUM_FULL_VERSION} Safari/537.36 Edg/${EDGE_TTS_CHROMIUM_FULL_VERSION}`,
      },
    });

    const timer = setTimeout(() => {
      finish(new Error("Edge TTS synthesis timed out"));
    }, WS_TIMEOUT_MS);

    ws.on("open", () => {
      const timestamp = new Date().toUTCString();
      const configMsg =
        `X-Timestamp:${timestamp}\r\n` +
        `Content-Type:application/json; charset=utf-8\r\n` +
        `Path:speech.config\r\n\r\n` +
        JSON.stringify({
          context: {
            synthesis: {
              audio: {
                metadataoptions: {
                  sentenceBoundaryEnabled: "false",
                  wordBoundaryEnabled: "false",
                },
                outputFormat: EDGE_TTS_OUTPUT_FORMAT,
              },
            },
          },
        });

      const ssml = buildSsml(text, voice, rate, pitch);
      const ssmlMsg =
        `X-RequestId:${requestId}\r\n` +
        `Content-Type:application/ssml+xml\r\n` +
        `X-Timestamp:${timestamp}\r\n` +
        `Path:ssml\r\n\r\n` +
        ssml;

      ws.send(configMsg);
      ws.send(ssmlMsg);
    });

    ws.on("message", (data: WebSocket.RawData, isBinary: boolean) => {
      if (!isBinary) {
        const msg = data.toString("utf8");
        if (msg.includes("Path:turn.end")) {
          if (chunks.length === 0) {
            finish(new Error("Edge TTS returned empty audio"));
          } else {
            finish();
          }
        }
        return;
      }

      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      if (buf.length < 2) return;
      const headerLen = buf.readUInt16BE(0);
      const audioStart = 2 + headerLen;
      if (audioStart < buf.length) {
        chunks.push(buf.subarray(audioStart));
      }
    });

    ws.on("error", (err) => {
      finish(new Error(`Edge TTS WebSocket error: ${err.message}`));
    });

    ws.on("close", () => {
      if (!settled) {
        if (chunks.length > 0) {
          finish();
        } else {
          finish(new Error("Edge TTS WebSocket closed before audio completed"));
        }
      }
    });
  });
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const voice = typeof body.voice === "string" && body.voice.trim()
    ? body.voice.trim()
    : EDGE_TTS_DEFAULT_VOICE;
  const rate = typeof body.rate === "string" ? body.rate : "+0%";
  const pitch = typeof body.pitch === "string" ? body.pitch : "+0Hz";

  if (!text) {
    return res.status(400).json({ error: "Missing text" });
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return res.status(400).json({ error: "Text too long" });
  }

  // Optional override: forward to self-hosted openai-edge-tts sidecar if configured
  const upstreamUrl = process.env.EDGE_TTS_UPSTREAM_URL;
  if (upstreamUrl) {
    try {
      const upstreamRes = await fetch(upstreamUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "tts-1", input: text, voice }),
      });
      if (!upstreamRes.ok) {
        return res.status(502).json({ error: `Upstream TTS error (${upstreamRes.status})` });
      }
      const arr = Buffer.from(await upstreamRes.arrayBuffer());
      res.setHeader("Content-Type", upstreamRes.headers.get("content-type") || "audio/mpeg");
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).send(arr);
    } catch (err: any) {
      return res.status(502).json({ error: err?.message || "Upstream TTS failed" });
    }
  }

  try {
    const audio = await synthesizeWithEdgeWs(text, voice, rate, pitch);
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(audio);
  } catch (err: any) {
    console.error("Edge TTS API error:", err?.message || err);
    return res.status(502).json({ error: err?.message || "Edge TTS synthesis failed" });
  }
}
