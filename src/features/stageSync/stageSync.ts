import { Screenplay } from "@/features/chat/messages";

export const STAGE_SYNC_CHANNEL_NAME = "nara_stage_sync";

export type AvatarDisplayMode = "video" | "vrm";

export interface StageStatePayload {
  mode: AvatarDisplayMode;
  idleUrl: string;
  posterUrl: string;
  vrmUrl: string;
  bgColor: string;
  bgUrl: string;
  showSubtitles: boolean;
  stageAudio: boolean;
}

export type StageSyncMessage =
  | { type: "stage_ping"; ts: number }
  | { type: "stage_pong"; ts: number }
  | { type: "stage_bye"; ts: number }
  | { type: "state_sync"; payload: StageStatePayload }
  | { type: "subtitle"; text: string; visible: boolean }
  | { type: "video_play"; blob: Blob; text: string }
  | { type: "vrm_speak"; audioBuffer: ArrayBuffer; screenplay: Screenplay }
  | { type: "vrm_emotion"; expression: string }
  | { type: "stop" };

type MessageHandler = (message: StageSyncMessage) => void;

/**
 * BroadcastChannel-based synchronizer between the Operator tab (/)
 * and the clean second-screen Projector tab (/stage) in the same browser.
 */
export class StageSync {
  private channel: BroadcastChannel | null = null;
  private listeners = new Set<MessageHandler>();
  private channelName: string;

  constructor(channelName: string = STAGE_SYNC_CHANNEL_NAME) {
    this.channelName = channelName;
  }

  private ensureChannel(): BroadcastChannel | null {
    if (this.channel) return this.channel;
    if (typeof BroadcastChannel === "undefined") {
      return null;
    }
    try {
      const ch = new BroadcastChannel(this.channelName);
      ch.onmessage = (event: MessageEvent<StageSyncMessage>) => {
        if (!event?.data || typeof event.data !== "object") return;
        this.listeners.forEach((fn) => fn(event.data));
      };
      this.channel = ch;
      return ch;
    } catch {
      return null;
    }
  }

  public isSupported(): boolean {
    return typeof BroadcastChannel !== "undefined";
  }

  public post(message: StageSyncMessage): boolean {
    const ch = this.ensureChannel();
    if (!ch) return false;
    try {
      ch.postMessage(message);
      return true;
    } catch (err) {
      console.warn("StageSync postMessage failed:", err);
      return false;
    }
  }

  public subscribe(handler: MessageHandler): () => void {
    this.ensureChannel();
    this.listeners.add(handler);
    return () => {
      this.listeners.delete(handler);
    };
  }

  public broadcastState(payload: StageStatePayload) {
    this.post({ type: "state_sync", payload });
  }

  public broadcastSubtitle(text: string, visible: boolean = true) {
    this.post({ type: "subtitle", text, visible });
  }

  public broadcastVideoPlay(blob: Blob, text: string) {
    this.post({ type: "video_play", blob, text });
  }

  public broadcastVrmSpeak(audioBuffer: ArrayBuffer, screenplay: Screenplay) {
    // Clone ArrayBuffer so decoding on operator tab doesn't detach the buffer sent to /stage
    const copy = audioBuffer.slice(0);
    this.post({ type: "vrm_speak", audioBuffer: copy, screenplay });
  }

  public broadcastVrmEmotion(expression: string) {
    this.post({ type: "vrm_emotion", expression });
  }

  public broadcastStop() {
    this.post({ type: "stop" });
  }

  public close() {
    if (this.channel) {
      try {
        this.channel.close();
      } catch {
        // ignore close errors
      }
      this.channel = null;
    }
    this.listeners.clear();
  }
}

export const stageSync = new StageSync();
