# Prompt untuk sesi di sisi server (VM OCI)

Tempel isi di bawah garis ini ke sesi AI yang punya akses shell ke VM OCI
(mis. Claude Code lewat SSH). Sesi itu tidak melihat percakapan lain, jadi semua
konteks ada di sini.

---

Kamu bekerja di sisi server untuk men-deploy "Nara": co-host AI berbahasa Indonesia
berbasis Amica (MIT), untuk acara Workshop AI di depan jajaran direksi. Kodenya ada
di https://github.com/novandafadly/narrator-mc, branch `main`, folder `deploy/`.
Baca `deploy/README.md`, `deploy/Caddyfile`, `deploy/Dockerfile`, dan
`deploy/docker-compose.yml` sebelum mengubah apa pun. Jangan menebak: periksa dulu.

## Hasil akhir

Nara terbuka di `https://<SITE_ADDRESS>` dengan password, dan `deploy/verify.sh`
lulus semua, termasuk `--live`. API key hanya ada di `deploy/.env` di server ini.

## Batas kerja

Boleh:
- Memasang Docker, menambah aturan firewall (hanya menambah, dengan `iptables -I`),
  menjalankan `docker compose`, membaca log, dan menjalankan `deploy/verify.sh`.
- Mengubah `deploy/.env` hanya untuk isian non-rahasia: `SITE_ADDRESS`, `ACME_EMAIL`,
  `LLM_MODEL`, `FALLBACK_MODEL`, `MAX_TOKENS`, `HEDGE_MS`.

Tidak boleh:
- `git push`, atau mengubah kode aplikasi, `Dockerfile`, `Caddyfile`, atau compose.
  Jika ada yang salah di sana, laporkan galatnya dan usulkan perbaikan dalam bentuk
  diff teks. Pemilik repo yang akan menerapkannya lewat GitHub.
- Mencetak, menyalin, atau menyimpan rahasia. Jangan jalankan `cat deploy/.env`,
  `docker compose config`, `docker inspect`, atau perintah lain yang menampilkan isi
  variabel lingkungan. Pengguna mengisi key, hash password, dan token sendiri
  (`nano deploy/.env`). Untuk memeriksa isian yang masih kosong tanpa melihat nilainya:
  `awk -F= '/^[A-Z_]+=/ && ($2=="" || $2=="'"''"'") {print $1}' deploy/.env`
- Menghapus aturan firewall, `iptables -F`, mematikan firewall, `docker system prune`,
  atau `rm -rf` di luar `deploy/`. Sebelum mengubah firewall, tampilkan
  `sudo iptables -S INPUT` dan pastikan aturan SSH (port 22) tetap ada.
- Menjalankan tindakan yang tidak bisa dibatalkan tanpa meminta konfirmasi pengguna.

Pengaturan di konsol OCI (Security List atau NSG untuk TCP 80 dan 443, UDP 443)
tidak bisa kamu lakukan. Minta pengguna melakukannya dan memastikan.

## Langkah, urutkan dari yang paling berisiko

0. **Orientasi (hanya membaca).** Laporkan: `uname -m`, `/etc/os-release`,
   `docker --version`, `df -h /`, `free -h`, apa yang memakai port 80 dan 443
   (`ss -tlnp`), dan `sudo iptables -S INPUT`. Jika port 80 atau 443 sudah dipakai
   layanan lain, berhenti dan tanyakan pengguna.
1. **Pasang Docker** jika belum ada (lihat README langkah 3). Cek `docker compose version`.
2. **Ambil kode dan siapkan `.env`**: `git clone`, `cp deploy/.env.example deploy/.env`,
   `chmod 600 deploy/.env`. Minta pengguna mengisi rahasia, lalu periksa isian kosong
   dengan perintah `awk` di atas. Isian wajib: `SITE_ADDRESS`, `ACME_EMAIL`, `BASIC_HASH`,
   `PROXY_TOKEN`, `GEMINI_API_KEY`. `GROQ_API_KEY` dan `FALLBACK_MODEL` opsional (kosong berarti
   tanpa LLM cadangan). Jangan lanjut sebelum yang wajib terisi.
3. **Build image (risiko terbesar, belum pernah diuji).** `cd deploy && time docker
   compose build app`. Jika gagal: baca galat sebenarnya, diagnosis paling banyak dua
   kali, lalu laporkan galat persis dan diff perbaikan yang kamu usulkan. Jangan
   mengulang perintah yang sama berkali-kali, dan jangan melemahkan syarat apa pun
   agar build lolos.
4. **Jaringan.** Tambah aturan firewall (README langkah 2). Minta pengguna memastikan
   aturan di konsol OCI, lalu minta mereka menjalankan `curl -I http://<IP-publik>` dari
   luar VM untuk membuktikan port terbuka.
5. **Jalankan.** `docker compose up -d`, lalu `docker compose logs caddy`. Cari
   keberhasilan penerbitan sertifikat. Jika gagal, baca alasannya (biasanya port atau
   DNS) dan laporkan.
6. **Verifikasi.** Minta pengguna mengisi sandi di sesi shell-nya sendiri agar tidak
   muncul di percakapan: `read -rs BASIC_PASSWORD; export BASIC_PASSWORD`. Lalu
   jalankan `deploy/verify.sh https://<SITE_ADDRESS> --live`.
7. **Ukur.** Jalankan `--live` lima kali dan laporkan nilai `ttfb` dan `total` dari
   tiap putaran, plus mediannya.

## Kriteria selesai

- [ ] `docker compose build app` berhasil, dan waktu build dicatat.
- [ ] Sertifikat HTTPS valid (`verify.sh` lulus tanpa `-k`).
- [ ] `verify.sh --live` lulus semua (fail=0).
- [ ] Tidak ada rahasia yang tercetak di percakapan atau log yang kamu tampilkan.
- [ ] `deploy/.env` berizin 600 dan tidak ter-commit (`git status` bersih dari `.env`).

## Format laporan

Mulai dengan hasil: berhasil atau gagal, dan apa yang perlu diputuskan pengguna.
Lalu: tabel PASS/FAIL per kriteria, versi dan arsitektur VM, galat persis (kutip
barisnya), hasil ukur waktu, hal yang tidak sempat diverifikasi, dan usulan diff
bila ada. Jangan menyebut "berhasil" tanpa bukti dari sesi ini.
