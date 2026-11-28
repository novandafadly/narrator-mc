import * as THREE from "three";
import {
  VRM,
  VRMExpressionManager,
  VRMExpressionPresetName,
} from "@pixiv/three-vrm";
import { AutoLookAt } from "./autoLookAt";
import { AutoBlink } from "./autoBlink";
import { emotionNames } from "@/features/chat/messages";
import { LipSyncVowels } from "@/features/lipSync/lipSyncAnalyzeResult";

const VOWEL_KEYS: (keyof LipSyncVowels)[] = ["aa", "ih", "ou", "ee", "oh"];

// Expressions that look natural while blinking stays active
const BLINK_FRIENDLY_EMOTIONS = new Set([
  "neutral",
  "happy",
  "relaxed",
  "shy",
  "surprised",
  "joy",
  "fun",
]);

// Fallback aliases when a persona tag (e.g. [shy]) isn't explicitly authored in a VRM 1.0 model
const EXPRESSION_ALIASES: Record<string, string[]> = {
  shy: ["shy", "blush", "relaxed", "happy"],
  surprised: ["surprised", "surprise"],
  happy: ["happy", "joy", "fun"],
  relaxed: ["relaxed", "fun", "happy"],
  angry: ["angry"],
  sad: ["sad", "sorrow"],
  neutral: ["neutral"],
};

const EMOTION_TARGET_WEIGHT: Record<string, number> = {
  neutral: 0,
  happy: 0.72,
  relaxed: 0.7,
  surprised: 0.65,
  shy: 0.65,
  angry: 0.85,
  sad: 0.8,
};

const EMOTION_FADE_SPEED = 6.0;

/**
 * Expressionを管理するクラス
 *
 * VRM 1.0 のケース非依存検索、感情のスムーズなクロスフェード、
 * 笑顔・リラックス中の自然な自動瞬き維持、マルチ母音リップシンクをサポート。
 */
export class ExpressionController {
  private _autoLookAt: AutoLookAt;
  private _autoBlink?: AutoBlink;
  private _expressionManager?: VRMExpressionManager;
  private _expressionLookup = new Map<string, string>();
  private _currentEmotion: string;
  private _currentResolvedEmotion: string | null = null;
  private _targetEmotionWeight: number = 0;
  private _emotionWeights = new Map<string, number>();

  private _currentLipSync: {
    preset: VRMExpressionPresetName | string;
    value: number;
  } | null;
  private _currentVowels: LipSyncVowels | null = null;

  constructor(vrm: VRM, camera: THREE.Object3D) {
    this._autoLookAt = new AutoLookAt(vrm, camera);
    this._currentEmotion = "neutral";
    this._currentLipSync = null;
    this.registerExpression(vrm);
    if (vrm.expressionManager) {
      this._expressionManager = vrm.expressionManager;
      this._autoBlink = new AutoBlink(vrm.expressionManager);
    }
  }

  public registerExpression(vrm: VRM) {
    const expressionManager = vrm.expressionManager;
    if (!expressionManager) return;

    const { expressionMap: allExpressions, presetExpressionMap: presetExpressions } = expressionManager;
    const oddExpressions = Object.keys(allExpressions).filter(
      (key) => !(key in presetExpressions),
    );

    oddExpressions.forEach((expressionName) => {
      const expression = allExpressions[expressionName];
      if (expression) expressionManager.registerExpression(expression);
    });

    const allExpressionNames = Object.keys(allExpressions);
    this._expressionLookup.clear();
    // Register preset expressions first, then custom expressions
    Object.keys(presetExpressions || {}).forEach((name) => {
      this._expressionLookup.set(name.toLowerCase(), name);
    });
    allExpressionNames.forEach((name) => {
      const lower = name.toLowerCase();
      if (!this._expressionLookup.has(lower)) {
        this._expressionLookup.set(lower, name);
      }
    });

    emotionNames.push(...allExpressionNames);
    return allExpressionNames;
  }

  /**
   * Resolves an emotion or vowel name against the VRM's available expressions
   * case-insensitively, with clean fallbacks for persona tags like [surprised] and [shy].
   */
  public resolveExpressionName(name: string): string | null {
    if (!name) return null;
    const lower = name.toLowerCase();
    const direct = this._expressionLookup.get(lower);
    if (direct) return direct;

    const aliases = EXPRESSION_ALIASES[lower];
    if (aliases) {
      for (const alias of aliases) {
        const hit = this._expressionLookup.get(alias);
        if (hit) return hit;
      }
    }
    return null;
  }

  public playEmotion(preset: VRMExpressionPresetName | string) {
    const lower = String(preset || "neutral").toLowerCase();

    if (this._currentEmotion === lower) {
      return;
    }

    this._currentEmotion = lower;

    if (lower === "neutral") {
      this._currentResolvedEmotion = null;
      this._targetEmotionWeight = 0;
      this._autoBlink?.setEnable(true);
      return;
    }

    const resolved = this.resolveExpressionName(lower);
    this._currentResolvedEmotion = resolved;
    this._targetEmotionWeight =
      resolved != null
        ? (EMOTION_TARGET_WEIGHT[lower] ?? 0.65)
        : 0;

    // Keep AutoBlink active during natural MC expressions (happy, relaxed, shy, surprised)
    const shouldBlink = BLINK_FRIENDLY_EMOTIONS.has(lower);
    this._autoBlink?.setEnable(shouldBlink);

    if (resolved && !this._emotionWeights.has(resolved)) {
      this._emotionWeights.set(resolved, 0);
    }
  }

  public lipSync(preset: VRMExpressionPresetName | string, value: number) {
    this._currentVowels = null;
    if (this._currentLipSync && this._currentLipSync.preset !== preset) {
      const prev = this.resolveExpressionName(String(this._currentLipSync.preset)) || String(this._currentLipSync.preset);
      this._expressionManager?.setValue(prev, 0);
    }
    this._currentLipSync = {
      preset,
      value,
    };
  }

  public lipSyncVowels(vowels: LipSyncVowels) {
    this._currentLipSync = null;
    this._currentVowels = vowels;
  }

  public update(delta: number) {
    if (this._autoBlink) {
      this._autoBlink.update(delta);
    }

    // Smooth cross-fade across active emotion weights
    const step = Math.min(1, Math.max(0.05, delta * EMOTION_FADE_SPEED));
    if (this._currentResolvedEmotion && !this._emotionWeights.has(this._currentResolvedEmotion)) {
      this._emotionWeights.set(this._currentResolvedEmotion, 0);
    }

    this._emotionWeights.forEach((currentWeight, exprName) => {
      const target =
        exprName === this._currentResolvedEmotion ? this._targetEmotionWeight : 0;
      const next = currentWeight + (target - currentWeight) * step;
      const clamped = Math.abs(next - target) < 0.005 ? target : next;

      this._expressionManager?.setValue(exprName, clamped);
      if (clamped === 0 && target === 0) {
        this._emotionWeights.delete(exprName);
      } else {
        this._emotionWeights.set(exprName, clamped);
      }
    });

    const lipScale = this._currentEmotion === "neutral" ? 0.72 : 0.48;

    if (this._currentVowels) {
      for (const key of VOWEL_KEYS) {
        const resolved = this.resolveExpressionName(key) || key;
        const weight = Math.min(1, Math.max(0, this._currentVowels[key] * lipScale));
        this._expressionManager?.setValue(resolved, weight);
      }
    } else if (this._currentLipSync) {
      const resolved =
        this.resolveExpressionName(String(this._currentLipSync.preset)) ||
        String(this._currentLipSync.preset);
      const weight =
        this._currentEmotion === "neutral"
          ? this._currentLipSync.value * 0.5
          : this._currentLipSync.value * 0.25;
      this._expressionManager?.setValue(resolved, weight);
    }
  }
}