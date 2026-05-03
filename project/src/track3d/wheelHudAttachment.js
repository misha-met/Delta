import * as THREE from "three";

const WHEEL_HUD_ATTACHMENT = Object.freeze({
  faceSign: 1,
  flipU: true,
  flipV: true,
  shiftFaceX: 0.0,
  shiftFaceY: 0.225,
  sizeFaceX: 0.31,
  sizeFaceY: 0.33,
  sizeMultiplier: 1.0,
  emissiveIntensity: 0.75,
});

// Handles attaching the shared wheel-HUD quad to whichever driver's steering
// wheel is currently pinned.
export function createWheelHudAttachment({ wheelHud, wheelHudQuad, getDriverEntry }) {
  const state = { code: null, parent: null };

  const detach = () => {
    if (state.parent) {
      state.parent.remove(wheelHudQuad);
    }
    state.parent = null;
    state.code = null;
  };

  const attach = (code, entry) => {
    const wheelMesh = entry?.group?.userData?.steeringWheel;
    if (!wheelMesh || !wheelMesh.geometry) return false;

    const tex = wheelHud.texture;
    if (WHEEL_HUD_ATTACHMENT.flipU) { tex.repeat.x = -1; tex.offset.x = 1; }
    else                            { tex.repeat.x =  1; tex.offset.x = 0; }
    if (WHEEL_HUD_ATTACHMENT.flipV) { tex.repeat.y = -1; tex.offset.y = 1; }
    else                            { tex.repeat.y =  1; tex.offset.y = 0; }
    tex.needsUpdate = true;
    wheelHud.material.emissiveIntensity = WHEEL_HUD_ATTACHMENT.emissiveIntensity;

    if (!wheelMesh.geometry.boundingBox) wheelMesh.geometry.computeBoundingBox();
    const bb = wheelMesh.geometry.boundingBox;
    if (!bb) return false;

    const sz = new THREE.Vector3();
    bb.getSize(sz);
    const ctr = new THREE.Vector3();
    bb.getCenter(ctr);

    const dims = [sz.x, sz.y, sz.z];
    let normalAxis = 0;
    if (dims[1] < dims[normalAxis]) normalAxis = 1;
    if (dims[2] < dims[normalAxis]) normalAxis = 2;
    const faceAxes = [0, 1, 2].filter((axis) => axis !== normalAxis);

    const screenW = dims[faceAxes[0]] * WHEEL_HUD_ATTACHMENT.sizeFaceX;
    const screenH = dims[faceAxes[1]] * WHEEL_HUD_ATTACHMENT.sizeFaceY;

    wheelHudQuad.position.set(ctr.x, ctr.y, ctr.z);
    const offset = dims[normalAxis] * 0.55;
    const offsetSign = WHEEL_HUD_ATTACHMENT.faceSign;
    if (normalAxis === 0) {
      wheelHudQuad.position.x += offsetSign * offset;
      wheelHudQuad.rotation.set(0, offsetSign * Math.PI / 2, 0);
    } else if (normalAxis === 1) {
      wheelHudQuad.position.y += offsetSign * offset;
      wheelHudQuad.rotation.set(offsetSign * -Math.PI / 2, 0, 0);
    } else {
      wheelHudQuad.position.z += offsetSign * offset;
      wheelHudQuad.rotation.set(0, offsetSign > 0 ? 0 : Math.PI, 0);
    }
    wheelHudQuad.scale.set(screenW, screenH, 1);

    const tx = WHEEL_HUD_ATTACHMENT.shiftFaceX * dims[faceAxes[0]];
    const ty = WHEEL_HUD_ATTACHMENT.shiftFaceY * dims[faceAxes[1]];
    const shift = new THREE.Vector3();
    shift.setComponent(faceAxes[0], tx);
    shift.setComponent(faceAxes[1], ty);
    wheelHudQuad.position.add(shift);
    wheelHudQuad.scale.multiplyScalar(WHEEL_HUD_ATTACHMENT.sizeMultiplier);

    if (state.parent && state.parent !== wheelMesh) {
      state.parent.remove(wheelHudQuad);
    }
    wheelMesh.add(wheelHudQuad);
    state.parent = wheelMesh;
    state.code = code;
    return true;
  };

  return { state, attach, detach };
}
