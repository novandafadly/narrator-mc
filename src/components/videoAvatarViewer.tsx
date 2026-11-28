import { useCallback, useContext, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import {
  VideoAvatarController,
  VideoAvatarState,
  buildIdleUrl,
  buildPosterUrl,
  normalizeVideoAvatarUrl,
} from "@/features/videoAvatar/videoAvatarController";
import { VideoAvatarContext } from "@/features/videoAvatar/videoAvatarContext";
import { stageSync } from "@/features/stageSync/stageSync";
import { config, updateConfig } from "@/utils/config";

const TEST_SPEAK_TEXT =
  "Halo Bapak dan Ibu, saya Nara. Tes suara dan video berjalan lancar!";

export interface VideoAvatarViewerProps {
  controller?: VideoAvatarController;
  idleUrl?: string;
  posterUrl?: string;
  mutedPlayback?: boolean;
  showOperatorPanel?: boolean;
  stageConnected?: boolean;
  stageShowSubtitles?: boolean;
  stageAudioOnProjector?: boolean;
  onToggleStageSubtitles?: () => void;
  onToggleStageAudio?: () => void;
  onOpenStageWindow?: () => void;
  onSwitchToVrm?: () => void;
  onServerUrlChanged?: (url: string, remoteAssets?: { idleUrl?: string; posterUrl?: string }) => void;
}

export default function VideoAvatarViewer({
  controller,
  idleUrl,
  posterUrl,
  mutedPlayback = false,
  showOperatorPanel = true,
  stageConnected = false,
  stageShowSubtitles = true,
  stageAudioOnProjector = false,
  onToggleStageSubtitles,
  onToggleStageAudio,
  onOpenStageWindow,
  onSwitchToVrm,
  onServerUrlChanged,
}: VideoAvatarViewerProps) {
  const ctx = useContext(VideoAvatarContext);
  const avatarCtrl = controller ?? ctx.videoAvatar;

  const idleVideoRef = useRef<HTMLVideoElement | null>(null);
  const speakVideoRef = useRef<HTMLVideoElement | null>(null);
  const activeObjectUrlRef = useRef<string | null>(null);
  const revokeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resolvePlaybackRef = useRef<(() => void) | null>(null);
  const playbackGenRef = useRef<number>(0);

  const [speakVisible, setSpeakVisible] = useState(false);
  const [idleVideoFailed, setIdleVideoFailed] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);

  // Operator panel state
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [urlInput, setUrlInput] = useState(() => config("video_avatar_url") || "");
  const [checkingHealth, setCheckingHealth] = useState(false);
  const [testingSpeak, setTestingSpeak] = useState(false);
  const [avatarState, setAvatarState] = useState<VideoAvatarState>(() =>
    avatarCtrl.getState(),
  );

  const activeServerUrl = normalizeVideoAvatarUrl(urlInput);
  const useRemoteIdle = Boolean(
    !idleUrl && activeServerUrl && avatarState.lastHealth?.ok && avatarState.lastHealth?.hasIdle,
  );
  const cacheBust = avatarState.lastHealth?.checkedAt ? `?v=${avatarState.lastHealth.checkedAt}` : "";
  const resolvedIdleUrl =
    idleUrl ||
    (useRemoteIdle
      ? `${buildIdleUrl(activeServerUrl)}${cacheBust}`
      : config("video_avatar_idle_url") || "/avatar/nara_idle.mp4");
  const resolvedPosterUrl =
    posterUrl ||
    (useRemoteIdle
      ? `${buildPosterUrl(activeServerUrl)}${cacheBust}`
      : config("video_avatar_poster_url") || "/avatar/nara_poster.jpg");

  // Reset asset error flags when URLs change
  useEffect(() => {
    setIdleVideoFailed(false);
  }, [resolvedIdleUrl]);

  useEffect(() => {
    setPosterFailed(false);
  }, [resolvedPosterUrl]);

  useEffect(() => {
    return avatarCtrl.subscribe(setAvatarState);
  }, [avatarCtrl]);

  // Keep idle video playing smoothly in background
  useEffect(() => {
    const idleEl = idleVideoRef.current;
    if (!idleEl || idleVideoFailed) return;
    idleEl.play().catch(() => {
      // Autoplay muted should succeed; ignore transient errors
    });
  }, [resolvedIdleUrl, idleVideoFailed]);

  // Keep speak video muted prop synchronized dynamically
  useEffect(() => {
    if (speakVideoRef.current) {
      speakVideoRef.current.muted = mutedPlayback;
    }
  }, [mutedPlayback]);

  const revokeUrlNow = useCallback((url: string | null) => {
    if (!url) return;
    try {
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    }
  }, []);

  const stopPlayback = useCallback(() => {
    playbackGenRef.current++;
    if (revokeTimerRef.current) {
      clearTimeout(revokeTimerRef.current);
      revokeTimerRef.current = null;
    }

    setSpeakVisible(false);

    const video = speakVideoRef.current;
    if (video) {
      try {
        video.pause();
        video.removeAttribute("src");
        video.load();
      } catch {
        // ignore
      }
    }

    if (activeObjectUrlRef.current) {
      revokeUrlNow(activeObjectUrlRef.current);
      activeObjectUrlRef.current = null;
    }

    if (resolvePlaybackRef.current) {
      const done = resolvePlaybackRef.current;
      resolvePlaybackRef.current = null;
      done();
    }
  }, [revokeUrlNow]);

  const playBlob = useCallback(
    (blob: Blob): Promise<void> => {
      return new Promise<void>((resolve) => {
        const video = speakVideoRef.current;
        if (!video) {
          resolve();
          return;
        }

        // Cancel any previous pending playback cleanly without black flash
        const gen = ++playbackGenRef.current;
        if (revokeTimerRef.current) {
          clearTimeout(revokeTimerRef.current);
          revokeTimerRef.current = null;
        }
        if (resolvePlaybackRef.current) {
          const prevResolve = resolvePlaybackRef.current;
          resolvePlaybackRef.current = null;
          prevResolve();
        }

        const prevUrl = activeObjectUrlRef.current;
        const nextUrl = URL.createObjectURL(blob);
        activeObjectUrlRef.current = nextUrl;
        resolvePlaybackRef.current = resolve;

        const finish = (fadeOut: boolean) => {
          if (gen !== playbackGenRef.current) return;
          cleanupListeners();
          if (fadeOut) {
            setSpeakVisible(false);
            const urlToRevoke = nextUrl;
            revokeTimerRef.current = setTimeout(() => {
              if (activeObjectUrlRef.current === urlToRevoke) {
                try {
                  video.pause();
                  video.removeAttribute("src");
                  video.load();
                } catch {
                  // ignore
                }
                revokeUrlNow(urlToRevoke);
                activeObjectUrlRef.current = null;
              }
            }, 220);
          }

          if (resolvePlaybackRef.current === resolve) {
            resolvePlaybackRef.current = null;
          }
          resolve();
        };

        const onPlaying = () => {
          if (gen !== playbackGenRef.current) return;
          setSpeakVisible(true);
          if (prevUrl && prevUrl !== nextUrl) {
            revokeUrlNow(prevUrl);
          }
        };

        const onEnded = () => finish(true);
        const onError = () => finish(true);

        const cleanupListeners = () => {
          video.removeEventListener("playing", onPlaying);
          video.removeEventListener("ended", onEnded);
          video.removeEventListener("error", onError);
        };

        video.addEventListener("playing", onPlaying, { once: true });
        video.addEventListener("ended", onEnded, { once: true });
        video.addEventListener("error", onError, { once: true });

        video.muted = mutedPlayback;
        video.src = nextUrl;
        video.currentTime = 0;

        video.play().catch((err) => {
          console.warn("Video Avatar autoplay/play error:", err);
          // Fallback: if unmuted autoplay was blocked on first load, retry muted so lips still move
          if (!video.muted) {
            video.muted = true;
            video.play().catch(() => finish(true));
          } else {
            finish(true);
          }
        });
      });
    },
    [mutedPlayback, revokeUrlNow],
  );

  // Register player handlers on the controller
  useEffect(() => {
    avatarCtrl.registerPlayer({
      play: playBlob,
      stop: stopPlayback,
    });
    return () => {
      stopPlayback();
      avatarCtrl.registerPlayer(null);
    };
  }, [avatarCtrl, playBlob, stopPlayback]);

  // Run initial health check if URL is already set (operator view only)
  useEffect(() => {
    if (!showOperatorPanel) return;
    const saved = normalizeVideoAvatarUrl(config("video_avatar_url"));
    if (saved) {
      avatarCtrl.checkHealth(saved);
    }
  }, [avatarCtrl, showOperatorPanel]);

  const handleSaveAndCheck = async () => {
    const normalized = normalizeVideoAvatarUrl(urlInput);
    setUrlInput(normalized || urlInput.trim());
    await updateConfig("video_avatar_url", normalized);
    if (normalized) {
      await updateConfig("video_avatar_enabled", "true");
    }

    setCheckingHealth(true);
    try {
      const healthRes = await avatarCtrl.checkHealth(normalized);
      const remoteAssets =
        normalized && healthRes.ok && healthRes.hasIdle
          ? {
              idleUrl: `${buildIdleUrl(normalized)}?v=${healthRes.checkedAt}`,
              posterUrl: `${buildPosterUrl(normalized)}?v=${healthRes.checkedAt}`,
            }
          : undefined;
      onServerUrlChanged?.(normalized, remoteAssets);
    } finally {
      setCheckingHealth(false);
    }
  };

  const handleTestSpeak = async () => {
    const normalized = normalizeVideoAvatarUrl(urlInput);
    if (!normalized) {
      await avatarCtrl.checkHealth("");
      return;
    }

    await updateConfig("video_avatar_url", normalized);
    setTestingSpeak(true);
    try {
      avatarCtrl.stop();
      const blob = await avatarCtrl.fetchSpeakVideo(TEST_SPEAK_TEXT, {
        url: normalized,
        emotion: "happy",
      });
      if (blob) {
        stageSync.broadcastSubtitle(TEST_SPEAK_TEXT, true);
        stageSync.broadcastVideoPlay(blob, TEST_SPEAK_TEXT);
        await avatarCtrl.playBlob(blob);
      }
    } catch (err) {
      console.error("Test speak failed:", err);
    } finally {
      setTestingSpeak(false);
    }
  };

  const savedUrl = normalizeVideoAvatarUrl(urlInput);
  const health = avatarState.lastHealth;
  const needsFallbackWarning =
    !savedUrl || (health !== null && !health.ok) || Boolean(avatarState.lastError);

  const statusDotClass = !savedUrl
    ? "bg-amber-400"
    : health?.ok
      ? "bg-emerald-400"
      : health && !health.ok
        ? "bg-red-500"
        : "bg-slate-400";

  return (
    <div className="fixed inset-0 z-[1] overflow-hidden bg-slate-950 select-none">
      {/* Studio fallback backdrop if idle video and poster are not yet present */}
      <div className="absolute inset-0 bg-gradient-to-b from-slate-900 via-slate-950 to-slate-900" />

      {/* Fallback poster image */}
      {!posterFailed && (
        <img
          src={resolvedPosterUrl}
          alt="Nara Avatar"
          onError={() => setPosterFailed(true)}
          className="absolute inset-0 h-full w-full object-contain md:object-cover"
        />
      )}

      {/* Bottom layer: continuous looping idle video (prevents black blink between sentences) */}
      {!idleVideoFailed && (
        <video
          ref={idleVideoRef}
          src={resolvedIdleUrl}
          poster={posterFailed ? undefined : resolvedPosterUrl}
          autoPlay
          loop
          muted
          playsInline
          onError={() => setIdleVideoFailed(true)}
          className="absolute inset-0 h-full w-full object-contain md:object-cover"
        />
      )}

      {/* Placeholder hint ONLY on operator view when neither video nor poster asset exists yet */}
      {showOperatorPanel && idleVideoFailed && posterFailed && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none px-6">
          <div className="max-w-md rounded-xl border border-white/15 bg-slate-900/70 px-5 py-4 text-center text-sm text-slate-200 backdrop-blur-md">
            <p className="font-semibold text-white">Mode Video Avatar Aktif</p>
            <p className="mt-1 text-xs text-slate-300">
              Tambahkan <code className="text-sky-300">public/avatar/nara_idle.mp4</code> dan{" "}
              <code className="text-sky-300">public/avatar/nara_poster.jpg</code> agar tampilan idle
              Nara terlihat halus di latar belakang.
            </p>
          </div>
        </div>
      )}

      {/* Top layer: talking-head video from POST /speak with smooth opacity cross-fade */}
      <video
        ref={speakVideoRef}
        playsInline
        muted={mutedPlayback}
        className={clsx(
          "absolute inset-0 h-full w-full object-contain md:object-cover transition-opacity duration-200 ease-out pointer-events-none",
          speakVisible ? "opacity-100" : "opacity-0",
        )}
      />

      {/* Operator Control Panel (top-right, collapsible for clean stage presentation) */}
      {showOperatorPanel && (
        <div className="fixed right-3 top-3 z-30 flex flex-col items-end">
          {panelCollapsed ? (
            <button
              type="button"
              onClick={() => setPanelCollapsed(false)}
              className="flex items-center gap-2 rounded-full border border-white/20 bg-slate-900/80 px-3.5 py-1.5 text-xs font-semibold text-white shadow-lg backdrop-blur-md hover:bg-slate-800/90"
            >
              <span className={clsx("h-2.5 w-2.5 rounded-full", statusDotClass)} />
              <span>Video Avatar</span>
              {stageConnected && (
                <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] text-emerald-300">
                  Stage
                </span>
              )}
            </button>
          ) : (
            <div className="w-80 max-w-[calc(100vw-1.5rem)] rounded-xl border border-white/15 bg-slate-900/85 p-3.5 text-xs text-slate-100 shadow-2xl backdrop-blur-md">
              <div className="flex items-center justify-between gap-2 pb-2 border-b border-white/10">
                <div className="flex items-center gap-2">
                  <span className={clsx("h-2.5 w-2.5 rounded-full shrink-0", statusDotClass)} />
                  <span className="font-bold tracking-wide text-white">
                    Panel Operator · Video Avatar
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setPanelCollapsed(true)}
                  className="rounded px-2 py-0.5 text-[11px] text-slate-300 hover:bg-white/10 hover:text-white"
                  title="Sembunyikan panel untuk tampilan panggung"
                >
                  Sembunyikan
                </button>
              </div>

              <div className="mt-2.5 space-y-2">
                <label className="block text-[11px] font-medium text-slate-300">
                  URL Server Video Avatar — Ditto / MuseTalk (ubah live)
                </label>
                <input
                  type="url"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleSaveAndCheck();
                    }
                  }}
                  placeholder="https://xxxx.trycloudflare.com"
                  className="w-full rounded-md border border-white/20 bg-slate-950/80 px-2.5 py-1.5 text-xs text-white placeholder:text-slate-500 focus:border-sky-400 focus:outline-none"
                />

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={checkingHealth}
                    onClick={handleSaveAndCheck}
                    className="rounded-md bg-sky-600 px-2.5 py-1.5 font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
                  >
                    {checkingHealth ? "Mengecek..." : "Simpan & Cek"}
                  </button>
                  <button
                    type="button"
                    disabled={testingSpeak || !savedUrl}
                    onClick={handleTestSpeak}
                    className="rounded-md bg-emerald-600 px-2.5 py-1.5 font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                  >
                    {testingSpeak ? "Memutar..." : "Tes Bicara"}
                  </button>
                </div>

                {/* Health status readout */}
                {health && (
                  <div
                    className={clsx(
                      "rounded-md px-2.5 py-1.5 text-[11px]",
                      health.ok
                        ? "bg-emerald-500/15 text-emerald-200 border border-emerald-500/30"
                        : "bg-red-500/15 text-red-200 border border-red-500/30",
                    )}
                  >
                    {health.ok ? (
                      <span>
                        Siap · {health.engine ? `${health.engine} · ` : ""}
                        {health.avatar || "nara"}
                        {health.gpu ? ` · ${health.gpu}` : ""}
                        {typeof health.latencyMs === "number" ? ` · ${health.latencyMs}ms` : ""}
                      </span>
                    ) : (
                      <span>Gagal: {health.error || "Server tidak merespons"}</span>
                    )}
                  </div>
                )}

                {avatarState.lastError && (!health || health.ok) && (
                  <div className="rounded-md bg-red-500/15 border border-red-500/30 px-2.5 py-1.5 text-[11px] text-red-200">
                    {avatarState.lastError}
                  </div>
                )}

                {/* Quick fallback prompt if URL missing or server down */}
                {needsFallbackWarning && onSwitchToVrm && (
                  <div className="rounded-md border border-amber-400/40 bg-amber-500/15 p-2 text-[11px] text-amber-100">
                    <p className="font-medium">
                      {!savedUrl
                        ? "URL server video belum diisi."
                        : "Server video belum siap / bermasalah."}
                    </p>
                    <button
                      type="button"
                      onClick={onSwitchToVrm}
                      className="mt-1.5 w-full rounded bg-amber-500 px-2 py-1 text-center font-bold text-slate-950 hover:bg-amber-400"
                    >
                      Fallback Cepat ke Mode 3D VRM
                    </button>
                  </div>
                )}

                {/* Always available manual switch to 3D VRM backup */}
                {onSwitchToVrm && (
                  <button
                    type="button"
                    onClick={onSwitchToVrm}
                    className="w-full rounded-md border border-white/20 bg-white/10 px-2.5 py-1.5 font-medium text-slate-100 hover:bg-white/20"
                  >
                    Pindah ke Mode 3D VRM (Cadangan)
                  </button>
                )}

                {/* Second-screen Stage Projector controls */}
                {onOpenStageWindow && (
                  <div className="pt-2 border-t border-white/10 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={onOpenStageWindow}
                        className="flex-1 rounded-md bg-indigo-600 px-2.5 py-1.5 font-semibold text-white hover:bg-indigo-500"
                      >
                        Buka Layar Proyektor (/stage)
                      </button>
                      <span
                        className={clsx(
                          "rounded px-1.5 py-1 text-[10px] font-semibold",
                          stageConnected
                            ? "bg-emerald-500/20 text-emerald-300"
                            : "bg-slate-700 text-slate-300",
                        )}
                      >
                        {stageConnected ? "Terhubung" : "Offline"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-slate-300">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={stageShowSubtitles}
                          onChange={onToggleStageSubtitles}
                          className="rounded border-slate-500 bg-slate-800 text-indigo-500"
                        />
                        <span>Subtitle Proyektor</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={stageAudioOnProjector}
                          onChange={onToggleStageAudio}
                          className="rounded border-slate-500 bg-slate-800 text-indigo-500"
                        />
                        <span>Audio di Proyektor</span>
                      </label>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
