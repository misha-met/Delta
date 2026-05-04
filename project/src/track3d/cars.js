import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

// Car dimensions (metres). Slightly larger than real F1 (~5×2) so the body
// reads at wider zooms, but still honest enough for the chase cam.
const CAR_LENGTH = 14.4;
const CAR_WIDTH = 5.8;
const CAR_HEIGHT = 1.1;
const WHEEL_RADIUS = 0.9;
const WHEEL_WIDTH = 0.84;
const CAR_SURFACE_CLEARANCE = 0.03;
// Fixed-size ground halo so distant cars still read as markers even when the
// body shrinks below a pixel. Does not scale with the car model.
const HALO_RADIUS = 6.5;
const TRACK3D_CAR_TUNE = Object.freeze({
  yawDeg: 90.000,
  scaleMultiplier: 2.510,
});

// ───────────────────────────────────────────────────────────────────────────
// Car marker — GLB-based F1 model with indicator overlays. Exposes `userData`
// hooks so the animate loop can toggle brake/DRS lights and halo state cheaply.
// Local coord frame: +X is forward, +Y up, +Z right (matched to GLB via
// rotation after cloning).
// ───────────────────────────────────────────────────────────────────────────

// Shared GLTF loader — one instance for the whole module.
const gltfLoader = new GLTFLoader();

// Singleton promise: loads the base GLB model once, then clones for each car.
// The model path is relative to the HTML page (served from dist/assets/).
const CAR_MODEL_PATH = "assets/f1-car.glb";
let _baseModelPromise = null;

// Per-team material cache: each team's coloured body material is built once
// and reused for every driver on that team. Two drivers per team × 10 teams
// → 10 materials total instead of 20 deep-cloned ones. Wheels share a single
// black material across all teams. Materials must remain unique per
// transparent state because we toggle opacity for PIT/DNS — but the bulk of
// the grid stays opaque, so the cache pays off.
const _teamBodyMatCache = new Map(); // key: team color hex string → material[]
const _wheelMatCache = { mat: null };
function getWheelMaterial(template) {
  if (_wheelMatCache.mat) return _wheelMatCache.mat;
  const m = template.clone();
  if (m.isMeshStandardMaterial || m.isMeshPhysicalMaterial) m.color.set(0x0a0a0a);
  _wheelMatCache.mat = m;
  return m;
}

function loadBaseCarModel() {
  if (_baseModelPromise) return _baseModelPromise;
  _baseModelPromise = new Promise((resolve, reject) => {
    gltfLoader.load(
      CAR_MODEL_PATH,
      (gltf) => {
        const model = gltf.scene;
        // Disable shadow casting on all meshes — at wide zoom levels the tiny
        // geometry aliasing in the directional shadow map produces long black
        // spike artifacts on the ground/runoff.
        model.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = false;
            child.receiveShadow = false;
          }
        });
        resolve(model);
      },
      undefined,
      (err) => {
        console.warn("GLB car model failed to load, will use fallback:", err);
        _baseModelPromise = null;
        reject(err);
      },
    );
  });
  return _baseModelPromise;
}

const SAFETY_CAR_MODEL_PATH = "assets/safety_car.glb";
let _safetyCarModelPromise = null;

function loadSafetyCarModel() {
  if (_safetyCarModelPromise) return _safetyCarModelPromise;
  _safetyCarModelPromise = new Promise((resolve, reject) => {
    gltfLoader.load(
      SAFETY_CAR_MODEL_PATH,
      (gltf) => {
        const model = gltf.scene;
        model.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = false;
            child.receiveShadow = false;
          }
        });
        resolve(model);
      },
      undefined,
      (err) => {
        console.warn("Safety car GLB failed to load, will use fallback:", err);
        _safetyCarModelPromise = null;
        reject(err);
      },
    );
  });
  return _safetyCarModelPromise;
}

// Build a fallback car from primitives (same as the old makeDriverMarker) if
// the GLB model fails to load.
function makeFallbackMarker(team) {
  const g = new THREE.Group();
  const color = new THREE.Color(team?.color || "#ff1e00");
  const bodyMat = new THREE.MeshStandardMaterial({
    color, roughness: 0.32, metalness: 0.45,
    emissive: color, emissiveIntensity: 0.06,
    envMapIntensity: 1.4,
  });
  const darkMat = new THREE.MeshStandardMaterial({
    color: 0x080810, roughness: 0.42, metalness: 0.35,
    envMapIntensity: 1.1,
  });
  const tyreMat = new THREE.MeshStandardMaterial({
    color: 0x101015, roughness: 0.92, metalness: 0.0,
    envMapIntensity: 0.4,
  });

  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(CAR_LENGTH, 0.3, CAR_WIDTH * 0.9), bodyMat);
  floor.position.y = 0.25; g.add(floor);
  const sidepods = new THREE.Mesh(
    new THREE.BoxGeometry(CAR_LENGTH * 0.55, 0.55, CAR_WIDTH * 0.85), bodyMat);
  sidepods.position.set(-CAR_LENGTH * 0.05, 0.55, 0); g.add(sidepods);
  const nose = new THREE.Mesh(
    new THREE.BoxGeometry(CAR_LENGTH * 0.45, 0.3, CAR_WIDTH * 0.3), bodyMat);
  nose.position.set(CAR_LENGTH * 0.38, 0.4, 0); g.add(nose);
  const airbox = new THREE.Mesh(
    new THREE.BoxGeometry(CAR_LENGTH * 0.2, 0.55, CAR_WIDTH * 0.3), bodyMat);
  airbox.position.set(-CAR_LENGTH * 0.1, 1.0, 0); g.add(airbox);
  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(0.35, 0.04, 6, 12, Math.PI), darkMat);
  halo.position.set(-CAR_LENGTH * 0.02, 0.95, 0);
  halo.rotation.x = Math.PI * 0.5; halo.rotation.y = Math.PI * 0.5; g.add(halo);
  const frontWing = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.08, CAR_WIDTH * 1.1), darkMat);
  frontWing.position.set(CAR_LENGTH * 0.55, 0.25, 0); g.add(frontWing);
  const rearWingFlap = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.14, CAR_WIDTH), darkMat);
  rearWingFlap.position.set(-CAR_LENGTH * 0.55, 1.0, 0); g.add(rearWingFlap);
  const rearEndplateL = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.9, 0.08), darkMat);
  rearEndplateL.position.set(-CAR_LENGTH * 0.55, 0.58, -CAR_WIDTH * 0.5); g.add(rearEndplateL);
  const rearEndplateR = rearEndplateL.clone();
  rearEndplateR.position.z = CAR_WIDTH * 0.5; g.add(rearEndplateR);

  const wheelPositions = [
    [CAR_LENGTH * 0.3, -CAR_WIDTH * 0.55], [CAR_LENGTH * 0.3, CAR_WIDTH * 0.55],
    [-CAR_LENGTH * 0.3, -CAR_WIDTH * 0.55], [-CAR_LENGTH * 0.3, CAR_WIDTH * 0.55],
  ];
  const wheelGeom = new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, WHEEL_WIDTH, 18);
  wheelGeom.rotateX(Math.PI / 2);
  const wheels = [];
  for (const [wx, wz] of wheelPositions) {
    const w = new THREE.Mesh(wheelGeom, tyreMat);
    w.position.set(wx, WHEEL_RADIUS, wz); g.add(w); wheels.push(w);
  }
  for (const m of [floor, sidepods, nose, airbox, halo, frontWing,
                   rearWingFlap, rearEndplateL, rearEndplateR, ...wheels]) {
    m.castShadow = false; m.receiveShadow = false;
  }
  g.userData = {
    body: [floor, sidepods, nose, airbox, rearWingFlap, rearEndplateL, rearEndplateR, frontWing],
    bodyMats: [bodyMat, darkMat],
    wheels,
    wheelMats: [tyreMat],
    baseColor: color.clone(),
  };
  return g;
}

// Soft round shadow under each car. Cheap fake of a contact shadow — sells
// "the car is touching the ground" without paying for a real shadow map. A
// single radial-gradient texture is built once and shared as a sprite-style
// PlaneGeometry under every car. Shared geometry + material → near-zero cost.
let _blobShadowTex = null;
let _blobShadowGeom = null;
let _blobShadowMat = null;
function getBlobShadowAssets() {
  if (!_blobShadowTex) {
    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0.0, "rgba(0,0,0,0.55)");
    grad.addColorStop(0.5, "rgba(0,0,0,0.28)");
    grad.addColorStop(1.0, "rgba(0,0,0,0.0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    _blobShadowTex = new THREE.CanvasTexture(canvas);
    _blobShadowTex.colorSpace = THREE.SRGBColorSpace;
  }
  if (!_blobShadowGeom) {
    // Slightly elongated along X (car forward) so the blob reads as a body
    // shadow rather than a perfect circle. Lifted just above the track top.
    _blobShadowGeom = new THREE.PlaneGeometry(CAR_LENGTH * 0.95, CAR_WIDTH * 1.6);
    _blobShadowGeom.rotateX(-Math.PI / 2);
  }
  if (!_blobShadowMat) {
    _blobShadowMat = new THREE.MeshBasicMaterial({
      map: _blobShadowTex,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      toneMapped: false,
    });
  }
  return { geom: _blobShadowGeom, mat: _blobShadowMat };
}

// Add indicator overlays (ground halo, brake/DRS lamps, compound dot) to a
// car group. These are functional indicators that sit on top of any car model.
function addIndicatorOverlays(g, color) {
  // Soft contact shadow blob — shared geometry + material across all cars.
  const blob = getBlobShadowAssets();
  const blobMesh = new THREE.Mesh(blob.geom, blob.mat);
  // Sit just above the track top (track top sits at the car group's local Y=0
  // by virtue of the surface offset applied in the animate loop). A small
  // positive Y prevents z-fighting with kerb/edge lines.
  blobMesh.position.y = 0.012;
  blobMesh.renderOrder = 2;
  g.add(blobMesh);
  g.userData.blobShadow = blobMesh;

  // DRS indicator — a thin strip on the top of the rear that lights up blue.
  const drsMat = new THREE.MeshBasicMaterial({
    color: 0x00d9ff, transparent: true, opacity: 0.0,
  });
  const drsLamp = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.08, CAR_WIDTH * 0.75), drsMat,
  );
  drsLamp.position.set(-CAR_LENGTH * 0.57, 1.12, 0);
  g.add(drsLamp);

  // Brake lights — twin red squares at the rear.
  const brakeMat = new THREE.MeshBasicMaterial({
    color: 0xff3040, transparent: true, opacity: 0.0,
  });
  const brakeGeom = new THREE.BoxGeometry(0.1, 0.1, 0.15);
  const brakeL = new THREE.Mesh(brakeGeom, brakeMat);
  brakeL.position.set(-CAR_LENGTH * 0.52, 0.35, -CAR_WIDTH * 0.2);
  g.add(brakeL);
  const brakeR = brakeL.clone();
  brakeR.position.z = CAR_WIDTH * 0.2;
  g.add(brakeR);

  // Ground halo — always-visible marker, decoupled from car dimensions.
  const haloGeom = new THREE.RingGeometry(HALO_RADIUS * 0.75, HALO_RADIUS, 36);
  haloGeom.rotateX(-Math.PI / 2);
  const haloMat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.38, depthWrite: false,
  });
  const groundHalo = new THREE.Mesh(haloGeom, haloMat);
  groundHalo.position.y = 0.02;
  g.add(groundHalo);

  // Tyre compound indicator — a small coloured dot floating above the car.
  const compGeom = new THREE.SphereGeometry(0.32, 10, 8);
  const compMat = new THREE.MeshBasicMaterial({ color: 0xffd93a });
  const compound = new THREE.Mesh(compGeom, compMat);
  compound.position.set(-CAR_LENGTH * 0.05, 1.9, 0);
  g.add(compound);

  g.userData.drsLamp = drsLamp;
  g.userData.drsMat = drsMat;
  g.userData.brakeL = brakeL;
  g.userData.brakeR = brakeR;
  g.userData.brakeMat = brakeMat;
  g.userData.groundHalo = groundHalo;
  g.userData.compound = compound;
}

function computeLocalBounds(root, targets = null) {
  if (!root) return null;
  root.updateMatrixWorld(true);
  const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const out = new THREE.Box3();
  const meshBox = new THREE.Box3();
  const rel = new THREE.Matrix4();
  let hasBounds = false;
  const includeMesh = (obj) => {
    if (!obj?.isMesh || !obj.geometry) return;
    if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox();
    if (!obj.geometry.boundingBox) return;
    meshBox.copy(obj.geometry.boundingBox);
    rel.multiplyMatrices(rootInv, obj.matrixWorld);
    meshBox.applyMatrix4(rel);
    if (!hasBounds) {
      out.copy(meshBox);
      hasBounds = true;
    } else {
      out.union(meshBox);
    }
  };
  if (Array.isArray(targets) && targets.length > 0) {
    for (const t of targets) {
      if (!t) continue;
      t.traverse(includeMesh);
    }
  } else {
    root.traverse(includeMesh);
  }
  return hasBounds ? out : null;
}

function applyDriverModelTune(modelRoot, wheels, fitScale) {
  if (!modelRoot || !Number.isFinite(fitScale)) return;
  const tune = TRACK3D_CAR_TUNE;
  modelRoot.position.set(0, 0, 0);
  modelRoot.rotation.set(0, THREE.MathUtils.degToRad(tune.yawDeg), 0);
  modelRoot.scale.setScalar(fitScale * tune.scaleMultiplier);
  const bbox = computeLocalBounds(modelRoot);
  if (!bbox) return;
  const bboxSize = bbox.getSize(new THREE.Vector3());
  const center = bbox.getCenter(new THREE.Vector3());
  modelRoot.position.x -= center.x;
  modelRoot.position.z -= center.z;
  const wheelBounds = (Array.isArray(wheels) && wheels.length > 0)
    ? computeLocalBounds(modelRoot, wheels)
    : null;
  // Guard against bad wheel classification: if the inferred wheel plane is
  // too far above the model's true lower bound, use the full-model bound so
  // scaling never sinks the car below the track.
  let contactY = bbox.min.y;
  if (wheelBounds) {
    const wheelContactY = wheelBounds.min.y;
    const safeDelta = Math.max(0.25, bboxSize.y * 0.3);
    if (wheelContactY - bbox.min.y <= safeDelta) {
      contactY = wheelContactY;
    }
  }
  modelRoot.position.y -= contactY;
  modelRoot.updateMatrixWorld(true);
}

// Create a driver marker using the GLB model. Returns a group immediately
// with a placeholder; the GLB model is attached asynchronously once loaded.
// The userData contract is fully compatible with the animation loop.
function makeDriverMarker(team) {
  const g = new THREE.Group();
  const color = new THREE.Color(team?.color || "#ff1e00");
  g.userData = { baseColor: color.clone(), body: [], bodyMats: [], wheels: [], wheelMats: [] };

  // Add indicator overlays right away (they work independently of the car body).
  addIndicatorOverlays(g, color);

  // Kick off the async model load. Once resolved, clone the base model and
  // insert it into the group, wiring up the userData hooks the animation loop
  // depends on.
  loadBaseCarModel().then((baseModel) => {
    const clone = baseModel.clone();
    // Geometry is shared across all cars (it's identical — only colour
    // differs). Object3D.clone() already shares the underlying BufferGeometry
    // by default; we deliberately do NOT call geometry.clone() here. The
    // module-level cleanup walks the scene graph and disposes geometry once,
    // so individual scene rebuilds don't poison the shared buffers.
    //
    // Materials are shared per team via _teamBodyMatCache: each team colour
    // owns one MeshStandardMaterial reused for every driver on that team,
    // plus one global wheel material. Cars that need transparency (PIT, DNS)
    // get a fresh per-car clone the first time that state is hit.
    const teamKey = `#${color.getHexString()}`;
    let cachedBodyMats = _teamBodyMatCache.get(teamKey);
    const matMap = new Map();
    clone.traverse((child) => {
      if (!child.isMesh) return;
      if (!child.material) return;
      const matName = (child.material.name || "").toLowerCase();
      // Wheel materials collapse to a shared dark wheel material. Includes
      // 'rims' (which previously slipped through and was team-tinted).
      const isWheelMat = matName === "tyres" || matName === "tyre" ||
        matName === "tires" || matName === "tire" || matName === "rims" ||
        matName === "rim" || matName === "wheels" || matName === "wheel";
      if (isWheelMat) {
        child.material = getWheelMaterial(child.material);
        return;
      }
      // Only the livery materials carry the team-coloured paint scheme. All
      // other materials (Steer dashboard texture, carbon fibre, chrome,
      // generic accents, mirrors, brakes, Black) keep their baked GLB look —
      // tinting them washes carbon/chrome with team colour, and multiplying
      // team colour by the baked livery map produces muddy blends (e.g.
      // McLaren orange × red livery → red+orange mix on screen).
      const isLivery = matName.startsWith("livery") || matName.startsWith("uv_map");
      if (!isLivery) return;
      // Body material: reuse the team-cached version if we have one.
      if (cachedBodyMats && cachedBodyMats.has(child.material.uuid)) {
        child.material = cachedBodyMats.get(child.material.uuid);
        return;
      }
      // Fresh team — clone, drop the baked livery map, paint a flat team
      // colour. This matches what IsoTrack shows and keeps team palettes
      // readable across all liveries.
      if (!matMap.has(child.material.uuid)) {
        const cloned = child.material.clone();
        if (cloned.isMeshStandardMaterial || cloned.isMeshPhysicalMaterial) {
          cloned.color.copy(color);
          cloned.map = null;
          cloned.emissiveMap = null;
          cloned.needsUpdate = true;
        }
        matMap.set(child.material.uuid, cloned);
      }
      child.material = matMap.get(child.material.uuid);
    });
    if (!cachedBodyMats && matMap.size > 0) {
      _teamBodyMatCache.set(teamKey, matMap);
      cachedBodyMats = matMap;
    }
    // Collect all meshes in the clone for the animation loop hooks.
    // Separate wheels from body parts so team colour is applied to the
    // body only, not the wheels. Use material name as the primary heuristic
    // (the GLB model names its wheel material "wheels"), falling back to
    // geometry aspect ratio for unnamed materials.
    const body = [];
    const bodyMats = [];
    const wheels = [];
    const wheelMats = [];
    // If all wheels share a single mesh, we can't spin them individually —
    // store a flag so the animation loop skips the spin on GLB models.
    let wheelsAreSeparateMeshes = true;
    // Steering wheel mesh — captured here so the live HUD can target it
    // without re-traversing the clone. Identified by node/material name
    // containing "steer". Must be excluded from the road-wheel list so the
    // animation loop doesn't spin it.
    let steeringWheelMesh = null;
    clone.traverse((child) => {
      if (!child.isMesh) return;
      const nodeName = (child.name || "").toLowerCase();
      const matName = (child.material?.name || "").toLowerCase();
      const isSteering = nodeName.includes("steer") || matName.includes("steer");
      if (isSteering) {
        if (!steeringWheelMesh) steeringWheelMesh = child;
        body.push(child);
        if (child.material && !bodyMats.includes(child.material)) {
          bodyMats.push(child.material);
        }
        return;
      }
      const isWheelByMat = matName.includes("wheel") || matName.includes("tire") || matName.includes("tyre");
      let isWheelByGeom = false;
      if (!isWheelByMat && child.geometry) {
        child.geometry.computeBoundingBox();
        const sz = child.geometry.boundingBox.getSize(new THREE.Vector3());
        const maxDim = Math.max(sz.x, sz.y, sz.z, 0.01);
        const minDim = Math.min(sz.x, sz.y, sz.z, 0.01);
        isWheelByGeom = (minDim / maxDim) > 0.45 && (maxDim / minDim) < 2.5;
      }
      if (isWheelByMat || isWheelByGeom) {
        wheels.push(child);
        if (child.material && !wheelMats.includes(child.material)) {
          wheelMats.push(child.material);
        }
        return;
      }
      body.push(child);
      if (child.material && !bodyMats.includes(child.material)) {
        bodyMats.push(child.material);
      }
    });
    // If fewer than 4 wheel meshes were found, the GLB likely merged some
    // wheels together — rotating those meshes would tumble the whole set
    // like a helicopter rather than spinning each wheel individually.
    if (wheels.length < 4) wheelsAreSeparateMeshes = false;
    // Body/wheel materials are already team-tinted / wheel-blackened by the
    // cache resolver above — no per-instance recolouring needed.
    // Scale the GLB model to match the scene's car dimensions. The model's
    // native size is unknown until loaded, so we normalise it to fit within
    // the CAR_LENGTH × CAR_WIDTH bounding box.
    const bbox = new THREE.Box3().setFromObject(clone);
    const size = bbox.getSize(new THREE.Vector3());
    const scaleX = CAR_LENGTH / Math.max(size.x, 0.01);
    const scaleZ = CAR_WIDTH / Math.max(size.z, 0.01);
    const fitScale = Math.min(scaleX, scaleZ);
    applyDriverModelTune(clone, wheels, fitScale);

    g.add(clone);
    g.userData.body = body;
    g.userData.bodyMats = bodyMats;
    g.userData.wheels = wheels;
    g.userData.wheelMats = wheelMats;
    g.userData.wheelsAreSeparateMeshes = wheelsAreSeparateMeshes;
    g.userData.modelRoot = clone;
    g.userData.modelFitScale = fitScale;
    g.userData.steeringWheel = steeringWheelMesh;
  }).catch(() => {
    // GLB failed — use the primitive fallback.
    const fallback = makeFallbackMarker(team);
    // Move fallback children into the main group (preserve existing indicators).
    while (fallback.children.length > 0) {
      const child = fallback.children[0];
      fallback.remove(child);
      g.add(child);
    }
    // Overwrite userData with fallback's full set.
    g.userData.body = fallback.userData.body;
    g.userData.bodyMats = fallback.userData.bodyMats;
    g.userData.wheels = fallback.userData.wheels;
    g.userData.wheelMats = fallback.userData.wheelMats || [];
    g.userData.wheelsAreSeparateMeshes = true;
  });

  return g;
}


// Safety car marker — yellow GLB model scaled to match F1 car dimensions.
// Uses same placement contract as driver markers (fraction → curve position).
function makeSafetyCarMarker() {
  const SC_COLOR = new THREE.Color(0xffcc00);
  const g = new THREE.Group();
  g.userData = { body: [], bodyMats: [], wheels: [], wheelsAreSeparateMeshes: false };

  // Ground halo in yellow so it's distinct from driver rings.
  const haloGeom = new THREE.RingGeometry(HALO_RADIUS * 0.75, HALO_RADIUS * 1.1, 36);
  haloGeom.rotateX(-Math.PI / 2);
  const haloMat = new THREE.MeshBasicMaterial({
    color: SC_COLOR, transparent: true, opacity: 0.55, depthWrite: false,
  });
  const groundHalo = new THREE.Mesh(haloGeom, haloMat);
  groundHalo.position.y = 0.02;
  g.add(groundHalo);
  g.userData.groundHalo = groundHalo;
  g.userData.haloMat = haloMat;

  loadSafetyCarModel().then((baseModel) => {
    const clone = baseModel.clone();
    // Clone geometry so disposing the active scene doesn't poison cached base.
    clone.traverse((child) => {
      if (child.isMesh && child.geometry) {
        child.geometry = child.geometry.clone();
      }
    });
    const matMap = new Map();
    clone.traverse((child) => {
      if (!child.isMesh) return;
      if (child.material && !matMap.has(child.material)) {
        matMap.set(child.material, child.material.clone());
      }
      child.material = matMap.get(child.material);
    });

    // Safety car (Mercedes AMG GT) is ~4.7 m long in real life — slightly
    // smaller than an F1 car. Use the same scene-unit scale as F1 cars but
    // target SC_LENGTH instead of CAR_LENGTH.
    const SC_LENGTH = CAR_LENGTH * 0.75;
    const SC_WIDTH  = CAR_WIDTH  * 0.75;
    const bbox = new THREE.Box3().setFromObject(clone);
    const size = bbox.getSize(new THREE.Vector3());
    // GLB forward is +Z, so fit against Z axis for length and X for width.
    const scaleZ = SC_LENGTH / Math.max(size.z, 0.01);
    const scaleX = SC_WIDTH  / Math.max(size.x, 0.01);
    clone.scale.setScalar(Math.min(scaleZ, scaleX));
    // Rotate +90° so GLB's +Z forward maps to scene's +X forward.
    clone.rotation.y = Math.PI / 2;

    clone.updateMatrixWorld(true);
    const bbox2 = new THREE.Box3().setFromObject(clone);
    const center = bbox2.getCenter(new THREE.Vector3());
    clone.position.x -= center.x;
    clone.position.z -= center.z;

    // Anchor lowest point to Y=0 (same as driver markers).
    clone.position.y -= bbox2.min.y;

    const body = [];
    const bodyMats = [];
    clone.traverse((child) => {
      if (!child.isMesh) return;
      body.push(child);
      if (child.material && !bodyMats.includes(child.material)) bodyMats.push(child.material);
    });

    g.add(clone);
    g.userData.body = body;
    g.userData.bodyMats = bodyMats;
  }).catch(() => {
    // Fallback: yellow box.
    const mat = new THREE.MeshStandardMaterial({ color: SC_COLOR, roughness: 0.4, metalness: 0.3 });
    const box = new THREE.Mesh(new THREE.BoxGeometry(CAR_LENGTH, 1.4, CAR_WIDTH * 0.8), mat);
    box.position.y = 0.7;
    g.add(box);
    g.userData.body = [box];
    g.userData.bodyMats = [mat];
  });

  return g;
}

export {
  CAR_LENGTH,
  CAR_WIDTH,
  CAR_HEIGHT,
  WHEEL_RADIUS,
  WHEEL_WIDTH,
  CAR_SURFACE_CLEARANCE,
  HALO_RADIUS,
  TRACK3D_CAR_TUNE,
  makeDriverMarker,
  makeSafetyCarMarker,
};
