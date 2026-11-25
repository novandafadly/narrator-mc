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
| 2 | LLM dan persona Nara | Belum |
| 3 | TTS id-ID-GadisNeural | Belum |
| 4 | STT bahasa Indonesia | Belum |
| 5 | Push-to-talk, stop suara, tombol audio siap putar | Belum |
| 6 | Mode tampilan layar kedua | Belum |
| 7 | Ukur jeda dan laporan akhir | Belum |

## Catatan temuan tahap 1

- Penghitung jeda bawaan: `window.chatvrm_latency_tracker` (dari selesai bicara
  sampai audio siap diputar), dicatat sebagai `performance_latency` di konsol.
- Halaman memuat Google Fonts dari internet. Jika acara tanpa internet, font
  perlu di-host lokal.
- Modul "external API" (X/Telegram) bawaan Amica memaksa variabel `X_*` ada.
  Diisi placeholder `unused` di `.env.example`.
