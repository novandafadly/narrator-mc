// Dijalankan otomatis sebelum `npm run dev` (hook npm "predev").
// Server dev Amica menulis konfigurasi (termasuk API key) ke folder ini saat runtime.
// Folder ini di-ignore git agar key tidak ter-commit. Skrip ini hanya memastikan file ada.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "features", "externalAPI", "dataHandlerStorage");
mkdirSync(dir, { recursive: true });

const files = { "config.json": {}, "chatLogs.json": [], "logs.json": [], "subconscious.json": [], "userInputMessages.json": [] };
for (const [name, empty] of Object.entries(files)) {
  const p = join(dir, name);
  if (!existsSync(p)) writeFileSync(p, JSON.stringify(empty, null, 2));
}
