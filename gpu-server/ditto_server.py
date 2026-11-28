#!/usr/bin/env python3
"""
Nara Video Avatar Server — Ditto TalkingHead + Edge TTS (id-ID-GadisNeural)
==========================================================================
Exposes the exact HTTP API expected by narrator-mc (VideoAvatarController):
  - GET  /health -> { status, engine, avatar, gpu, sampling_timesteps, source_cached, has_idle }
  - POST /speak  -> JSON { text, voice?, fps?, emotion? } -> video/mp4 (audio + synced lip-sync)
  - GET  /idle   -> auto-generated seamless idle loop (nara_idle.mp4)
  - GET  /poster -> matched poster image (nara_poster.jpg)

Optimizations for <3s response latency:
  1. Pre-registers and caches Nara's portrait identity (AvatarRegistrar) once at startup.
  2. Runs Edge TTS synthesis asynchronously before acquiring the GPU inference lock,
     so parallel sentence requests from narrator-mc overlap TTS with GPU rendering.
  3. Uses configurable diffusion steps (--sampling-timesteps, default 15) + fast
     stream-copy FFmpeg muxing (-c:v copy -movflags +faststart).
  4. Applies fade_in/fade_out with fade_type="s" so clips cross-fade smoothly with nara_idle.mp4.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import math
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("nara-ditto")

# Ditto condition_handler.py emotion index order:
# 0: Angry, 1: Disgust, 2: Fear, 3: Happy, 4: Neutral, 5: Sad, 6: Surprise, 7: Contempt
# Lists like [3, 4] produce a softmax blend (warm subtle smile).
EMOTION_TO_DITTO: Dict[str, Union[int, List[int]]] = {
    "angry": 0,
    "disgust": 1,
    "fear": 2,
    "happy": 3,
    "joy": 3,
    "neutral": 4,
    "relaxed": [3, 4],
    "shy": [3, 4],
    "sad": 5,
    "surprised": 6,
    "surprise": 6,
    "contempt": 7,
}

DEFAULT_VOICE = "id-ID-GadisNeural"


def map_emotion_to_ditto(emotion: Optional[str]) -> Union[int, List[int]]:
    """Maps a Nara persona emotion tag (e.g. 'happy', 'Surprised', 'shy') to Ditto's emo arg."""
    if not emotion:
        return [3, 4]  # warm default MC expression
    key = emotion.strip().lower().strip("[]")
    return EMOTION_TO_DITTO.get(key, 4)


def detect_gpu_info() -> Tuple[str, Optional[Tuple[int, int]]]:
    """Returns (gpu_name, compute_capability_tuple_or_None)."""
    try:
        import torch

        if torch.cuda.is_available():
            name = torch.cuda.get_device_name(0)
            cap = torch.cuda.get_device_capability(0)
            return name, cap
    except Exception:
        pass
    return "CPU", None


def resolve_ditto_backend(
    checkpoints_dir: Path,
    backend: str = "auto",
    compute_capability: Optional[Tuple[int, int]] = None,
    has_tensorrt: Optional[bool] = None,
) -> Tuple[str, Path, Path]:
    """
    Resolves (engine_name, data_root, cfg_pkl) from Ditto's checkpoints directory.

    Priority when backend == 'auto':
      1. ditto_trt_custom (TensorRT built for current GPU via scripts/cvt_onnx_to_trt.py)
      2. ditto_trt_Ampere_Plus (prebuilt TensorRT for Ampere+ GPUs, compute capability >= 8.0)
      3. ditto_pytorch (universal PyTorch weights, works on any CUDA GPU including T4)
    """
    cfg_dir = checkpoints_dir / "ditto_cfg"
    trt_custom = checkpoints_dir / "ditto_trt_custom"
    trt_ampere = checkpoints_dir / "ditto_trt_Ampere_Plus"
    pytorch_dir = checkpoints_dir / "ditto_pytorch"

    trt_cfg = cfg_dir / "v0.4_hubert_cfg_trt.pkl"
    pytorch_cfg = cfg_dir / "v0.4_hubert_cfg_pytorch.pkl"

    if has_tensorrt is None:
        try:
            import tensorrt  # noqa: F401

            has_tensorrt = True
        except Exception:
            has_tensorrt = False

    is_ampere_plus = compute_capability is not None and compute_capability[0] >= 8

    if backend == "pytorch":
        if not pytorch_dir.exists() or not pytorch_cfg.exists():
            raise FileNotFoundError(
                f"PyTorch checkpoints not found at {pytorch_dir} and {pytorch_cfg}"
            )
        return "ditto-pytorch", pytorch_dir, pytorch_cfg

    if backend == "trt":
        if trt_custom.exists() and trt_cfg.exists():
            return "ditto-trt-custom", trt_custom, trt_cfg
        if trt_ampere.exists() and trt_cfg.exists():
            return "ditto-trt-ampere", trt_ampere, trt_cfg
        raise FileNotFoundError(
            f"TensorRT checkpoints not found under {checkpoints_dir}"
        )

    # Auto selection
    if has_tensorrt and trt_cfg.exists():
        if trt_custom.exists() and any(trt_custom.glob("*.engine")):
            return "ditto-trt-custom", trt_custom, trt_cfg
        if is_ampere_plus and trt_ampere.exists() and any(trt_ampere.glob("*.engine")):
            return "ditto-trt-ampere", trt_ampere, trt_cfg

    if pytorch_dir.exists() and pytorch_cfg.exists():
        return "ditto-pytorch", pytorch_dir, pytorch_cfg

    # Fallback even if tensorrt check was inconclusive
    if trt_custom.exists() and trt_cfg.exists():
        return "ditto-trt-custom", trt_custom, trt_cfg
    if trt_ampere.exists() and trt_cfg.exists():
        return "ditto-trt-ampere", trt_ampere, trt_cfg

    raise FileNotFoundError(
        f"No valid Ditto checkpoints found in {checkpoints_dir}. "
        f"Expected ditto_pytorch/ + ditto_cfg/v0.4_hubert_cfg_pytorch.pkl "
        f"or ditto_trt_*/ + ditto_cfg/v0.4_hubert_cfg_trt.pkl."
    )


def wrap_avatar_registrar_with_cache(sdk: Any) -> Dict[tuple, Any]:
    """
    Wraps sdk.avatar_registrar so repeated calls for the same source image + crop settings
    return the cached source_info immediately (cutting ~0.5-1.5s per /speak call).
    """
    original_registrar = sdk.avatar_registrar
    cache: Dict[tuple, Any] = {}

    def cached_registrar(source_path: str, **kwargs: Any) -> Any:
        key = (
            os.path.abspath(source_path),
            kwargs.get("max_dim"),
            kwargs.get("n_frames"),
            kwargs.get("crop_scale"),
            kwargs.get("crop_vx_ratio"),
            kwargs.get("crop_vy_ratio"),
            kwargs.get("crop_flag_do_rot"),
        )
        if key not in cache:
            t0 = time.perf_counter()
            cache[key] = original_registrar(source_path, **kwargs)
            elapsed_ms = int((time.perf_counter() - t0) * 1000)
            log.info("Cached avatar identity for %s in %dms", Path(source_path).name, elapsed_ms)

        # Return a shallow copy of top-level dict + lists so Ditto's in-place smoothing/reads stay safe
        base = cache[key]
        return {
            k: (list(v) if isinstance(v, list) else v)
            for k, v in base.items()
        }

    sdk.avatar_registrar = cached_registrar
    return cache


def find_ffmpeg() -> str:
    """Returns ffmpeg binary path (system PATH or imageio-ffmpeg fallback)."""
    found = shutil.which("ffmpeg")
    if found:
        return found
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception as exc:
        raise RuntimeError("ffmpeg not found in PATH and imageio-ffmpeg unavailable") from exc


async def synthesize_edge_tts_wav(
    text: str,
    voice: str,
    work_dir: Path,
    ffmpeg_bin: str,
) -> Path:
    """Synthesizes Indonesian speech via Edge TTS and converts it to 16kHz mono WAV."""
    import edge_tts

    mp3_path = work_dir / "tts.mp3"
    wav_path = work_dir / "tts_16k.wav"

    communicate = edge_tts.Communicate(text=text, voice=voice)
    await communicate.save(str(mp3_path))

    proc = await asyncio.create_subprocess_exec(
        ffmpeg_bin,
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(mp3_path),
        "-ar",
        "16000",
        "-ac",
        "1",
        "-f",
        "wav",
        str(wav_path),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()
    if proc.returncode != 0 or not wav_path.exists():
        raise RuntimeError(f"ffmpeg audio conversion failed: {stderr.decode(errors='ignore')}")
    return wav_path


def mux_video_and_audio(
    tmp_video_path: str,
    audio_path: str,
    output_mp4_path: str,
    ffmpeg_bin: str,
) -> None:
    """Fast stream-copy mux of Ditto's H.264 video + TTS audio with +faststart for instant browser playback."""
    cmd = [
        ffmpeg_bin,
        "-loglevel",
        "error",
        "-y",
        "-i",
        tmp_video_path,
        "-i",
        audio_path,
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "96k",
        "-movflags",
        "+faststart",
        "-shortest",
        output_mp4_path,
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"ffmpeg mux failed: {res.stderr.strip()}")


class DittoEngine:
    """Thread-safe wrapper around antgroup/ditto-talkinghead StreamSDK."""

    def __init__(
        self,
        ditto_dir: Path,
        checkpoints_dir: Path,
        source_image: Path,
        avatar_name: str = "nara_hijab",
        backend: str = "auto",
        sampling_timesteps: int = 15,
        max_size: int = 1024,
        fade_frames: int = 4,
        assets_dir: Optional[Path] = None,
    ) -> None:
        self.ditto_dir = ditto_dir.resolve()
        self.checkpoints_dir = checkpoints_dir.resolve()
        self.source_image = source_image.resolve()
        self.avatar_name = avatar_name
        self.sampling_timesteps = sampling_timesteps
        self.max_size = max_size
        self.fade_frames = fade_frames
        self.assets_dir = (assets_dir or (self.ditto_dir / "nara_assets")).resolve()
        self.assets_dir.mkdir(parents=True, exist_ok=True)
        self.idle_video_path = self.assets_dir / "nara_idle.mp4"
        self.poster_image_path = self.assets_dir / "nara_poster.jpg"

        if not self.source_image.exists():
            raise FileNotFoundError(f"Source avatar image not found: {self.source_image}")

        self.ffmpeg_bin = find_ffmpeg()
        self.gpu_name, compute_cap = detect_gpu_info()
        self.engine_name, self.data_root, self.cfg_pkl = resolve_ditto_backend(
            self.checkpoints_dir,
            backend=backend,
            compute_capability=compute_cap,
        )

        # Import Ditto StreamSDK from cloned repository
        if str(self.ditto_dir) not in sys.path:
            sys.path.insert(0, str(self.ditto_dir))

        from stream_pipeline_offline import StreamSDK

        log.info(
            "Loading Ditto TalkingHead (%s) on %s | data_root=%s | cfg=%s",
            self.engine_name,
            self.gpu_name,
            self.data_root,
            self.cfg_pkl.name,
        )
        t0 = time.perf_counter()
        self.sdk = StreamSDK(str(self.cfg_pkl), str(self.data_root))
        self.source_cache = wrap_avatar_registrar_with_cache(self.sdk)
        self._gpu_lock = threading.Lock()
        log.info("Ditto SDK loaded in %.2fs", time.perf_counter() - t0)

    def render_from_audio_array(
        self,
        audio_16k: Any,
        output_mp4_path: Path,
        audio_wav_path: Optional[Path] = None,
        emotion: Optional[str] = None,
        fade_in: Optional[int] = None,
        fade_out: Optional[int] = None,
        sampling_timesteps: Optional[int] = None,
    ) -> Tuple[int, int]:
        """
        Runs Ditto inference synchronously under the GPU lock.
        Returns (ditto_ms, mux_ms).
        """
        import numpy as np

        audio_16k = np.asarray(audio_16k, dtype=np.float32)
        num_f = max(8, math.ceil(len(audio_16k) / 16000.0 * 25.0))
        emo = map_emotion_to_ditto(emotion)
        steps = sampling_timesteps or self.sampling_timesteps
        f_in = self.fade_frames if fade_in is None else fade_in
        f_out = self.fade_frames if fade_out is None else fade_out

        # Clamp fade length so short utterances never overlap fade_in + fade_out
        max_fade = max(0, (num_f // 4) - 1)
        f_in = min(f_in, max_fade) if f_in > 0 else -1
        f_out = min(f_out, max_fade) if f_out > 0 else -1

        setup_kwargs: Dict[str, Any] = {
            "max_size": self.max_size,
            "emo": emo,
            "sampling_timesteps": steps,
            "fade_type": "s" if (f_in > 0 or f_out > 0) else "",
        }

        with self._gpu_lock:
            t0 = time.perf_counter()
            self.sdk.setup(str(self.source_image), str(output_mp4_path), **setup_kwargs)
            self.sdk.setup_Nd(N_d=num_f, fade_in=f_in, fade_out=f_out)

            if self.sdk.online_mode:
                chunksize = (3, 5, 2)
                padded = np.concatenate(
                    [np.zeros((chunksize[0] * 640,), dtype=np.float32), audio_16k],
                    axis=0,
                )
                split_len = int(sum(chunksize) * 0.04 * 16000) + 80
                for i in range(0, len(padded), chunksize[1] * 640):
                    chunk = padded[i : i + split_len]
                    if len(chunk) < split_len:
                        chunk = np.pad(chunk, (0, split_len - len(chunk)), mode="constant")
                    self.sdk.run_chunk(chunk, chunksize)
            else:
                aud_feat = self.sdk.wav2feat.wav2feat(audio_16k)
                self.sdk.audio2motion_queue.put(aud_feat)

            self.sdk.close()
            tmp_video_path = self.sdk.tmp_output_path
            ditto_ms = int((time.perf_counter() - t0) * 1000)

        t_mux = time.perf_counter()
        try:
            if audio_wav_path is not None:
                mux_video_and_audio(
                    tmp_video_path,
                    str(audio_wav_path),
                    str(output_mp4_path),
                    self.ffmpeg_bin,
                )
            else:
                # Silent idle video: copy stream with +faststart
                cmd = [
                    self.ffmpeg_bin,
                    "-loglevel",
                    "error",
                    "-y",
                    "-i",
                    tmp_video_path,
                    "-c:v",
                    "copy",
                    "-an",
                    "-movflags",
                    "+faststart",
                    str(output_mp4_path),
                ]
                res = subprocess.run(cmd, capture_output=True, text=True)
                if res.returncode != 0:
                    raise RuntimeError(f"ffmpeg idle finalize failed: {res.stderr.strip()}")
        finally:
            if os.path.exists(tmp_video_path):
                try:
                    os.remove(tmp_video_path)
                except OSError:
                    pass

        mux_ms = int((time.perf_counter() - t_mux) * 1000)
        return ditto_ms, mux_ms

    def render_from_wav_file(
        self,
        wav_path: Path,
        output_mp4_path: Path,
        emotion: Optional[str] = None,
    ) -> Tuple[int, int]:
        import librosa

        audio_16k, _ = librosa.core.load(str(wav_path), sr=16000)
        return self.render_from_audio_array(
            audio_16k=audio_16k,
            output_mp4_path=output_mp4_path,
            audio_wav_path=wav_path,
            emotion=emotion,
        )

    def generate_idle_and_poster(self, duration_sec: float = 4.0) -> Tuple[Path, Path]:
        """
        Generates a seamless looping silent idle video (nara_idle.mp4) and matched poster
        (nara_poster.jpg) from Nara's source portrait so cross-fade in narrator-mc is pixel-aligned.
        """
        import numpy as np

        log.info("Generating %.1fs seamless idle loop + poster for %s...", duration_sec, self.avatar_name)
        silent_audio = np.zeros(int(duration_sec * 16000), dtype=np.float32)
        ditto_ms, _ = self.render_from_audio_array(
            audio_16k=silent_audio,
            output_mp4_path=self.idle_video_path,
            audio_wav_path=None,
            emotion="relaxed",
            fade_in=8,
            fade_out=8,
        )
        # Extract first frame as exact-dimension JPEG poster
        cmd = [
            self.ffmpeg_bin,
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(self.idle_video_path),
            "-frames:v",
            "1",
            "-q:v",
            "2",
            str(self.poster_image_path),
        ]
        subprocess.run(cmd, check=True)
        log.info(
            "Idle assets ready in %dms -> %s & %s",
            ditto_ms,
            self.idle_video_path,
            self.poster_image_path,
        )
        return self.idle_video_path, self.poster_image_path

    def warmup(self) -> None:
        """Runs a tiny 0.5s inference pass so CUDA/TRT kernels are warm before the first live question."""
        import numpy as np

        log.info("Running warmup pass...")
        with tempfile.TemporaryDirectory(prefix="nara_warmup_") as td:
            out = Path(td) / "warmup.mp4"
            dummy = np.zeros(8000, dtype=np.float32)
            ditto_ms, _ = self.render_from_audio_array(
                audio_16k=dummy,
                output_mp4_path=out,
                audio_wav_path=None,
                emotion="neutral",
                fade_in=-1,
                fade_out=-1,
            )
            log.info("Warmup complete in %dms", ditto_ms)


def create_app(engine: Any) -> Any:
    """Creates the FastAPI app exposing /health, /speak, /idle, and /poster."""
    from fastapi import FastAPI, HTTPException
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import FileResponse, Response
    from pydantic import BaseModel, Field

    class SpeakRequest(BaseModel):
        text: str = Field(..., min_length=1, max_length=2000)
        voice: str = Field(default=DEFAULT_VOICE)
        fps: int = Field(default=25, ge=10, le=60)
        emotion: Optional[str] = Field(default=None)

    app = FastAPI(title="Nara Ditto TalkingHead Server", version="1.0.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-TTS-Ms", "X-Ditto-Ms", "X-Mux-Ms", "X-Total-Ms", "X-Engine"],
    )

    @app.get("/health")
    async def health() -> Dict[str, Any]:
        return {
            "status": "ok",
            "engine": engine.engine_name,
            "avatar": engine.avatar_name,
            "gpu": engine.gpu_name,
            "sampling_timesteps": engine.sampling_timesteps,
            "source_cached": len(engine.source_cache) > 0,
            "has_idle": engine.idle_video_path.exists(),
        }

    @app.get("/idle")
    async def get_idle() -> FileResponse:
        if not engine.idle_video_path.exists():
            raise HTTPException(status_code=404, detail="nara_idle.mp4 not generated yet")
        return FileResponse(
            path=str(engine.idle_video_path),
            media_type="video/mp4",
            filename="nara_idle.mp4",
        )

    @app.get("/poster")
    async def get_poster() -> FileResponse:
        if not engine.poster_image_path.exists():
            raise HTTPException(status_code=404, detail="nara_poster.jpg not generated yet")
        return FileResponse(
            path=str(engine.poster_image_path),
            media_type="image/jpeg",
            filename="nara_poster.jpg",
        )

    @app.post("/speak")
    async def speak(req: SpeakRequest) -> Response:
        clean_text = req.text.strip()
        if not clean_text:
            raise HTTPException(status_code=400, detail="Text must not be empty")

        voice = (req.voice or DEFAULT_VOICE).strip()
        t_start = time.perf_counter()

        with tempfile.TemporaryDirectory(prefix="nara_speak_") as td:
            work_dir = Path(td)
            t_tts = time.perf_counter()
            try:
                wav_path = await synthesize_edge_tts_wav(
                    text=clean_text,
                    voice=voice,
                    work_dir=work_dir,
                    ffmpeg_bin=engine.ffmpeg_bin,
                )
            except Exception as exc:
                log.exception("Edge TTS synthesis failed")
                raise HTTPException(status_code=502, detail=f"Edge TTS failed: {exc}") from exc
            tts_ms = int((time.perf_counter() - t_tts) * 1000)

            output_mp4 = work_dir / "speak.mp4"
            try:
                ditto_ms, mux_ms = await asyncio.to_thread(
                    engine.render_from_wav_file,
                    wav_path,
                    output_mp4,
                    req.emotion,
                )
            except Exception as exc:
                log.exception("Ditto rendering failed")
                raise HTTPException(status_code=500, detail=f"Ditto render failed: {exc}") from exc

            mp4_bytes = output_mp4.read_bytes()

        total_ms = int((time.perf_counter() - t_start) * 1000)
        log.info(
            "/speak done | total=%dms (tts=%dms, ditto=%dms, mux=%dms) | emo=%s | len=%d chars | %.1f KB",
            total_ms,
            tts_ms,
            ditto_ms,
            mux_ms,
            req.emotion or "default",
            len(clean_text),
            len(mp4_bytes) / 1024.0,
        )

        return Response(
            content=mp4_bytes,
            media_type="video/mp4",
            headers={
                "Cache-Control": "no-store",
                "X-Engine": engine.engine_name,
                "X-TTS-Ms": str(tts_ms),
                "X-Ditto-Ms": str(ditto_ms),
                "X-Mux-Ms": str(mux_ms),
                "X-Total-Ms": str(total_ms),
            },
        )

    return app


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Nara Ditto TalkingHead + Edge TTS Server")
    parser.add_argument(
        "--ditto-dir",
        type=Path,
        default=Path(os.environ.get("DITTO_DIR", "./ditto-talkinghead")),
        help="Path to cloned antgroup/ditto-talkinghead repository",
    )
    parser.add_argument(
        "--checkpoints-dir",
        type=Path,
        default=None,
        help="Path to Ditto checkpoints dir (default: <ditto-dir>/checkpoints)",
    )
    parser.add_argument(
        "--source-image",
        type=Path,
        required=True,
        help="Path to Nara's portrait image (e.g. nara.jpg / nara.png)",
    )
    parser.add_argument(
        "--avatar-name",
        type=str,
        default=os.environ.get("NARA_AVATAR_NAME", "nara_hijab"),
        help="Avatar identifier reported in /health",
    )
    parser.add_argument(
        "--backend",
        choices=["auto", "trt", "pytorch"],
        default=os.environ.get("DITTO_BACKEND", "auto"),
        help="Inference backend: auto (prefers TensorRT if available), trt, or pytorch",
    )
    parser.add_argument(
        "--sampling-timesteps",
        type=int,
        default=int(os.environ.get("DITTO_SAMPLING_TIMESTEPS", "15")),
        help="Diffusion sampling steps (15-20 recommended for <3s latency; default 15)",
    )
    parser.add_argument(
        "--max-size",
        type=int,
        default=int(os.environ.get("DITTO_MAX_SIZE", "1024")),
        help="Max source image dimension in pixels (768-1024 recommended for fast rendering)",
    )
    parser.add_argument(
        "--fade-frames",
        type=int,
        default=4,
        help="Smooth fade-in/fade-out frame count back to source pose (default 4)",
    )
    parser.add_argument(
        "--assets-dir",
        type=Path,
        default=None,
        help="Output folder for generated nara_idle.mp4 and nara_poster.jpg",
    )
    parser.add_argument(
        "--generate-idle",
        action="store_true",
        help="Generate nara_idle.mp4 & nara_poster.jpg at startup before serving",
    )
    parser.add_argument(
        "--generate-idle-only",
        action="store_true",
        help="Generate nara_idle.mp4 & nara_poster.jpg and exit without starting HTTP server",
    )
    parser.add_argument("--skip-warmup", action="store_true", help="Skip CUDA warmup pass")
    parser.add_argument("--host", type=str, default="0.0.0.0")
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8000")))
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    checkpoints_dir = args.checkpoints_dir or (args.ditto_dir / "checkpoints")

    engine = DittoEngine(
        ditto_dir=args.ditto_dir,
        checkpoints_dir=checkpoints_dir,
        source_image=args.source_image,
        avatar_name=args.avatar_name,
        backend=args.backend,
        sampling_timesteps=args.sampling_timesteps,
        max_size=args.max_size,
        fade_frames=args.fade_frames,
        assets_dir=args.assets_dir,
    )

    if args.generate_idle_only:
        engine.generate_idle_and_poster()
        return

    if args.generate_idle or not engine.idle_video_path.exists():
        engine.generate_idle_and_poster()
    elif not args.skip_warmup:
        engine.warmup()

    import uvicorn

    app = create_app(engine)
    log.info("Starting Nara Ditto server on http://%s:%d", args.host, args.port)
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
