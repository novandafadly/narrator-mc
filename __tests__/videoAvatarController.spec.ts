import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";

jest.mock("../src/utils/config", () => {
  const store: Record<string, string> = {
    video_avatar_enabled: "true",
    video_avatar_url: "",
    video_avatar_voice: "id-ID-GadisNeural",
  };
  return {
    config: (key: string) => store[key] ?? "",
    updateConfig: async (key: string, val: string) => {
      store[key] = val;
    },
  };
});

import {
  VideoAvatarController,
  normalizeVideoAvatarUrl,
  buildHealthUrl,
  buildSpeakUrl,
} from "../src/features/videoAvatar/videoAvatarController";

describe("VideoAvatarController", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test("normalizeVideoAvatarUrl cleans trailing slashes and rejects invalid schemes", () => {
    expect(normalizeVideoAvatarUrl(" https://abc.trycloudflare.com/// ")).toBe(
      "https://abc.trycloudflare.com",
    );
    expect(normalizeVideoAvatarUrl("http://localhost:8000/")).toBe(
      "http://localhost:8000",
    );
    expect(normalizeVideoAvatarUrl("ftp://invalid.com")).toBe("");
    expect(normalizeVideoAvatarUrl("")).toBe("");
    expect(buildHealthUrl("https://abc.trycloudflare.com/")).toBe(
      "https://abc.trycloudflare.com/health",
    );
    expect(buildSpeakUrl("https://abc.trycloudflare.com/")).toBe(
      "https://abc.trycloudflare.com/speak",
    );
  });

  test("checkHealth returns ok and metadata on healthy server", async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        status: "ok",
        engine: "ditto-trt",
        avatar: "nara_hijab",
        gpu: "Tesla T4",
      }),
    })) as any;

    const ctrl = new VideoAvatarController();
    const health = await ctrl.checkHealth("https://demo.trycloudflare.com/");

    expect(health.ok).toBe(true);
    expect(health.engine).toBe("ditto-trt");
    expect(health.avatar).toBe("nara_hijab");
    expect(health.gpu).toBe("Tesla T4");
    expect(global.fetch).toHaveBeenCalledWith(
      "https://demo.trycloudflare.com/health",
      expect.objectContaining({ method: "GET" }),
    );
  });

  test("checkHealth returns failure on empty URL or HTTP error", async () => {
    const ctrl = new VideoAvatarController();
    const emptyRes = await ctrl.checkHealth("");
    expect(emptyRes.ok).toBe(false);

    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    })) as any;

    const errRes = await ctrl.checkHealth("https://down.trycloudflare.com");
    expect(errRes.ok).toBe(false);
    expect(errRes.error).toContain("503");
  });

  test("fetchSpeakVideo posts text, voice, fps, and optional emotion and returns mp4 Blob", async () => {
    const fakeBlob = new Blob(["mp4data"], { type: "video/mp4" });
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      blob: async () => fakeBlob,
    })) as any;

    const ctrl = new VideoAvatarController();
    const result = await ctrl.fetchSpeakVideo("Halo Bapak dan Ibu!", {
      url: "https://demo.trycloudflare.com",
      voice: "id-ID-GadisNeural",
      fps: 25,
      emotion: "Surprised",
    });

    expect(result).toBe(fakeBlob);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://demo.trycloudflare.com/speak",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: "Halo Bapak dan Ibu!",
          voice: "id-ID-GadisNeural",
          fps: 25,
          emotion: "surprised",
        }),
      }),
    );
  });

  test("stop() aborts all parallel in-flight /speak requests and stops active player", async () => {
    const abortedSignals: boolean[] = [];

    global.fetch = jest.fn((_url: any, init: any) => {
      return new Promise((_resolve, reject) => {
        const signal: AbortSignal = init.signal;
        signal.addEventListener("abort", () => {
          abortedSignals.push(true);
          const err = new Error("Aborted");
          (err as any).name = "AbortError";
          reject(err);
        });
      });
    }) as any;

    const playerStop = jest.fn();
    const ctrl = new VideoAvatarController();
    ctrl.registerPlayer({
      play: async () => {},
      stop: playerStop,
    });

    const p1 = ctrl.fetchSpeakVideo("Kalimat pertama.", {
      url: "https://demo.trycloudflare.com",
    });
    const p2 = ctrl.fetchSpeakVideo("Kalimat kedua.", {
      url: "https://demo.trycloudflare.com",
    });

    ctrl.stop();

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBeNull();
    expect(r2).toBeNull();
    expect(abortedSignals).toHaveLength(2);
    expect(playerStop).toHaveBeenCalledTimes(1);
  });
});
