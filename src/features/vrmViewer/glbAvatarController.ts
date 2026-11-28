import * as THREE from "three";
import { LipSyncVowels } from "@/features/lipSync/lipSyncAnalyzeResult";

const ZERO_VOWELS: LipSyncVowels = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function damp(current: number, target: number, lambda: number, delta: number): number {
  const t = 1 - Math.exp(-lambda * Math.max(0, delta));
  return current + (target - current) * t;
}

/**
 * Map 5-vowel lip-sync amplitudes (aa, ih, ou, ee, oh) to ARKit facial
 * blendshape weights compatible with Avatar SDK MetaPerson, Avaturn, and
 * Ready Player Me GLB avatars.
 */
export function mapVowelsToArkit(vowels: LipSyncVowels): Record<string, number> {
  const aa = clamp01(vowels.aa);
  const ih = clamp01(vowels.ih);
  const ou = clamp01(vowels.ou);
  const ee = clamp01(vowels.ee);
  const oh = clamp01(vowels.oh);

  const jawOpen = clamp01(
    aa * 0.62 + oh * 0.48 + ee * 0.28 + ou * 0.22 + ih * 0.16,
  ) * 0.78;
  const mouthFunnel = clamp01(oh * 0.58 + ou * 0.44);
  const mouthPucker = clamp01(ou * 0.66 + oh * 0.18);
  const mouthStretch = clamp01(ee * 0.46 + ih * 0.50);
  const speechSmile = clamp01(ee * 0.24 + ih * 0.20);
  const mouthLowerDown = clamp01(aa * 0.30 + ee * 0.18 + oh * 0.14);
  const mouthUpperUp = clamp01(aa * 0.14 + ih * 0.15 + ee * 0.12);

  return {
    jawOpen,
    mouthFunnel,
    mouthPucker,
    mouthStretchLeft: mouthStretch,
    mouthStretchRight: mouthStretch,
    mouthSmileLeft: speechSmile,
    mouthSmileRight: speechSmile,
    mouthLowerDownLeft: mouthLowerDown,
    mouthLowerDownRight: mouthLowerDown,
    mouthUpperUpLeft: mouthUpperUp,
    mouthUpperUpRight: mouthUpperUp,
  };
}

const EMOTION_PRESETS: Record<string, Record<string, number>> = {
  // Subtle warm MC resting smile instead of a blank stare
  neutral: {
    mouthSmileLeft: 0.12,
    mouthSmileRight: 0.12,
    cheekSquintLeft: 0.05,
    cheekSquintRight: 0.05,
  },
  happy: {
    mouthSmileLeft: 0.52,
    mouthSmileRight: 0.52,
    cheekSquintLeft: 0.32,
    cheekSquintRight: 0.32,
    eyeSquintLeft: 0.18,
    eyeSquintRight: 0.18,
    browInnerUp: 0.10,
  },
  relaxed: {
    mouthSmileLeft: 0.34,
    mouthSmileRight: 0.34,
    cheekSquintLeft: 0.16,
    cheekSquintRight: 0.16,
    eyeSquintLeft: 0.10,
    eyeSquintRight: 0.10,
  },
  shy: {
    mouthSmileLeft: 0.26,
    mouthSmileRight: 0.26,
    browInnerUp: 0.18,
    cheekSquintLeft: 0.10,
    cheekSquintRight: 0.10,
  },
  surprised: {
    browInnerUp: 0.62,
    browOuterUpLeft: 0.52,
    browOuterUpRight: 0.52,
    eyeWideLeft: 0.50,
    eyeWideRight: 0.50,
    jawOpen: 0.16,
  },
  sad: {
    browInnerUp: 0.48,
    mouthFrownLeft: 0.42,
    mouthFrownRight: 0.42,
    eyeSquintLeft: 0.08,
    eyeSquintRight: 0.08,
  },
  angry: {
    browDownLeft: 0.58,
    browDownRight: 0.58,
    noseSneerLeft: 0.28,
    noseSneerRight: 0.28,
    mouthFrownLeft: 0.28,
    mouthFrownRight: 0.28,
  },
};

export function mapEmotionToArkit(emotion: string): Record<string, number> {
  const key = (emotion || "neutral").trim().toLowerCase();
  return EMOTION_PRESETS[key] ?? EMOTION_PRESETS.neutral;
}

const ALL_MANAGED_BLENDSHAPES = Array.from(
  new Set([
    ...Object.keys(mapVowelsToArkit(ZERO_VOWELS)),
    ...Object.values(EMOTION_PRESETS).flatMap((preset) => Object.keys(preset)),
    "eyeBlinkLeft",
    "eyeBlinkRight",
    "eyeLookInLeft",
    "eyeLookOutLeft",
    "eyeLookInRight",
    "eyeLookOutRight",
    "eyeLookUpLeft",
    "eyeLookUpRight",
    "eyeLookDownLeft",
    "eyeLookDownRight",
  ]),
);

const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

interface MorphTargetMesh {
  mesh: THREE.Mesh;
  dictionary: Record<string, number>;
  influences: number[];
}

/**
 * Live Three.js animation & ARKit blendshape controller for standard humanoid
 * GLB avatars (Avatar SDK MetaPerson, Avaturn, Mixamo-rigged GLTF/GLB).
 */
export class GlbAvatarController {
  private root: THREE.Object3D;
  private morphMeshes: MorphTargetMesh[] = [];
  private bones = new Map<string, THREE.Object3D>();
  private restQuaternions = new Map<string, THREE.Quaternion>();
  private needsArmDrop = false;

  private currentEmotion = "neutral";
  private targetVowels: LipSyncVowels = { ...ZERO_VOWELS };
  private smoothVowels: LipSyncVowels = { ...ZERO_VOWELS };
  private currentWeights: Record<string, number> = {};

  private elapsed = 0;
  private blinkTimer = 2.6;
  private blinkProgress = -1; // -1 = not blinking, 0..1 = active blink
  private readonly blinkDuration = 0.17;

  private gazeTimer = 2.0;
  private gazeTargetX = 0;
  private gazeTargetY = 0;
  private gazeX = 0;
  private gazeY = 0;

  // Reusable scratch quaternions/vectors to avoid per-frame allocations
  private readonly qTmp1 = new THREE.Quaternion();
  private readonly qTmp2 = new THREE.Quaternion();
  private readonly qTmp3 = new THREE.Quaternion();

  constructor(root: THREE.Object3D) {
    this.root = root;
    this.indexScene();
    this.detectArmPose();
    for (const name of ALL_MANAGED_BLENDSHAPES) {
      this.currentWeights[name] = 0;
    }
    this.applyPose(0, 0);
  }

  private indexScene(): void {
    this.root.updateMatrixWorld(true);
    this.root.traverse((obj) => {
      obj.frustumCulled = false;

      if ((obj as THREE.Bone).isBone || this.isKnownBoneName(obj.name)) {
        if (!this.bones.has(obj.name)) {
          this.bones.set(obj.name, obj);
          this.restQuaternions.set(obj.name, obj.quaternion.clone());
        }
      }

      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        if (mesh.morphTargetDictionary && mesh.morphTargetInfluences) {
          this.morphMeshes.push({
            mesh,
            dictionary: mesh.morphTargetDictionary,
            influences: mesh.morphTargetInfluences,
          });
        }

        // Improve hair/eyelash double-sided rendering on standard PBR materials
        const materials = Array.isArray(mesh.material)
          ? mesh.material
          : mesh.material
            ? [mesh.material]
            : [];
        for (const mat of materials) {
          const nameLower = (mat.name || obj.name || "").toLowerCase();
          if (
            nameLower.includes("hair") ||
            nameLower.includes("lash") ||
            nameLower.includes("hijab")
          ) {
            mat.side = THREE.DoubleSide;
          }
        }
      }
    });
  }

  private isKnownBoneName(name: string): boolean {
    if (!name) return false;
    const stripped = name.replace(/^mixamorig:?/i, "");
    return /^(Hips|Spine1?|Spine2|Neck1?|Neck2|Head|LeftEye|RightEye|LeftShoulder|RightShoulder|LeftArm|RightArm|LeftForeArm|RightForeArm|LeftHand|RightHand)/.test(
      stripped,
    );
  }

  private findBone(canonicalName: string): THREE.Object3D | undefined {
    return (
      this.bones.get(canonicalName) ||
      this.bones.get(`mixamorig${canonicalName}`) ||
      this.bones.get(`mixamorig:${canonicalName}`)
    );
  }

  private getRestQuaternion(bone: THREE.Object3D): THREE.Quaternion | undefined {
    return this.restQuaternions.get(bone.name);
  }

  private detectArmPose(): void {
    const leftArm = this.findBone("LeftArm");
    const leftForeArm = this.findBone("LeftForeArm");
    if (!leftArm || !leftForeArm) {
      this.needsArmDrop = false;
      return;
    }
    const armPos = leftArm.getWorldPosition(new THREE.Vector3());
    const forePos = leftForeArm.getWorldPosition(new THREE.Vector3());
    // In T-pose or high A-pose, the elbow is nearly level with the shoulder
    this.needsArmDrop = forePos.y - armPos.y > -0.15;
  }

  public getMorphTargetNames(): string[] {
    const names = new Set<string>();
    for (const entry of this.morphMeshes) {
      for (const k of Object.keys(entry.dictionary)) {
        names.add(k);
      }
    }
    return Array.from(names);
  }

  public getHeadWorldPosition(target = new THREE.Vector3()): THREE.Vector3 | null {
    const head = this.findBone("Head");
    if (head) {
      this.root.updateMatrixWorld(true);
      return head.getWorldPosition(target);
    }
    const box = new THREE.Box3().setFromObject(this.root);
    if (box.isEmpty()) return null;
    const size = box.getSize(new THREE.Vector3());
    return target.set(
      (box.min.x + box.max.x) * 0.5,
      box.min.y + size.y * 0.88,
      (box.min.z + box.max.z) * 0.5,
    );
  }

  public getChestWorldPosition(target = new THREE.Vector3()): THREE.Vector3 | null {
    const chest =
      this.findBone("Spine2") ||
      this.findBone("Spine1") ||
      this.findBone("Spine");
    if (chest) {
      this.root.updateMatrixWorld(true);
      return chest.getWorldPosition(target);
    }
    const head = this.getHeadWorldPosition(new THREE.Vector3());
    if (!head) return null;
    return target.set(head.x, head.y - 0.26, head.z);
  }

  public playEmotion(expression: string): void {
    this.currentEmotion = (expression || "neutral").trim().toLowerCase();
  }

  public lipSyncVowels(vowels: LipSyncVowels): void {
    this.targetVowels = {
      aa: clamp01(vowels.aa),
      ih: clamp01(vowels.ih),
      ou: clamp01(vowels.ou),
      ee: clamp01(vowels.ee),
      oh: clamp01(vowels.oh),
    };
  }

  public resetLipSync(): void {
    this.targetVowels = { ...ZERO_VOWELS };
  }

  public update(rawDelta: number): void {
    const delta = Math.min(Math.max(rawDelta, 0), 0.1);
    this.elapsed += delta;

    // 1. Smooth multi-vowel lip-sync amplitudes (fast open, smooth close)
    const keys: (keyof LipSyncVowels)[] = ["aa", "ih", "ou", "ee", "oh"];
    let speechEnergy = 0;
    for (const k of keys) {
      const lambda = this.targetVowels[k] > this.smoothVowels[k] ? 24 : 14;
      this.smoothVowels[k] = damp(this.smoothVowels[k], this.targetVowels[k], lambda, delta);
      if (this.smoothVowels[k] > speechEnergy) {
        speechEnergy = this.smoothVowels[k];
      }
    }

    // 2. Auto-blink state machine
    let blinkWeight = 0;
    if (this.blinkProgress >= 0) {
      this.blinkProgress += delta / this.blinkDuration;
      if (this.blinkProgress >= 1) {
        this.blinkProgress = -1;
        this.blinkTimer = 2.6 + Math.random() * 2.6;
        blinkWeight = 0;
      } else {
        blinkWeight = Math.sin(this.blinkProgress * Math.PI);
      }
    } else {
      this.blinkTimer -= delta;
      if (this.blinkTimer <= 0) {
        this.blinkProgress = 0;
      }
    }

    // 3. Subtle natural eye gaze drift (small range so Nara keeps audience eye contact)
    this.gazeTimer -= delta;
    if (this.gazeTimer <= 0) {
      this.gazeTimer = 2.2 + Math.random() * 2.8;
      this.gazeTargetX = (Math.random() - 0.5) * 0.16;
      this.gazeTargetY = (Math.random() - 0.5) * 0.08;
    }
    this.gazeX = damp(this.gazeX, this.gazeTargetX, 4.5, delta);
    this.gazeY = damp(this.gazeY, this.gazeTargetY, 4.5, delta);

    // 4. Combine emotion + lip-sync + blink + eye look weights
    const emotionWeights = mapEmotionToArkit(this.currentEmotion);
    const lipWeights = mapVowelsToArkit(this.smoothVowels);

    const targets: Record<string, number> = {};
    for (const name of ALL_MANAGED_BLENDSHAPES) {
      const eVal = emotionWeights[name] ?? 0;
      const lVal = lipWeights[name] ?? 0;
      // Blend emotion and lip-sync without double-stacking mouth corners
      targets[name] = clamp01(Math.max(eVal, lVal) + Math.min(eVal, lVal) * 0.25);
    }

    targets.eyeBlinkLeft = blinkWeight;
    targets.eyeBlinkRight = blinkWeight;

    // Subtle gaze blendshapes
    targets.eyeLookOutLeft = this.gazeX > 0 ? this.gazeX : 0;
    targets.eyeLookInRight = this.gazeX > 0 ? this.gazeX : 0;
    targets.eyeLookInLeft = this.gazeX < 0 ? -this.gazeX : 0;
    targets.eyeLookOutRight = this.gazeX < 0 ? -this.gazeX : 0;
    targets.eyeLookUpLeft = this.gazeY > 0 ? this.gazeY : 0;
    targets.eyeLookUpRight = this.gazeY > 0 ? this.gazeY : 0;
    targets.eyeLookDownLeft = this.gazeY < 0 ? -this.gazeY : 0;
    targets.eyeLookDownRight = this.gazeY < 0 ? -this.gazeY : 0;

    for (const name of ALL_MANAGED_BLENDSHAPES) {
      const isBlink = name === "eyeBlinkLeft" || name === "eyeBlinkRight";
      const isLip = name in lipWeights;
      const lambda = isBlink ? 45 : isLip ? 20 : 6;
      this.currentWeights[name] = damp(
        this.currentWeights[name] ?? 0,
        targets[name] ?? 0,
        lambda,
        delta,
      );
    }

    // Apply weights across every mesh (head, eyelashes, lower teeth)
    for (const entry of this.morphMeshes) {
      for (const name of ALL_MANAGED_BLENDSHAPES) {
        const idx = entry.dictionary[name];
        if (idx !== undefined) {
          entry.influences[idx] = this.currentWeights[name];
        }
      }
    }

    // 5. Apply relaxed MC standing pose + breathing + conversational head motion
    this.applyPose(this.elapsed, speechEnergy);
  }

  private applyBoneDelta(
    canonicalName: string,
    rx: number,
    ry: number,
    rz: number,
  ): void {
    const bone = this.findBone(canonicalName);
    if (!bone) return;
    const rest = this.getRestQuaternion(bone);
    if (!rest) return;

    this.qTmp1.setFromAxisAngle(X_AXIS, rx);
    this.qTmp2.setFromAxisAngle(Y_AXIS, ry);
    this.qTmp3.setFromAxisAngle(Z_AXIS, rz);

    bone.quaternion
      .copy(rest)
      .multiply(this.qTmp1)
      .multiply(this.qTmp2)
      .multiply(this.qTmp3);
  }

  private applyPose(t: number, speechEnergy: number): void {
    const breath = Math.sin(t * 1.55); // ~0.25 Hz calm breathing
    const sway = Math.sin(t * 0.62);
    const speakNod = speechEnergy * (Math.sin(t * 5.2) * 0.045 + 0.02);
    const speakTilt = speechEnergy * Math.sin(t * 2.7) * 0.03;

    // Gentle upright posture + breathing
    this.applyBoneDelta("Spine1", breath * 0.012, sway * 0.01, 0);
    this.applyBoneDelta("Spine2", breath * 0.015, sway * 0.012, sway * 0.008);

    // Expressive, natural head movement (idle sway + conversational nods)
    this.applyBoneDelta(
      "Neck",
      -0.01 + speakNod * 0.45 + Math.sin(t * 0.9) * 0.012,
      Math.sin(t * 0.45) * 0.025,
      Math.sin(t * 0.53) * 0.012 + speakTilt * 0.4,
    );
    this.applyBoneDelta(
      "Head",
      speakNod * 0.65 + Math.sin(t * 1.15) * 0.012,
      Math.sin(t * 0.55 + 0.8) * 0.03,
      Math.sin(t * 0.72) * 0.015 + speakTilt * 0.6,
    );

    if (this.needsArmDrop) {
      // Relaxed corporate MC arm posture (verified against Avatar SDK / Mixamo axes)
      const armBreath = breath * 0.015;
      const speakGesture = speechEnergy * Math.sin(t * 3.1) * 0.04;

      this.applyBoneDelta("LeftShoulder", 0.12 + armBreath, 0, 0);
      this.applyBoneDelta("RightShoulder", 0.12 + armBreath, 0, 0);

      this.applyBoneDelta("LeftArm", 1.22 - armBreath, 0, 0.08 + speakGesture * 0.5);
      this.applyBoneDelta("RightArm", 1.22 - armBreath, 0, -0.08 - speakGesture * 0.5);

      this.applyBoneDelta("LeftForeArm", 0, 0, 0.24 + speakGesture);
      this.applyBoneDelta("RightForeArm", 0, 0, -0.24 - speakGesture);
    }
  }
}
