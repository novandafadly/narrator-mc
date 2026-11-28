import { describe, expect, test, jest } from "@jest/globals";
import * as THREE from "three";
import { ExpressionController } from "../src/features/emoteController/expressionController";

function createMockVrm(presetNames: string[], customNames: string[] = []) {
  const values: Record<string, number> = {};
  const presetExpressionMap: Record<string, any> = {};
  const expressionMap: Record<string, any> = {};

  for (const name of presetNames) {
    presetExpressionMap[name] = { name };
    expressionMap[name] = { name };
    values[name] = 0;
  }
  for (const name of customNames) {
    expressionMap[name] = { name };
    values[name] = 0;
  }

  const setValue = jest.fn((name: string, val: number) => {
    values[name] = val;
  });

  const vrm = {
    expressionManager: {
      expressionMap,
      presetExpressionMap,
      registerExpression: jest.fn(),
      setValue,
    },
    lookAt: {
      target: null,
    },
  } as any;

  return { vrm, values, setValue };
}

describe("ExpressionController (VRM 1.0)", () => {
  test("resolves [surprised] and [shy] case-insensitively on VRM 1.0 presets", () => {
    const { vrm } = createMockVrm([
      "neutral",
      "happy",
      "relaxed",
      "surprised",
      "blink",
      "aa",
      "ih",
      "ou",
      "ee",
      "oh",
    ]);

    const ctrl = new ExpressionController(vrm, new THREE.Object3D());
    // Surprised capitalized (from textsToScreenplay) resolves to lowercase VRM 1.0 preset
    expect(ctrl.resolveExpressionName("Surprised")).toBe("surprised");
    expect(ctrl.resolveExpressionName("SURPRISED")).toBe("surprised");
    // Shy falls back gracefully to relaxed when custom shy blendshape isn't authored
    expect(ctrl.resolveExpressionName("Shy")).toBe("relaxed");
  });

  test("cross-fades smoothly between emotions and keeps AutoBlink active during happy/relaxed", () => {
    const { vrm, values } = createMockVrm([
      "neutral",
      "happy",
      "relaxed",
      "surprised",
      "blink",
      "aa",
      "ih",
      "ou",
      "ee",
      "oh",
    ]);

    const ctrl = new ExpressionController(vrm, new THREE.Object3D());
    ctrl.playEmotion("happy");

    // First frame starts ramping smoothly rather than snapping immediately to 1
    ctrl.update(0.05);
    expect(values.happy).toBeGreaterThan(0);
    expect(values.happy).toBeLessThan(0.72);

    // After several frames, happy converges to target weight
    for (let i = 0; i < 20; i++) {
      ctrl.update(0.05);
    }
    expect(values.happy).toBeCloseTo(0.72, 2);

    // AutoBlink still fires while happy is active
    let blinkTriggered = false;
    for (let i = 0; i < 200; i++) {
      ctrl.update(0.05);
      if (values.blink === 1) {
        blinkTriggered = true;
        break;
      }
    }
    expect(blinkTriggered).toBe(true);

    // Transition to Surprised fades happy down while ramping surprised up
    ctrl.playEmotion("Surprised");
    ctrl.update(0.05);
    expect(values.surprised).toBeGreaterThan(0);
    expect(values.happy).toBeLessThan(0.72);
  });

  test("lipSyncVowels drives all 5 VRM vowel presets smoothly", () => {
    const { vrm, values } = createMockVrm([
      "neutral",
      "happy",
      "blink",
      "aa",
      "ih",
      "ou",
      "ee",
      "oh",
    ]);

    const ctrl = new ExpressionController(vrm, new THREE.Object3D());
    ctrl.lipSyncVowels({ aa: 0.8, ih: 0.2, ou: 0.1, ee: 0.3, oh: 0.5 });
    ctrl.update(0.016);

    expect(values.aa).toBeGreaterThan(values.ou);
    expect(values.oh).toBeGreaterThan(values.ih);
    expect(values.ee).toBeGreaterThan(0);
  });
});
