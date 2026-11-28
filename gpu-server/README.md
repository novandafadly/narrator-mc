# Server GPU Nara: Ditto TalkingHead + Edge TTS (`id-ID-GadisNeural`)

Folder ini berisi server talking-head berbasis **[Ditto TalkingHead](https://github.com/antgroup/ditto-talkinghead)** (lisensi **Apache-2.0**) yang langsung kompatibel dengan kontrak API `narrator-mc`:

- `GET /health` → `{ "status": "ok", "engine": "ditto-pytorch|ditto-trt-*", "avatar": "nara_hijab", "gpu": "...", "source_cached": true, "has_idle": true }`
- `POST /speak` → body JSON `{ "text": "...", "voice": "id-ID-GadisNeural", "fps": 25, "emotion": "happy" }` → response `video/mp4` (audio + lip-sync + gerak kepala/ekspresi sinkron, CORS aktif)
- `GET /idle` → video idle loop 4 detik (`nara_idle.mp4`) hasil generate dari foto sumber yang sama (agar transisi *cross-fade* bebas loncatan pose)
- `GET /poster` → gambar poster (`nara_poster.jpg`) berdimensi identik dengan `/speak`

## Optimasi Latensi (`< 3 detik`) yang Sudah Dipasang

1. **Cache identitas wajah saat startup:** `AvatarRegistrar` hanya berjalan sekali pada foto sumber Nara, menghemat ~0,5–1,5 detik di setiap kalimat.
2. **Overlap Edge TTS & GPU:** Ketika `narrator-mc` mengirim kalimat 1, 2, 3 secara paralel ke `POST /speak`, sintesis suara `edge-tts` berjalan paralel sementara GPU dijamin aman dengan *lock*.
3. **Diffusion steps adaptif:** Default `--sampling-timesteps 15` (jauh lebih cepat dari default Ditto 50 dengan kualitas wajah tetap tajam) + muxing FFmpeg *stream-copy* (`-c:v copy -movflags +faststart`, ~30 ms).
4. **Kontrol emosi otomatis:** Tag `[happy]`, `[relaxed]`, `[surprised]`, `[shy]`, `[neutral]` dari `src/nara/persona.json` langsung dipetakan ke indeks emosi Ditto (`3`, `[3, 4]`, `6`, `[3, 4]`, `4`).
5. **Transisi idle ↔ bicara mulus:** Menggunakan `fade_in=4`, `fade_out=4`, `fade_type="s"` agar awal dan akhir setiap kalimat kembali lembut ke pose foto sumber.

---

## Cara Pakai 1: Google Colab (Paling Cepat untuk Uji Coba)

1. Buka [Nara_Ditto_Colab.ipynb](Nara_Ditto_Colab.ipynb) di Google Colab.
2. Aktifkan GPU (`Runtime` → `Change runtime type` → **T4** untuk uji coba gratis, atau **L4 / A100** untuk kecepatan penuh).
3. Jalankan Sel 1–5 berurutan:
   - Unggah 1 foto potret Nara hadap depan yang jelas di Sel 3.
   - Sel 4 otomatis menghasilkan & mengunduh `nara_idle.mp4` dan `nara_poster.jpg` → simpan ke folder `public/avatar/` di repo `narrator-mc`.
   - Sel 5 mencetak URL `https://xxxx.trycloudflare.com`.
4. Di web `narrator-mc`, tempel URL tersebut pada **Panel Operator** kanan atas → klik **Simpan & Cek** → klik **Tes Bicara**.

---

## Cara Pakai 2: GPU Cloud per Jam saat Hari-H (RunPod / Vast.ai — L4 / RTX 4090 / A100)

Untuk acara **17–18 Desember 2026 di Aston Bogor**, GPU Ampere/Ada (RTX 4090 / L4 / A100) dengan TensorRT direkomendasikan agar jeda respon konsisten `< 3 detik`.

```bash
git clone https://github.com/novandafadly/narrator-mc.git
cd narrator-mc/gpu-server

# Letakkan foto potret Nara, misalnya di /workspace/nara.jpg
SOURCE_IMAGE=/workspace/nara.jpg ./start_ditto.sh
```

### Opsional: Aktifkan TensorRT (Kecepatan Maksimal di Ampere/Ada GPU)

Jika memakai GPU RTX 3090 / 4090 / L4 / A100 (Compute Capability ≥ 8.0) dengan `tensorrt==8.6.1`:

```bash
pip install tensorrt==8.6.1 cuda-python polygraphy colored
python3 -c '
from huggingface_hub import snapshot_download
snapshot_download(
    repo_id="digital-avatar/ditto-talkinghead",
    local_dir="./ditto-talkinghead/checkpoints",
    allow_patterns=["ditto_cfg/*", "ditto_trt_Ampere_Plus/**"],
)
'
SOURCE_IMAGE=/workspace/nara.jpg DITTO_BACKEND=trt DITTO_SAMPLING_TIMESTEPS=15 ./start_ditto.sh
```

Jika memakai GPU non-Ampere (seperti T4) tetapi tetap ingin TensorRT, konversi ONNX sekali di awal:

```bash
python3 ./ditto-talkinghead/scripts/cvt_onnx_to_trt.py \
  --onnx_dir ./ditto-talkinghead/checkpoints/ditto_onnx \
  --trt_dir ./ditto-talkinghead/checkpoints/ditto_trt_custom
```

Server akan otomatis mendeteksi `ditto_trt_custom` saat `--backend auto`.
