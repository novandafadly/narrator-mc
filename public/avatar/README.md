# Aset Video Avatar Nara

Letakkan aset berikut di folder ini agar mode **Video Avatar Fotorealistis** tampil mulus tanpa kedip hitam antar kalimat:

- `nara_idle.mp4` — video loop idle Nara (diputar terus-menerus di layer bawah, muted, playsInline).
- `nara_poster.jpg` — gambar poster fallback sebelum video idle termuat.

Opsional untuk segmen siap putar offline (mode 3D VRM cadangan), letakkan audio di `public/audio/`:
- `public/audio/opening.mp3`
- `public/audio/ice_breaker.mp3`
- `public/audio/transition.mp3`
- `public/audio/closing.mp3`

Dan untuk model 3D VRM cadangan, letakkan di `public/vrm/`:
- `public/vrm/Nara_Hijab.vrm` (lalu set `NEXT_PUBLIC_VRM_HASH=/vrm/Nara_Hijab.vrm` atau `VRM_URL=/vrm/Nara_Hijab.vrm` di `deploy/.env`).
