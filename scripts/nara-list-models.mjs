// Daftar model Gemini yang tersedia untuk API key Anda (untuk memilih NEXT_PUBLIC_OPENAI_MODEL).
// Pakai:  node scripts/nara-list-models.mjs
// Key dibaca dari .env.local (NEXT_PUBLIC_OPENAI_APIKEY) dan dikirim lewat header, tidak dicetak.
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const file = join(dirname(fileURLToPath(import.meta.url)), "..", ".env.local");
let key = process.env.NEXT_PUBLIC_OPENAI_APIKEY;
if (!key && existsSync(file)) {
  const m = readFileSync(file, "utf8").match(/^NEXT_PUBLIC_OPENAI_APIKEY=(.*)$/m);
  if (m) key = m[1].trim().replace(/^["']|["']$/g, "");
}
if (!key) {
  console.error("Isi NEXT_PUBLIC_OPENAI_APIKEY di .env.local");
  process.exit(1);
}

const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", {
  headers: { "x-goog-api-key": key },
});
if (!res.ok) {
  console.error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  process.exit(1);
}
const { models = [] } = await res.json();
for (const m of models.filter((x) => (x.supportedGenerationMethods || []).includes("generateContent"))) {
  console.log(m.name.replace(/^models\//, ""), "-", m.displayName || "");
}
