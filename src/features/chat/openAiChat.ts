import { Message } from "./messages";
import { config } from '@/utils/config';
import { hedgedStart } from "./hedge";

function getApiKey(configKey: string) {
  const apiKey = config(configKey);
  if (!apiKey) {
    throw new Error(`Invalid ${configKey} API Key`);
  }
  return apiKey;
}

interface ChatTarget {
  url: string;
  path: string;
  apiKey: string;
  model: string;
  maxTokens: number;
  reasoningEffort: string;
}

type FirstRead = ReadableStreamReadResult<Uint8Array>;

// Buka koneksi dan tunggu potongan data pertama. Dianggap berhasil hanya jika
// server sudah benar-benar mulai menjawab (bukan sekadar header 200).
async function openStream(
  messages: Message[],
  t: ChatTarget,
  signal?: AbortSignal,
): Promise<{ reader: ReadableStreamDefaultReader<Uint8Array>; first: FirstRead }> {
  // Header minimal: header kustom memicu preflight CORS dan tidak perlu di sini.
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${t.apiKey}`,
  };

  const body: Record<string, unknown> = {
    model: t.model,
    messages,
    stream: true,
    max_tokens: t.maxTokens,
  };
  if (t.reasoningEffort) {
    body.reasoning_effort = t.reasoningEffort;
  }

  const res = await fetch(`${t.url}${t.path}`, {
    headers: headers,
    method: "POST",
    body: JSON.stringify(body),
    signal,
  });

  const reader = res.body?.getReader();
  if (res.status !== 200 || ! reader) {
    if (res.status !== 200) {
      console.warn(`chat ${t.model} -> HTTP ${res.status}`, (await res.text().catch(() => "")).slice(0, 200));
    }
    if (res.status === 401) {
      throw new Error('Invalid OpenAI authentication');
    }
    if (res.status === 402) {
      throw new Error('Payment required');
    }

    throw new Error(`OpenAI chat error (${res.status}, ${t.model})`);
  }

  const first = await reader.read();
  return { reader, first };
}

async function getResponseStream(
  messages: Message[],
  targets: ChatTarget[],
  hedgeMs: number = 1500,
) {
  const { value: opened, index } = await hedgedStart(
    targets.map((t) => (signal: AbortSignal) => openStream(messages, t, signal)),
    hedgeMs,
    // kandidat yang terlambat selesai: tutup supaya tidak menggantung
    (late) => { late.reader.cancel().catch(() => {}); },
  );
  if (index > 0) {
    console.warn(`chat: memakai cadangan #${index} (${targets[index].model})`);
  }

  const { reader, first } = opened;
  let pendingFirst: FirstRead | null = first;
  const read = async (): Promise<FirstRead> => {
    if (pendingFirst) {
      const f = pendingFirst;
      pendingFirst = null;
      return f;
    }
    return reader.read();
  };

  const stream = new ReadableStream({
    async start(controller: ReadableStreamDefaultController) {
      const decoder = new TextDecoder("utf-8");
      try {
        // sometimes the response is chunked, so we need to combine the chunks
        let combined = "";
        while (true) {
          const { done, value } = await read();
          if (done) break;
          const data = decoder.decode(value);
          const chunks = data
            .split("data:")
            .filter((val) => !!val && val.trim() !== "[DONE]");

          for (const chunk of chunks) {
            // skip comments
            if (chunk.length > 0 && chunk[0] === ":") {
              continue;
            }
            combined += chunk;

            try {
              const json = JSON.parse(combined);
              const messagePiece = json.choices[0].delta.content;
              combined = "";
              if (!!messagePiece) {
                controller.enqueue(messagePiece);
              }
            } catch (error) {
              console.error(error);
            }
          }
        }
      } catch (error) {
        console.error(error);
        controller.error(error);
      } finally {
        reader.releaseLock();
        controller.close();
      }
    },
    async cancel() {
      await reader?.cancel();
      reader.releaseLock();
    }
  });

  return stream;
}

export async function getOpenAiChatResponseStream(messages: Message[]) {
  const maxTokens = parseInt(config("openai_max_tokens"), 10) || 200;
  const targets: ChatTarget[] = [
    {
      url: config("openai_url"),
      path: config("openai_chat_path"),
      apiKey: getApiKey("openai_apikey"),
      model: config("openai_model"),
      maxTokens,
      reasoningEffort: config("openai_reasoning_effort"),
    },
  ];

  // Cadangan (opsional): dipakai jika utama gagal atau lambat.
  if (config("openai_fallback_url") && config("openai_fallback_model") && config("openai_fallback_apikey")) {
    targets.push({
      url: config("openai_fallback_url"),
      path: config("openai_fallback_path"),
      apiKey: config("openai_fallback_apikey"),
      model: config("openai_fallback_model"),
      maxTokens,
      reasoningEffort: config("openai_fallback_reasoning_effort"),
    });
  }

  return getResponseStream(messages, targets, parseInt(config("openai_hedge_ms"), 10) || 1500);
}

export async function getOpenAiVisionChatResponse(messages: Message[],) {
  const apiKey = getApiKey("vision_openai_apikey");
  const url = config("vision_openai_url");
  const model = config("vision_openai_model");

  const stream = await getResponseStream(messages, [
    { url, path: "/v1/chat/completions", apiKey, model, maxTokens: 200, reasoningEffort: "" },
  ]);
  const sreader = await stream.getReader();

  let combined = "";
  while (true) {
    const { done, value } = await sreader.read();
    if (done) break;
    combined += value;
  }

  return combined;
}
