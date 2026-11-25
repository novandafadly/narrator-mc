# Nara: uji kelayakan co-host AI berbasis Amica

Proyek ini adalah salinan Amica (MIT) yang disesuaikan untuk uji coba "Nara",
co-host AI berbahasa Indonesia. Bukan versi final.

## Asal kode

- Upstream: https://github.com/semperai/amica
- Commit dasar: `b337a9a44f969f6e87636c1b6fd706298df912cb` (13 Nov 2026)
- Lisensi: MIT, lihat `LICENSE` (Semper AI, pixiv Inc.). Wajib tetap disertakan.
- Dibuang dari salinan untuk menghemat ukuran: `src-tauri/`, `docs/`,
  `.github/`, `public/controllers/`, VRM contoh B/C/D (tersisa `AvatarSample_A`).
- Dibuang karena menunjuk ke layanan pengembang upstream: `.env.local` bawaan
  (berisi URL Supabase dan store milik upstream).

## Menjalankan (Windows)

Butuh Node.js 18.18 atau lebih baru. Di PowerShell:

```powershell
copy .env.example .env.local
npm ci
npm run dev
```

Buka http://localhost:3000. Pakai `npm run dev`, bukan build produksi:
Sentry upstream hanya aktif pada build produksi dan akan mengirim data ke akun
pengembang Amica.

## Keamanan

- Key API hanya di `.env.local`. File itu tidak ter-commit (lihat `.gitignore`).
- Variabel `NEXT_PUBLIC_*` tertanam di kode browser. Hanya untuk localhost.
- Tanpa persetujuan eksplisit, jangan memakai layanan berbayar.

## Status tahap

| Tahap | Isi | Status |
|---|---|---|
| 1 | Dasar: Amica jalan, avatar contoh, echo, tanpa API key | Selesai (diuji di container Linux; belum di Windows) |
| 2 | LLM (Gemini) dan persona Nara | Kode siap, diuji dengan server tiruan. Menunggu uji dengan key asli di laptop |
| 3 | TTS id-ID-GadisNeural | Belum |
| 4 | STT bahasa Indonesia | Belum |
| 5 | Push-to-talk, stop suara, tombol audio siap putar | Belum |
| 6 | Mode tampilan layar kedua | Belum |
| 7 | Ukur jeda dan laporan akhir | Belum |

## Tahap 2: uji LLM Gemini di laptop

1. Buka `.env.local`. Ganti `NEXT_PUBLIC_CHATBOT_BACKEND=echo` menjadi `chatgpt`.
2. Aktifkan blok "Tahap 2" (hapus `#`) dan isi `NEXT_PUBLIC_OPENAI_APIKEY`
   dengan key Anda. Jangan menempelkan key ke chat atau commit.
3. Lihat nama model yang tersedia, lalu isi `NEXT_PUBLIC_OPENAI_MODEL`:

```powershell
npm run nara:models
```

4. Uji kecepatan dan kepatuhan aturan (8 pertanyaan, hasil tersimpan di
   `measurements/llm-test.local.json`, tidak ter-commit):

```powershell
npm run nara:llm-test
```

Skrip menandai jawaban yang lebih dari 3 kalimat, memakai markdown atau emoji,
atau memuat angka di luar 17, 18, dan 2026. Pertanyaan jebakan (nama direktur,
jadwal, laba perusahaan) dan pertanyaan SARA harus dinilai manual: Nara harus
mengaku tidak tahu atau menolak dengan halus.

Persona Nara ada di `src/nara/persona.json`.
Jika model menolak `reasoning_effort`, kosongkan variabel itu. Jika jawaban
kosong atau terpotong, naikkan `NEXT_PUBLIC_OPENAI_MAX_TOKENS`
(model "berpikir" bisa memakai kuota token untuk berpikir).

## Catatan temuan tahap 2

- Server dev Amica menulis seluruh konfigurasi, termasuk API key, ke
  `src/features/externalAPI/dataHandlerStorage/*.json`. Di commit upstream dan
  tahap 1 file itu terlacak git. Sekarang di-ignore dan dibuat otomatis oleh
  `npm run dev` (hook `predev`), supaya key tidak ter-commit.
- Jalur Gemini: endpoint kompatibel OpenAI
  `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`.
  Amica dimodifikasi agar path, `max_tokens`, dan `reasoning_effort` bisa diatur,
  dan header kustom `HTTP-Referer`/`X-Title` dibuang.
- Belum diverifikasi dengan key asli: apakah browser boleh memanggil endpoint ini
  langsung (CORS), kuota tingkat gratis, dan syarat penggunaan data tingkat
  gratis. Hasil pencarian untuk nama model dan kuota saling bertentangan.

## Catatan temuan tahap 1

- Penghitung jeda bawaan: `window.chatvrm_latency_tracker` (dari selesai bicara
  sampai audio siap diputar), dicatat sebagai `performance_latency` di konsol.
- Halaman memuat Google Fonts dari internet. Jika acara tanpa internet, font
  perlu di-host lokal.
- Modul "external API" (X/Telegram) bawaan Amica memaksa variabel `X_*` ada.
  Diisi placeholder `unused` di `.env.example`.
