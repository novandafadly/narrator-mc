import { describe, expect, test } from "@jest/globals";
import * as THREE from "three";
import {
  GlbAvatarController,
  mapEmotionToArkit,
  mapVowelsToArkit,
} from "../src/features/vrmViewer/glbAvatarController";

function buildMockGlbRig(tPose = true): {
  root: THREE.Group;
  headMesh: THREE.Mesh;
  teethMesh: THREE.Mesh;
  leftArm: THREE.Bone;
  leftForeArm: THREE.Bone;
} {
  const root = new THREE.Group();

  const hips = new THREE.Bone();
  hips.name = "Hips";
  hips.position.set(0, 0.94, 0);
  root.add(hips);

  const spine2 = new THREE.Bone();
  spine2.name = "Spine2";
  spine2.position.set(0, 0.33, 0);
  hips.add(spine2);

  const neck = new THREE.Bone();
  neck.name = "Neck";
  neck.position.set(0, 0.19, 0);
  spine2.add(neck);

  const head = new THREE.Bone();
  head.name = "Head";
  head.position.set(0, 0.1, 0);
  neck.add(head);

  const leftShoulder = new THREE.Bone();
  leftShoulder.name = "LeftShoulder";
  leftShoulder.position.set(0.06, 0.11, 0);
  spine2.add(leftShoulder);

  const leftArm = new THREE.Bone();
  leftArm.name = "LeftArm";
  leftArm.position.set(0.09, 0.03, 0);
  if (tPose) {
    // Match Avatar SDK MetaPerson local axes (+Y outward along arm, +Z downward)
    leftArm.quaternion.set(0.5, 0.5, -0.5, 0.5).normalize();
  }
  leftShoulder.add(leftArm);

  const leftForeArm = new THREE.Bone();
  leftForeArm.name = "LeftForeArm";
  leftForeArm.position.set(0, tPose ? 0.27 : -0.27, 0);
  leftArm.add(leftForeArm);

  const headMesh = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshStandardMaterial(),
  );
  headMesh.name = "AvatarHead";
  headMesh.morphTargetDictionary = {
    jawOpen: 0,
    mouthFunnel: 1,
    mouthPucker: 2,
    mouthSmileLeft: 3,
    mouthSmileRight: 4,
    eyeBlinkLeft: 5,
    eyeBlinkRight: 6,
    browInnerUp: 7,
  };
  headMesh.morphTargetInfluences = new Array(8).fill(0);
  root.add(headMesh);

  const teethMesh = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshStandardMaterial(),
  );
  teethMesh.name = "AvatarTeethLower";
  teethMesh.morphTargetDictionary = { jawOpen: 0 };
  teethMesh.morphTargetInfluences = [0];
  root.add(teethMesh);

  root.updateMatrixWorld(true);
  return { root, headMesh, teethMesh, leftArm, leftForeArm };
}

describe("GlbAvatarController", () => {
  test("mapVowelsToArkit maps open and rounded vowels cleanly", () => {
    const aa = mapVowelsToArkit({ aa: 1, ih: 0, ou: 0, ee: 0, oh: 0 });
    expect(aa.jawOpen).toBeGreaterThan(0.4);
    expect(aa.jawOpen).toBeLessThanOrEqual(0.78);
    expect(aa.mouthPucker).toBe(0);

    const ou = mapVowelsToArkit({ aa: 0, ih: 0, ou: 1, ee: 0, oh: 0 });
    expect(ou.mouthPucker).toBeGreaterThan(0.5);
    expect(ou.mouthFunnel).toBeGreaterThan(0.3);

    const ee = mapVowelsToArkit({ aa: 0, ih: 0, ou: 0, ee: 1, oh: 0 });
    expect(ee.mouthStretchLeft).toBeGreaterThan(0.4);
    expect(ee.mouthStretchRight).toBe(ee.mouthStretchLeft);
  });

  test("mapEmotionToArkit is case-insensitive and falls back to neutral", () => {
    const happy = mapEmotionToArkit("HAPPY");
    expect(happy.mouthSmileLeft).toBeGreaterThan(0.4);

    const surprised = mapEmotionToArkit("Surprised");
    expect(surprised.browInnerUp).toBeGreaterThan(0.5);

    const unknown = mapEmotionToArkit("unknown_emotion");
    expect(unknown).toEqual(mapEmotionToArkit("neutral"));
  });

  test("syncs ARKit jawOpen across head and lower teeth meshes and decays on reset", () => {
    const { root, headMesh, teethMesh } = buildMockGlbRig(true);
    const ctrl = new GlbAvatarController(root);

    ctrl.playEmotion("happy");
    ctrl.lipSyncVowels({ aa: 0.9, ih: 0, ou: 0, ee: 0, oh: 0.2 });

    for (let i = 0; i < 20; i++) {
      ctrl.update(0.05);
    }

    const headJaw = headMesh.morphTargetInfluences![0];
    const teethJaw = teethMesh.morphTargetInfluences![0];
    const smile = headMesh.morphTargetInfluences![3];

    expect(headJaw).toBeGreaterThan(0.35);
    expect(teethJaw).toBeCloseTo(headJaw, 5);
    expect(smile).toBeGreaterThan(0.4);

    ctrl.resetLipSync();
    for (let i = 0; i < 40; i++) {
      ctrl.update(0.05);
    }
    expect(headMesh.morphTargetInfluences![0]).toBeLessThan(0.02);
  });

  test("drops T-pose arms into relaxed posture and provides head/chest framing positions", () => {
    const { root, leftArm, leftForeArm } = buildMockGlbRig(true);
    const initialElbowY = leftForeArm.getWorldPosition(new THREE.Vector3()).y;

    const ctrl = new GlbAvatarController(root);
    ctrl.update(0.016);
    root.updateMatrixWorld(true);

    const relaxedElbowY = leftForeArm.getWorldPosition(new THREE.Vector3()).y;
    const shoulderY = leftArm.getWorldPosition(new THREE.Vector3()).y;
    expect(relaxedElbowY).toBeLessThan(initialElbowY - 0.15);
    expect(relaxedElbowY).toBeLessThan(shoulderY - 0.15);

    const headPos = ctrl.getHeadWorldPosition();
    const chestPos = ctrl.getChestWorldPosition();
    expect(headPos).not.toBeNull();
    expect(chestPos).not.toBeNull();
    expect(headPos!.y).toBeGreaterThan(chestPos!.y);
  });

  test("does not over-rotate arms that are already relaxed", () => {
    const { root, leftArm } = buildMockGlbRig(false);
    const restQuat = leftArm.quaternion.clone();

    const ctrl = new GlbAvatarController(root);
    ctrl.update(0.016);

    expect(leftArm.quaternion.angleTo(restQuat)).toBeLessThan(0.01);
  });
});
