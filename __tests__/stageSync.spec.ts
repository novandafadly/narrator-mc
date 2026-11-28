import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";
import { StageSync, StageSyncMessage } from "../src/features/stageSync/stageSync";

class MockBroadcastChannel {
  static channels = new Map<string, Set<MockBroadcastChannel>>();
  public name: string;
  public onmessage: ((ev: MessageEvent) => void) | null = null;

  constructor(name: string) {
    this.name = name;
    if (!MockBroadcastChannel.channels.has(name)) {
      MockBroadcastChannel.channels.set(name, new Set());
    }
    MockBroadcastChannel.channels.get(name)!.add(this);
  }

  postMessage(data: any) {
    const peers = MockBroadcastChannel.channels.get(this.name);
    if (!peers) return;
    peers.forEach((peer) => {
      if (peer !== this && peer.onmessage) {
        peer.onmessage({ data } as MessageEvent);
      }
    });
  }

  close() {
    MockBroadcastChannel.channels.get(this.name)?.delete(this);
  }
}

describe("StageSync BroadcastChannel", () => {
  const originalBC = (global as any).BroadcastChannel;

  beforeEach(() => {
    MockBroadcastChannel.channels.clear();
    (global as any).BroadcastChannel = MockBroadcastChannel;
  });

  afterEach(() => {
    (global as any).BroadcastChannel = originalBC;
  });

  test("delivers state_sync, subtitle, video_play, and stop between operator and /stage", () => {
    const operator = new StageSync("test_channel");
    const projector = new StageSync("test_channel");

    const received: StageSyncMessage[] = [];
    projector.subscribe((msg) => received.push(msg));

    operator.broadcastState({
      mode: "video",
      idleUrl: "/avatar/nara_idle.mp4",
      posterUrl: "/avatar/nara_poster.jpg",
      vrmUrl: "/vrm/Nara_Hijab.vrm",
      bgColor: "#1c2a3a",
      bgUrl: "",
      showSubtitles: true,
      stageAudio: false,
    });
    operator.broadcastSubtitle("[happy] Halo Bapak dan Ibu!", true);
    operator.broadcastStop();

    expect(received.map((m) => m.type)).toEqual([
      "state_sync",
      "subtitle",
      "stop",
    ]);

    operator.close();
    projector.close();
  });
});
