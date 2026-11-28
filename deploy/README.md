# Menjalankan Nara di server (OCI) dengan API key aman

Hasil: Nara bisa dibuka dari perangkat mana pun lewat `https://...`, dengan
password. API key (Gemini, Groq) hanya ada di file `deploy/.env` di server.
Browser tidak pernah memegang key asli.

## Cara kerja

```
Browser ──HTTPS──> Caddy ──> app (Nara, build produksi)        halaman (/ & /stage), dijaga password
                      ├────> Gemini  (/llm)   key asli disisipkan Caddy
                      ├────> Groq    (/llm2)  cadangan LLM
                      ├────> Groq    (/stt)   Whisper Bahasa Indonesia
                      └────> app     (/tts)   Edge TTS id-ID-GadisNeural (cadangan 3D VRM)
```

- Halaman (`/` untuk operator & `/stage` untuk proyektor) dijaga password (Basic Auth).
- `/llm`, `/llm2`, `/stt`, `/tts` hanya menerima permintaan yang membawa `PROXY_TOKEN`.
  Token itu tertanam di halaman, yang hanya bisa dibuka setelah login. Caddy
  menukar token dengan key asli sebelum meneruskan ke penyedia.
- `/api/*` (route dev Amica yang bisa membocorkan konfigurasi) diblokir.
- Server Video Avatar (MuseTalk v1.5 + Edge TTS di Colab/GPU cloud) dipanggil langsung lewat HTTPS dari browser dan URL-nya bisa diubah live di panel operator kanan atas tanpa rebuild.

## Yang dibutuhkan

- VM Ubuntu di OCI dengan akses SSH.
- Nama situs untuk HTTPS: domain Anda, atau hostname gratis
  `<ip-dengan-strip>.sslip.io` (mis. IP `129.146.1.2` menjadi
  `129-146-1-2.sslip.io`). Hostname gratis seperti ini belum saya uji untuk
  sertifikat Let's Encrypt, dan bisa terkena batas permintaan bersama.
- API key Gemini dan (opsional tapi disarankan) Groq.

## Langkah

### 1. Buka port di jaringan OCI

Di konsol OCI, pada VCN tempat VM berada, tambahkan aturan ingress untuk
TCP 80 dan TCP 443 (dan UDP 443) dari `0.0.0.0/0` (Security List atau Network
Security Group). Nama menu bisa berbeda; periksa di konsol.

### 2. Buka port di firewall VM (Ubuntu)

Image Ubuntu OCI biasanya memblokir port lewat iptables:

```bash
sudo iptables -I INPUT 1 -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 1 -p tcp --dport 443 -j ACCEPT
sudo iptables -I INPUT 1 -p udp --dport 443 -j ACCEPT
sudo apt-get install -y iptables-persistent
sudo netfilter-persistent save
```

### 3. Pasang Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
```

Keluar dari SSH dan masuk lagi supaya grup `docker` berlaku.

### 4. Ambil kode

```bash
git clone https://github.com/novandafadly/narrator-mc.git
cd narrator-mc/deploy
cp .env.example .env
```

### 5. Isi `deploy/.env`

Buat dua nilai rahasia:

```bash
openssl rand -hex 24
docker run --rm caddy:2 caddy hash-password --plaintext 'PASSWORD_ANDA'
```

Hasil pertama untuk `PROXY_TOKEN`. Hasil kedua (hash bcrypt) untuk `BASIC_HASH`,
tulis di dalam tanda kutip tunggal. Lalu isi `SITE_ADDRESS`, `ACME_EMAIL`,
`GEMINI_API_KEY`, `GROQ_API_KEY`, dan model. Buka dengan `nano .env`.

### 6. Jalankan

```bash
docker compose up -d --build
docker compose logs -f caddy
```

Build pertama butuh beberapa menit. Di log Caddy, cari baris yang menyatakan
sertifikat berhasil didapat. Lalu buka `https://<SITE_ADDRESS>`, masukkan user
dan password, dan coba ketik ke Nara.

## Operasi

| Keperluan | Perintah (di folder `deploy/`) |
|---|---|
| Perbarui kode | `git pull && docker compose up -d --build` |
| Ganti API key atau password | edit `.env`, lalu `docker compose up -d --force-recreate caddy` |
| Ganti model, fallback, atau `PROXY_TOKEN` | edit `.env`, lalu `docker compose up -d --build` (nilai ini tertanam saat build) |
| Lihat log | `docker compose logs -f` |
| Hentikan | `docker compose down` |

## Keamanan dan batasnya

- Siapa pun yang tahu password bisa memakai kuota LLM Anda lewat halaman.
  Pasang peringatan budget di akun penyedia, dan ganti password setelah acara.
- `PROXY_TOKEN` tertanam di halaman dan terlihat di riwayat build image
  (`docker history`). Key asli tidak. Anggap token itu rahasia yang bisa diganti.
- Log Caddy dibatasi level WARN agar isi pertanyaan dan suara audiens tidak
  tertulis.
- Gunakan HTTPS saja. Mikrofon di browser tidak jalan di `http://` selain `localhost`.

## Apa yang sudah dan belum diuji

Sudah diuji (Caddy asli dikompilasi dan dijalankan, upstream tiruan):
- 18 pemeriksaan proxy: tanpa password atau token ditolak 401, `/api/*` 404,
  key asli disisipkan, Origin/Referer/Cookie dibuang, path `/stt` ditulis ulang
  ke `/openai/v1/audio/transcriptions`, streaming tidak tertahan.
- Build produksi, lalu uji end to end di browser lewat Caddy: jawaban datang
  lewat proxy, perpindahan otomatis ke cadangan saat utama 503, dan bundel JS
  browser tidak memuat key asli.

Belum diuji (tidak ada daemon Docker di lingkungan pengembangan):
- Build `Dockerfile` dan `docker compose up`, termasuk di ARM.
- Penerbitan sertifikat Let's Encrypt dan jaringan OCI.
- Pemanggilan Gemini dan Groq asli lewat proxy.
- Rute TTS (tahap 3) dan konfigurasi Whisper di aplikasi (tahap 4) belum ada.
