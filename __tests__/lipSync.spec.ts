import { describe, expect, test, jest } from "@jest/globals";
import { LipSync, analyzeVowelWeights } from "../src/features/lipSync/lipSync";

describe("Multi-vowel FFT LipSync", () => {
  const sampleRate = 48000;
  const fftSize = 2048;
  const binHz = sampleRate / fftSize;

  function makeSpectrum(peakHz: number, magnitude = 220): Uint8Array {
    const bins = new Uint8Array(fftSize / 2);
    const center = Math.round(peakHz / binHz);
    for (let i = Math.max(0, center - 3); i <= Math.min(bins.length - 1, center + 3); i++) {
      bins[i] = magnitude;
    }
    return bins;
  }

  test("returns zero vowels when volume is 0", () => {
    const spectrum = makeSpectrum(800, 255);
    expect(analyzeVowelWeights(spectrum, sampleRate, fftSize, 0)).toEqual({
      aa: 0,
      ih: 0,
      ou: 0,
      ee: 0,
      oh: 0,
    });
  });

  test("maps low, mid, and high formant bands to ou/aa/ih appropriately", () => {
    const lowSpec = makeSpectrum(320, 240);
    const lowVowels = analyzeVowelWeights(lowSpec, sampleRate, fftSize, 0.8);
    expect(lowVowels.ou).toBeGreaterThan(lowVowels.ih);
    expect(lowVowels.ou).toBeGreaterThan(lowVowels.ee);

    const midSpec = makeSpectrum(1100, 240);
    const midVowels = analyzeVowelWeights(midSpec, sampleRate, fftSize, 0.8);
    expect(midVowels.aa).toBeGreaterThan(midVowels.ou);

    const highSpec = makeSpectrum(3100, 240);
    const highVowels = analyzeVowelWeights(highSpec, sampleRate, fftSize, 0.8);
    expect(highVowels.ih).toBeGreaterThan(highVowels.ou);
    expect(highVowels.ih).toBeGreaterThan(highVowels.oh);
  });

  test("LipSync.update() stays backward-compatible with volume and returns vowels", () => {
    const fakeAnalyser = {
      fftSize: 2048,
      frequencyBinCount: 1024,
      smoothingTimeConstant: 0.5,
      getFloatTimeDomainData: (arr: Float32Array) => {
        arr.fill(0.3);
      },
      getByteFrequencyData: (arr: Uint8Array) => {
        arr.fill(0);
        const center = Math.round(1000 / binHz);
        arr[center] = 220;
        arr[center + 1] = 220;
      },
    };

    const fakeAudioCtx = {
      sampleRate,
      state: "running",
      createAnalyser: () => fakeAnalyser,
      createGain: () => ({ gain: { value: 1 }, connect: jest.fn() }),
      createBufferSource: () => ({
        buffer: null,
        connect: jest.fn(),
        start: jest.fn(),
        stop: jest.fn(),
        disconnect: jest.fn(),
        addEventListener: jest.fn(),
      }),
      decodeAudioData: jest.fn(async () => ({})),
      destination: {},
    } as any;

    const lipSync = new LipSync(fakeAudioCtx);
    const res = lipSync.update();
    expect(res.volume).toBeGreaterThan(0);
    expect(res.vowels.aa).toBeGreaterThan(0);
    expect(typeof res.vowels.ih).toBe("number");
    expect(typeof res.vowels.ou).toBe("number");
    expect(typeof res.vowels.ee).toBe("number");
    expect(typeof res.vowels.oh).toBe("number");
  });

  test("LipSync.stop() stops active source and invokes pending onEnded callback", async () => {
    const stopMock = jest.fn();
    const disconnectMock = jest.fn();
    const onEnded = jest.fn();

    const fakeAudioCtx = {
      sampleRate,
      state: "running",
      createAnalyser: () => ({
        fftSize: 2048,
        frequencyBinCount: 1024,
        smoothingTimeConstant: 0.5,
        getFloatTimeDomainData: jest.fn(),
        getByteFrequencyData: jest.fn(),
      }),
      createGain: () => ({ gain: { value: 1 }, connect: jest.fn() }),
      createBufferSource: () => ({
        buffer: null,
        connect: jest.fn(),
        start: jest.fn(),
        stop: stopMock,
        disconnect: disconnectMock,
        addEventListener: jest.fn(),
      }),
      decodeAudioData: jest.fn(async () => ({})),
      destination: {},
    } as any;

    const lipSync = new LipSync(fakeAudioCtx);
    await lipSync.playFromArrayBuffer(new ArrayBuffer(16), onEnded);
    lipSync.stop();

    expect(stopMock).toHaveBeenCalledTimes(1);
    expect(disconnectMock).toHaveBeenCalledTimes(1);
    expect(onEnded).toHaveBeenCalledTimes(1);
  });
});
