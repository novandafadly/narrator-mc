import { useContext, useEffect, useMemo, useRef, useState } from "react";
import Head from "next/head";
import VideoAvatarViewer from "@/components/videoAvatarViewer";
import VrmViewer from "@/components/vrmViewer";
import { VrmStoreProvider } from "@/features/vrmStore/vrmStoreContext";
import { ViewerContext } from "@/features/vrmViewer/viewerContext";
import { VideoAvatarController } from "@/features/videoAvatar/videoAvatarController";
import {
  StageStatePayload,
  StageSyncMessage,
  stageSync,
} from "@/features/stageSync/stageSync";
import { config } from "@/utils/config";

function stripEmotionTags(text: string): string {
  return text.replace(/\[[^\]]*\]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Clean second-screen Stage Projector view (/stage).
 * Displays ONLY Nara's avatar (Photorealistic Video Avatar or 3D VRM backup)
 * plus optional clean ballroom subtitles — zero chat input, zero toolbar, zero operator UI.
 * Controlled live from the operator tab (/) via BroadcastChannel("nara_stage_sync").
 */
export default function StagePage() {
  const { viewer } = useContext(ViewerContext);
  const stageVideoController = useMemo(() => new VideoAvatarController(), []);

  const [mounted, setMounted] = useState(false);
  const [stageState, setStageState] = useState<StageStatePayload>({
    mode: "video",
    idleUrl: "/avatar/nara_idle.mp4",
    posterUrl: "/avatar/nara_poster.jpg",
    vrmUrl: "/avatar/model.glb",
    bgColor: "#1c2a3a",
    bgUrl: "",
    showSubtitles: true,
    stageAudio: false,
  });
  const [subtitle, setSubtitle] = useState("");
  const [showHint, setShowHint] = useState(true);

  const stageAudioRef = useRef(stageState.stageAudio);
  stageAudioRef.current = stageState.stageAudio;

  // Initialize from localStorage/config on client mount
  useEffect(() => {
    const initialMode = config("video_avatar_enabled") === "true" ? "video" : "vrm";
    const bgColor = config("bg_color") || "#1c2a3a";
    const bgUrl = config("bg_url") || "";
    setStageState({
      mode: initialMode,
      idleUrl: config("video_avatar_idle_url") || "/avatar/nara_idle.mp4",
      posterUrl: config("video_avatar_poster_url") || "/avatar/nara_poster.jpg",
      vrmUrl: config("vrm_url") || "/avatar/model.glb",
      bgColor,
      bgUrl,
      showSubtitles: config("stage_show_subtitles") !== "false",
      stageAudio: config("stage_audio_on_projector") === "true",
    });
    setMounted(true);
  }, []);

  // Apply stage background styling
  useEffect(() => {
    if (!mounted) return;
    if (stageState.bgColor) {
      document.body.style.backgroundColor = stageState.bgColor;
      document.body.style.backgroundImage = "";
    } else if (stageState.bgUrl) {
      document.body.style.backgroundImage = `url(${stageState.bgUrl})`;
    }
  }, [mounted, stageState.bgColor, stageState.bgUrl]);

  // Auto-hide fullscreen hint after 4.5s
  useEffect(() => {
    if (!mounted) return;
    const timer = setTimeout(() => setShowHint(false), 4500);
    return () => clearTimeout(timer);
  }, [mounted]);

  // Subscribe to operator BroadcastChannel events
  useEffect(() => {
    if (!mounted) return;

    const unsubscribe = stageSync.subscribe((msg: StageSyncMessage) => {
      switch (msg.type) {
        case "stage_ping":
          stageSync.post({ type: "stage_pong", ts: Date.now() });
          break;

        case "state_sync":
          setStageState(msg.payload);
          break;

        case "subtitle":
          setSubtitle(msg.visible ? stripEmotionTags(msg.text) : "");
          break;

        case "video_play":
          if (msg.text) {
            setSubtitle(stripEmotionTags(msg.text));
          }
          stageVideoController.playBlob(msg.blob).catch((err) => {
            console.warn("Stage video playback error:", err);
          });
          break;

        case "vrm_speak":
          if (msg.screenplay?.text) {
            setSubtitle(stripEmotionTags(msg.screenplay.text));
          }
          viewer.model
            ?.speak(msg.audioBuffer, msg.screenplay, {
              muted: !stageAudioRef.current,
            })
            .catch((err) => {
              console.warn("Stage VRM speak error:", err);
            });
          break;

        case "vrm_emotion":
          viewer.model?.playEmotion(msg.expression);
          break;

        case "stop":
          stageVideoController.stop();
          viewer.model?.stopSpeaking();
          break;
      }
    });

    // Announce stage window to operator tab
    stageSync.post({ type: "stage_ping", ts: Date.now() });
    stageSync.post({ type: "stage_pong", ts: Date.now() });

    const onBeforeUnload = () => {
      stageSync.post({ type: "stage_bye", ts: Date.now() });
    };
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      stageSync.post({ type: "stage_bye", ts: Date.now() });
      stageVideoController.stop();
      viewer.model?.stopSpeaking();
      unsubscribe();
    };
  }, [mounted, stageVideoController, viewer]);

  const toggleFullscreen = () => {
    setShowHint(false);
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  };

  if (!mounted) return <></>;

  return (
    <>
      <Head>
        <title>Nara — Layar Proyektor</title>
      </Head>

      <div
        onDoubleClick={toggleFullscreen}
        className="fixed inset-0 overflow-hidden bg-slate-950 font-sans select-none cursor-default"
      >
        {stageState.mode === "video" ? (
          <VideoAvatarViewer
            controller={stageVideoController}
            idleUrl={stageState.idleUrl}
            posterUrl={stageState.posterUrl}
            mutedPlayback={!stageState.stageAudio}
            showOperatorPanel={false}
          />
        ) : (
          <VrmStoreProvider>
            <VrmViewer chatMode={false} />
          </VrmStoreProvider>
        )}

        {/* Optional clean ballroom subtitle overlay */}
        {stageState.showSubtitles && subtitle && (
          <div className="pointer-events-none fixed inset-x-0 bottom-8 z-20 flex justify-center px-8">
            <div className="max-w-5xl rounded-2xl border border-white/15 bg-slate-950/75 px-8 py-4 text-center shadow-2xl backdrop-blur-md">
              <p className="text-2xl md:text-3xl font-semibold leading-snug tracking-wide text-white drop-shadow">
                {subtitle}
              </p>
            </div>
          </div>
        )}

        {/* Brief auto-hiding fullscreen hint on first open */}
        {showHint && (
          <button
            type="button"
            onClick={toggleFullscreen}
            className="fixed right-4 top-4 z-30 rounded-full border border-white/20 bg-slate-900/75 px-4 py-1.5 text-xs font-medium text-slate-200 shadow-lg backdrop-blur-md hover:bg-slate-800/90 transition-opacity"
          >
            Klik / Double-klik untuk Fullscreen Proyektor
          </button>
        )}
      </div>
    </>
  );
}
