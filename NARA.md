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
| 1 | Dasar: Amica jalan, avatar contoh, echo, tanpa API key | Selesai |
| 2 | LLM (Gemini + fallback Groq hedged) dan persona Nara | Selesai |
| 3 | Video Avatar (MuseTalk v1.5 + Edge TTS) + TTS cadangan 3D VRM `id-ID-GadisNeural` (`/tts`) | Kode siap & lulus unit test + build produksi |
| 4 | STT bahasa Indonesia (Web Speech API `id-ID` & Groq Whisper `/stt`) | Kode siap & lulus unit test + build produksi |
| 5 | Push-to-talk (Spasi), tombol Stop (Esc), segmen siap putar (Opening/Ice-Breaker/Transisi/Closing) | Kode siap & lulus unit test + build produksi |
| 6 | Mode tampilan layar kedua (`/stage` via `BroadcastChannel`) | Kode siap & lulus unit test + build produksi |
| 7 | Ukur jeda nyata di server OCI & laporan akhir | Menunggu uji end-to-end di OCI + GPU cloud |

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

## Hasil uji LLM (laptop Windows, tingkat gratis Gemini, 26 Nov 2026)

| Model | Error | Kata pertama (median) | Catatan |
|---|---|---|---|
| `gemini-2.5-flash` | 8 dari 8 | - | HTTP 404: tidak tersedia untuk akun baru |
| `gemini-3.8-flash` | 4 dari 6 yang terlihat (output terpotong) | 6,5 dan 58 detik (2 yang berhasil) | HTTP 503 "high demand" |
| `gemini-3.5-flash-lite` | 8 dari 8 | - | Gagal semua |
| `gemini-3.5-flash` | 5 dari 8 | 1,6 detik | Tidak andal |
| `gemini-3.7-flash` | 5 dari 8 | 57,7 detik | Tidak andal |
| `gemini-3.1-flash-lite` (3 putaran) | 6 dari 24 (25%) | 1,34 detik | 5 dari 18 jawaban berhasil lebih lambat dari 3 detik (68, 32, 11, 7, 3,9 detik) |

Kesimpulan: kualitas persona lulus (menolak politik/agama dengan halus, tidak
mengarang nama, jadwal, atau angka). Keandalan dan kecepatan tingkat gratis
Gemini belum memadai untuk target 3 detik: hanya sekitar 13 dari 24 permintaan
(54%) berhasil dalam 3 detik, baru dari sisi LLM. Mitigasi: LLM cadangan dengan
permintaan "hedged" (di bawah), dan audio segmen siap putar.

## LLM cadangan (hedged)

Jika `NEXT_PUBLIC_OPENAI_FALLBACK_*` diisi, permintaan chat dikirim ke LLM utama;
jika gagal (mis. 503) atau belum menjawab setelah `NEXT_PUBLIC_OPENAI_HEDGE_MS`
(bawaan 1500 ms), permintaan kedua dikirim ke cadangan. Yang pertama mulai
menjawab menang, yang lain dibatalkan. Logika ada di
`src/features/chat/hedge.ts` (diuji unit) dan `src/features/chat/openAiChat.ts`.
Contoh cadangan: Groq (format OpenAI), lihat `.env.example`.

## Skrip bantu Windows

- `start-nara.cmd`: klik dua kali untuk menjalankan Nara (memakai Node portabel
  di `Documents\node-v22.23.5-win-x64` bila ada).
- `update-nara.cmd`: mengunduh versi terbaru dari GitHub tanpa menyentuh
  `.env.local` dan `node_modules`; menjalankan `npm ci` hanya jika
  `package-lock.json` berubah. File ini tidak memperbarui dirinya sendiri.
- Keduanya belum diuji di Windows. Cadangan manual: unduh ZIP `main` lagi dan salin
  filenya ke folder proyek, kecuali `.env.local` dan `node_modules`.

## Dua jalur kerja

| | Jalur GitHub (kode) | Jalur Server (OCI) |
|---|---|---|
| Pemilik | Sesi pengembang ini (lingkungan cloud, tanpa Docker daemon) | Sesi dengan shell di VM OCI |
| Mengerjakan | Kode aplikasi, `Dockerfile`, `Caddyfile`, tes, tahap 3 sampai 7, PR dan merge | Deploy, Docker, firewall, sertifikat, `verify.sh`, ukur waktu nyata |
| Tidak boleh | Mengklaim sesuatu jalan di OCI tanpa laporan dari server | `git push`, mengubah kode, atau melihat rahasia |
| Prompt | (sesi ini) | `deploy/SERVER-PROMPT.md` |

Serah terima: dari server ke GitHub berupa laporan teks (galat persis dan usulan diff);
dari GitHub ke server berupa `git pull && docker compose up -d --build`.
`deploy/verify.sh` adalah pemeriksaan bersama yang sama-sama bisa dijalankan.

## Menjalankan di server (OCI), key hanya di server

Lihat `deploy/README.md`. Caddy di depan aplikasi memberi HTTPS dan password,
lalu meneruskan `/llm`, `/llm2`, dan `/stt` ke Gemini dan Groq sambil menyisipkan
API key dari `deploy/.env`. Browser tidak pernah memegang key asli. Diuji dengan
Caddy asli dan upstream tiruan; `Dockerfile` dan Let's Encrypt belum diuji.

Perubahan yang menyertainya:
- Telemetri Sentry milik pengembang Amica dimatikan. Di build produksi aslinya
  Sentry aktif dan akan mengirim error ke akun mereka.
- Halaman `share` dan `import` (bergantung pada layanan Supabase dan store
  upstream) dihapus. Build produksi gagal tanpa kredensial Supabase upstream.
- `.dockerignore` kini mengecualikan `.env*` agar rahasia tidak masuk image.

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
