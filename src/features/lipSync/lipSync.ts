import { LipSyncAnalyzeResult, LipSyncVowels } from "./lipSyncAnalyzeResult";

const TIME_DOMAIN_DATA_LENGTH = 2048;

const ZERO_VOWELS: LipSyncVowels = {
  aa: 0,
  ih: 0,
  ou: 0,
  ee: 0,
  oh: 0,
};

/**
 * Pure helper to estimate smooth vowel blendshape weights (aa, ih, ou, ee, oh)
 * from an FFT magnitude spectrum (0..255 per bin) and overall speech volume.
 */
export function analyzeVowelWeights(
  frequencyData: Uint8Array,
  sampleRate: number,
  fftSize: number,
  volume: number,
): LipSyncVowels {
  if (volume <= 0 || frequencyData.length === 0 || sampleRate <= 0 || fftSize <= 0) {
    return { ...ZERO_VOWELS };
  }

  const binHz = sampleRate / fftSize;
  const bandAvg = (minHz: number, maxHz: number): number => {
    const start = Math.max(0, Math.floor(minHz / binHz));
    const end = Math.min(frequencyData.length - 1, Math.ceil(maxHz / binHz));
    if (end < start) return 0;
    let sum = 0;
    for (let i = start; i <= end; i++) {
      sum += frequencyData[i];
    }
    return sum / ((end - start + 1) * 255);
  };

  // Acoustic formant energy bands tuned for clear Indonesian speech
  const low = bandAvg(200, 480);      // strong in ou / oh
  const midLow = bandAvg(480, 920);   // strong in oh / aa (F1)
  const mid = bandAvg(920, 1650);     // strong in aa / ee
  const midHigh = bandAvg(1650, 2600);// strong in ee / ih (F2)
  const high = bandAvg(2600, 3900);   // strong in ih (high F2/F3)

  const raw: LipSyncVowels = {
    aa: midLow * 0.65 + mid * 0.55,
    oh: low * 0.55 + midLow * 0.6,
    ou: low * 0.85 + midLow * 0.2,
    ee: mid * 0.45 + midHigh * 0.7,
    ih: midHigh * 0.45 + high * 0.8,
  };

  const maxRaw = Math.max(raw.aa, raw.ih, raw.ou, raw.ee, raw.oh);
  if (maxRaw < 0.01) {
    // Fallback to subtle 'aa' driven by volume if spectrum is flat/silent
    return { aa: volume, ih: 0, ou: 0, ee: 0, oh: 0 };
  }

  // Emphasize dominant vowel slightly so mouth shapes stay crisp and distinct
  const norm = (val: number) => {
    const ratio = val / maxRaw;
    return Math.min(1, Math.max(0, Math.pow(ratio, 1.8) * volume));
  };

  return {
    aa: norm(raw.aa),
    ih: norm(raw.ih),
    ou: norm(raw.ou),
    ee: norm(raw.ee),
    oh: norm(raw.oh),
  };
}

export class LipSync {
  public readonly audio: AudioContext;
  public readonly analyser: AnalyserNode;
  public readonly timeDomainData: Float32Array;
  public readonly frequencyData: Uint8Array;

  private smoothedVowels: LipSyncVowels = { ...ZERO_VOWELS };
  private smoothedVolume: number = 0;
  private activeSource: AudioBufferSourceNode | null = null;
  private activeOnEnded: (() => void) | null = null;

  public constructor(audio: AudioContext) {
    this.audio = audio;

    this.analyser = audio.createAnalyser();
    this.analyser.fftSize = TIME_DOMAIN_DATA_LENGTH;
    this.analyser.smoothingTimeConstant = 0.5;
    this.timeDomainData = new Float32Array(TIME_DOMAIN_DATA_LENGTH);
    this.frequencyData = new Uint8Array(this.analyser.frequencyBinCount);
  }

  public update(): LipSyncAnalyzeResult {
    this.analyser.getFloatTimeDomainData(this.timeDomainData);

    let volume = 0.0;
    for (let i = 0; i < TIME_DOMAIN_DATA_LENGTH; i++) {
      volume = Math.max(volume, Math.abs(this.timeDomainData[i]));
    }

    // cook
    volume = 1 / (1 + Math.exp(-45 * volume + 5));
    if (volume < 0.1) volume = 0;

    // Smooth volume transitions slightly
    const volAlpha = volume > this.smoothedVolume ? 0.55 : 0.35;
    this.smoothedVolume += (volume - this.smoothedVolume) * volAlpha;
    if (this.smoothedVolume < 0.01 && volume === 0) {
      this.smoothedVolume = 0;
    }

    let targetVowels: LipSyncVowels = ZERO_VOWELS;
    if (this.smoothedVolume > 0) {
      this.analyser.getByteFrequencyData(this.frequencyData);
      targetVowels = analyzeVowelWeights(
        this.frequencyData,
        this.audio.sampleRate || 44100,
        this.analyser.fftSize || TIME_DOMAIN_DATA_LENGTH,
        this.smoothedVolume,
      );
    }

    const vowelAlpha = 0.4;
    this.smoothedVowels = {
      aa: this.smoothedVowels.aa + (targetVowels.aa - this.smoothedVowels.aa) * vowelAlpha,
      ih: this.smoothedVowels.ih + (targetVowels.ih - this.smoothedVowels.ih) * vowelAlpha,
      ou: this.smoothedVowels.ou + (targetVowels.ou - this.smoothedVowels.ou) * vowelAlpha,
      ee: this.smoothedVowels.ee + (targetVowels.ee - this.smoothedVowels.ee) * vowelAlpha,
      oh: this.smoothedVowels.oh + (targetVowels.oh - this.smoothedVowels.oh) * vowelAlpha,
    };

    return {
      volume: this.smoothedVolume,
      vowels: { ...this.smoothedVowels },
    };
  }

  public stop() {
    if (this.activeSource) {
      try {
        this.activeSource.stop();
      } catch {
        // already stopped
      }
      try {
        this.activeSource.disconnect();
      } catch {
        // already disconnected
      }
      this.activeSource = null;
    }

    if (this.activeOnEnded) {
      const cb = this.activeOnEnded;
      this.activeOnEnded = null;
      cb();
    }

    this.smoothedVolume = 0;
    this.smoothedVowels = { ...ZERO_VOWELS };
  }

  public async playFromArrayBuffer(
    buffer: ArrayBuffer,
    onEnded?: () => void,
    options?: { muted?: boolean },
  ) {
    this.stop();

    if (this.audio.state === "suspended") {
      try {
        await this.audio.resume();
      } catch {
        // ignore resume error in non-gesture context
      }
    }

    // Clone buffer because decodeAudioData detaches the passed ArrayBuffer
    const audioBuffer = await this.audio.decodeAudioData(buffer.slice(0));

    const bufferSource = this.audio.createBufferSource();
    bufferSource.buffer = audioBuffer;

    bufferSource.connect(this.analyser);
    if (options?.muted) {
      const silentGain = this.audio.createGain();
      silentGain.gain.value = 0;
      bufferSource.connect(silentGain);
      silentGain.connect(this.audio.destination);
    } else {
      bufferSource.connect(this.audio.destination);
    }

    this.activeSource = bufferSource;
    this.activeOnEnded = onEnded || null;

    bufferSource.addEventListener("ended", () => {
      if (this.activeSource === bufferSource) {
        this.activeSource = null;
      }
      if (this.activeOnEnded) {
        const cb = this.activeOnEnded;
        this.activeOnEnded = null;
        cb();
      }
    });

    bufferSource.start();
  }

  public async playFromURL(url: string, onEnded?: () => void) {
    const res = await fetch(url);
    const buffer = await res.arrayBuffer();
    await this.playFromArrayBuffer(buffer, onEnded);
  }
}
