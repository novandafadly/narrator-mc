import { config } from "@/utils/config";

export interface VideoAvatarHealth {
  ok: boolean;
  status?: string;
  engine?: string;
  avatar?: string;
  gpu?: string;
  latencyMs?: number;
  error?: string;
  checkedAt: number;
}

export interface VideoAvatarState {
  isPlaying: boolean;
  isFetching: boolean;
  lastHealth: VideoAvatarHealth | null;
  lastError: string | null;
}

export type VideoPlayerHandler = {
  play: (blob: Blob) => Promise<void>;
  stop: () => void;
};

type StateListener = (state: VideoAvatarState) => void;

/**
 * Normalizes a Video Avatar server base URL (trims whitespace and trailing slashes).
 * Returns empty string if empty or not http(s).
 */
export function normalizeVideoAvatarUrl(raw: string | undefined | null): string {
  if (!raw) return "";
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (!/^https?:\/\//i.test(trimmed)) {
    return "";
  }
  return trimmed;
}

export function buildHealthUrl(baseUrl: string): string {
  const normalized = normalizeVideoAvatarUrl(baseUrl);
  return normalized ? `${normalized}/health` : "";
}

export function buildSpeakUrl(baseUrl: string): string {
  const normalized = normalizeVideoAvatarUrl(baseUrl);
  return normalized ? `${normalized}/speak` : "";
}

/**
 * Controller for the photorealistic talking-head Video Avatar backend
 * (MuseTalk v1.5 + Edge TTS exposed via HTTPS, e.g. Cloudflare Tunnel).
 *
 * API Contract:
 * - GET  /health -> { status: "ok", avatar: "nara_hijab", gpu: "..." }
 * - POST /speak  -> JSON { text, voice, fps } -> video/mp4 (audio + synced lip-sync)
 */
export class VideoAvatarController {
  private activeControllers = new Set<AbortController>();
  private player: VideoPlayerHandler | null = null;
  private listeners = new Set<StateListener>();
  private state: VideoAvatarState = {
    isPlaying: false,
    isFetching: false,
    lastHealth: null,
    lastError: null,
  };

  public getState(): VideoAvatarState {
    return { ...this.state };
  }

  public subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit() {
    const snapshot = this.getState();
    this.listeners.forEach((fn) => fn(snapshot));
  }

  private patchState(patch: Partial<VideoAvatarState>) {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  public registerPlayer(handler: VideoPlayerHandler | null) {
    this.player = handler;
  }

  public getServerUrl(): string {
    return normalizeVideoAvatarUrl(config("video_avatar_url"));
  }

  public isEnabled(): boolean {
    return config("video_avatar_enabled") === "true";
  }

  public isActive(): boolean {
    return this.isEnabled() && this.getServerUrl() !== "";
  }

  public async checkHealth(
    customUrl?: string,
    timeoutMs: number = 8000,
  ): Promise<VideoAvatarHealth> {
    const baseUrl = normalizeVideoAvatarUrl(
      customUrl !== undefined ? customUrl : config("video_avatar_url"),
    );
    const checkedAt = Date.now();

    if (!baseUrl) {
      const result: VideoAvatarHealth = {
        ok: false,
        error: "URL server Video Avatar belum diisi atau tidak diawali http(s)://",
        checkedAt,
      };
      this.patchState({ lastHealth: result, lastError: result.error || null });
      return result;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const t0 = Date.now();

    try {
      const res = await fetch(buildHealthUrl(baseUrl), {
        method: "GET",
        signal: controller.signal,
      });
      const latencyMs = Date.now() - t0;

      if (!res.ok) {
        const result: VideoAvatarHealth = {
          ok: false,
          latencyMs,
          error: `HTTP ${res.status} dari /health`,
          checkedAt: Date.now(),
        };
        this.patchState({ lastHealth: result, lastError: result.error || null });
        return result;
      }

      let data: any = {};
      try {
        data = await res.json();
      } catch {
        data = {};
      }

      const ok = data?.status === "ok" || res.ok;
      const result: VideoAvatarHealth = {
        ok,
        status: data?.status ?? "ok",
        engine: data?.engine,
        avatar: data?.avatar,
        gpu: data?.gpu,
        latencyMs,
        error: ok ? undefined : `Status server tidak siap: ${String(data?.status)}`,
        checkedAt: Date.now(),
      };
      this.patchState({
        lastHealth: result,
        lastError: ok ? null : (result.error || null),
      });
      return result;
    } catch (err: any) {
      const isTimeout = err?.name === "AbortError";
      const result: VideoAvatarHealth = {
        ok: false,
        latencyMs: Date.now() - t0,
        error: isTimeout
          ? `Timeout (${Math.round(timeoutMs / 1000)} dtk) menghubungi server video`
          : (err?.message || String(err)),
        checkedAt: Date.now(),
      };
      this.patchState({ lastHealth: result, lastError: result.error || null });
      return result;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Sends text to POST /speak and returns a video/mp4 Blob.
   * Multiple calls can run in parallel; calling stop() aborts all active fetches.
   */
  public async fetchSpeakVideo(
    text: string,
    options?: {
      voice?: string;
      fps?: number;
      emotion?: string;
      url?: string;
      signal?: AbortSignal;
    },
  ): Promise<Blob | null> {
    const cleanText = text.trim();
    if (!cleanText) return null;

    const baseUrl = normalizeVideoAvatarUrl(
      options?.url !== undefined ? options.url : config("video_avatar_url"),
    );
    if (!baseUrl) {
      const errMsg = "URL server Video Avatar kosong";
      this.patchState({ lastError: errMsg });
      throw new Error(errMsg);
    }

    const controller = new AbortController();
    this.activeControllers.add(controller);
    this.patchState({ isFetching: true });

    const onExternalAbort = () => controller.abort();
    options?.signal?.addEventListener("abort", onExternalAbort, { once: true });

    try {
      const payload: Record<string, any> = {
        text: cleanText,
        voice: options?.voice || config("video_avatar_voice") || "id-ID-GadisNeural",
        fps: options?.fps ?? 25,
      };
      if (options?.emotion) {
        payload.emotion = options.emotion.toLowerCase();
      }

      const res = await fetch(buildSpeakUrl(baseUrl), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        const msg = `Server Video Avatar /speak gagal (HTTP ${res.status})${errText ? `: ${errText.slice(0, 140)}` : ""}`;
        this.patchState({ lastError: msg });
        throw new Error(msg);
      }

      const blob = await res.blob();
      if (!blob || blob.size === 0) {
        return null;
      }

      this.patchState({ lastError: null });
      return blob;
    } catch (err: any) {
      if (err?.name === "AbortError" || controller.signal.aborted) {
        return null;
      }
      const msg = err?.message || String(err);
      this.patchState({ lastError: msg });
      throw err;
    } finally {
      options?.signal?.removeEventListener("abort", onExternalAbort);
      this.activeControllers.delete(controller);
      this.patchState({ isFetching: this.activeControllers.size > 0 });
    }
  }

  /**
   * Plays a talking-head video Blob on the active VideoAvatarViewer layer.
   */
  public async playBlob(blob: Blob): Promise<void> {
    if (!this.player) {
      return;
    }
    this.patchState({ isPlaying: true });
    try {
      await this.player.play(blob);
    } finally {
      this.patchState({ isPlaying: false });
    }
  }

  /**
   * Aborts all in-flight /speak requests and stops current video playback immediately,
   * returning the viewer smoothly to idle.
   */
  public stop(): void {
    this.activeControllers.forEach((controller) => {
      try {
        controller.abort();
      } catch {
        // ignore abort errors
      }
    });
    this.activeControllers.clear();

    try {
      this.player?.stop();
    } catch {
      // ignore player stop errors
    }

    this.patchState({ isPlaying: false, isFetching: false });
  }
}
