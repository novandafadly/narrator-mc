// Daftar model yang tersedia untuk API key Anda (untuk memilih nama model di .env.local).
//   node scripts/nara-list-models.mjs            -> Gemini (NEXT_PUBLIC_OPENAI_APIKEY)
//   node scripts/nara-list-models.mjs fallback   -> LLM cadangan, mis. Groq (NEXT_PUBLIC_OPENAI_FALLBACK_*)
// Key dibaca dari .env.local dan dikirim lewat header; tidak pernah dicetak.
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const file = join(dirname(fileURLToPath(import.meta.url)), "..", ".env.local");
const env = { ...process.env };
if (existsSync(file)) {
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = raw.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const fallback = process.argv[2] === "fallback";
let res;
if (fallback) {
  const base = env.NEXT_PUBLIC_OPENAI_FALLBACK_URL;
  const path = (env.NEXT_PUBLIC_OPENAI_FALLBACK_PATH || "/v1/chat/completions").replace(/\/chat\/completions$/, "/models");
  const key = env.NEXT_PUBLIC_OPENAI_FALLBACK_APIKEY;
  if (!base || !key) {
    console.error("Isi NEXT_PUBLIC_OPENAI_FALLBACK_URL dan NEXT_PUBLIC_OPENAI_FALLBACK_APIKEY di .env.local");
    process.exit(1);
  }
  res = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${key}` } });
} else {
  const key = env.NEXT_PUBLIC_OPENAI_APIKEY;
  if (!key) {
    console.error("Isi NEXT_PUBLIC_OPENAI_APIKEY di .env.local");
    process.exit(1);
  }
  res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", {
    headers: { "x-goog-api-key": key },
  });
}
if (!res.ok) {
  console.error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  process.exit(1);
}
const data = await res.json();
if (fallback) {
  for (const m of data.data || []) console.log(m.id);
} else {
  for (const m of (data.models || []).filter((x) => (x.supportedGenerationMethods || []).includes("generateContent"))) {
    console.log(m.name.replace(/^models\//, ""), "-", m.displayName || "");
  }
}
