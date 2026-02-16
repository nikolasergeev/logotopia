// ─── Scene Setup ─────────────────────────────────────────────
const scene = new THREE.Scene();
// Late summer Scandinavian sky - pale blue with warmth
scene.background = new THREE.Color(0x8ec8e8);
scene.fog = new THREE.FogExp2(0x8ec8e8, 0.00018);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 1, 20000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = false;
document.body.appendChild(renderer.domElement);

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ─── Lighting ────────────────────────────────────────────────
// Midsummer golden light
const ambientLight = new THREE.AmbientLight(0xaaccdd, 0.7);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xfff5d0, 1.3);
sunLight.position.set(500, 800, 300);
sunLight.castShadow = true;
sunLight.shadow.mapSize.width = 512;
sunLight.shadow.mapSize.height = 512;
sunLight.shadow.camera.near = 10;
sunLight.shadow.camera.far = 1500;
sunLight.shadow.camera.left = -200;
sunLight.shadow.camera.right = 200;
sunLight.shadow.camera.top = 200;
sunLight.shadow.camera.bottom = -200;
scene.add(sunLight);

// Sky blue above, mossy forest floor below
const hemiLight = new THREE.HemisphereLight(0x99ccee, 0x3a5522, 0.5);
scene.add(hemiLight);

// ─── Terrain ─────────────────────────────────────────────────
const TERRAIN_SIZE = 8000;
const TERRAIN_SEGMENTS = 128;
const TERRAIN_HEIGHT = 300;

function generateTerrain() {
  const geometry = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS);
  const vertices = geometry.attributes.position.array;

  // Simple layered noise
  for (let i = 0; i < vertices.length; i += 3) {
    const x = vertices[i];
    const y = vertices[i + 1];
    let h = 0;
    h += Math.sin(x * 0.002) * Math.cos(y * 0.002) * 120;
    h += Math.sin(x * 0.005 + 1) * Math.cos(y * 0.004 + 2) * 60;
    h += Math.sin(x * 0.01 + 3) * Math.cos(y * 0.012 + 1) * 30;
    h += Math.sin(x * 0.025) * Math.cos(y * 0.02) * 15;
    vertices[i + 2] = h;
  }

  // Flatten terrain around airport area (world 300, -350 → vertex 300, 350)
  const apX = 300, apY = 350, apInner = 120, apOuter = 250;
  // Sample the center height to use as the flat level
  let apCenterH = 0;
  apCenterH += Math.sin(apX * 0.002) * Math.cos(apY * 0.002) * 120;
  apCenterH += Math.sin(apX * 0.005 + 1) * Math.cos(apY * 0.004 + 2) * 60;
  apCenterH += Math.sin(apX * 0.01 + 3) * Math.cos(apY * 0.012 + 1) * 30;
  apCenterH += Math.sin(apX * 0.025) * Math.cos(apY * 0.02) * 15;
  for (let i = 0; i < vertices.length; i += 3) {
    const dx = vertices[i] - apX;
    const dy = vertices[i + 1] - apY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < apInner) {
      vertices[i + 2] = apCenterH;
    } else if (dist < apOuter) {
      const blend = (dist - apInner) / (apOuter - apInner);
      const smooth = blend * blend * (3 - 2 * blend); // smoothstep
      vertices[i + 2] = apCenterH * (1 - smooth) + vertices[i + 2] * smooth;
    }
  }

  geometry.computeVertexNormals();

  // Color terrain by height
  const count = geometry.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const h = vertices[i * 3 + 2];
    const t = (h + TERRAIN_HEIGHT) / (TERRAIN_HEIGHT * 2);
    let r, g, b;
    if (t < 0.3) {
      // Deep Nordic lake blue
      r = 0.08; g = 0.25; b = 0.45;
    } else if (t < 0.38) {
      // Rocky shoreline / gravel
      r = 0.55; g = 0.52; b = 0.48;
    } else if (t < 0.55) {
      // Swedish meadow - vivid green
      const gt = (t - 0.38) / 0.17;
      r = 0.15 + gt * 0.08; g = 0.55 + gt * 0.15; b = 0.12;
    } else if (t < 0.7) {
      // Boreal pine forest - deep evergreen
      const gt = (t - 0.55) / 0.15;
      r = 0.08 + gt * 0.05; g = 0.3 + gt * 0.1; b = 0.1 + gt * 0.05;
    } else if (t < 0.85) {
      // Swedish granite / fjäll rock
      const gt = (t - 0.7) / 0.15;
      r = 0.45 + gt * 0.1; g = 0.43 + gt * 0.08; b = 0.42 + gt * 0.08;
    } else {
      // Snow on mountain tops
      const st = (t - 0.85) / 0.15;
      r = 0.8 + st * 0.2; g = 0.82 + st * 0.18; b = 0.85 + st * 0.15;
    }
    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const material = new THREE.MeshLambertMaterial({
    vertexColors: true,
    flatShading: true,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

const terrain = generateTerrain();

// ─── Raycast Ground Height (exact mesh surface) ─────────────
const groundRaycaster = new THREE.Raycaster();
const groundRayDown = new THREE.Vector3(0, -1, 0);
const groundRayOrigin = new THREE.Vector3();

function getExactGroundHeight(x, z) {
  groundRayOrigin.set(x, 1000, z);
  groundRaycaster.set(groundRayOrigin, groundRayDown);
  const hits = groundRaycaster.intersectObject(terrain);
  if (hits.length > 0) return Math.max(hits[0].point.y, -40);
  return Math.max(getTerrainHeight(x, z), -40);
}

// ─── Water Plane with Surfable Waves ─────────────────────────
const WATER_SEGS = 200;
const waterGeo = new THREE.PlaneGeometry(TERRAIN_SIZE * 3, TERRAIN_SIZE * 3, WATER_SEGS, WATER_SEGS);
// Store original vertex positions for wave animation
const waterBasePositions = new Float32Array(waterGeo.attributes.position.array);
// Deep Nordic lake
const waterMat = new THREE.MeshPhongMaterial({
  color: 0x1a5a7e,
  specular: 0x88bbdd,
  shininess: 60,
  transparent: true,
  opacity: 0.75,
  flatShading: true,
});
const water = new THREE.Mesh(waterGeo, waterMat);
water.rotation.x = -Math.PI / 2;
water.position.y = -40;
scene.add(water);

// Wave parameters
const waves = [
  { dirX: 1.0, dirY: 0.3,  amp: 3.5, freq: 0.008, speed: 1.2,  phase: 0 },     // primary swell
  { dirX: 0.7, dirY: 0.7,  amp: 2.0, freq: 0.012, speed: 1.8,  phase: 2.0 },   // cross-wave
  { dirX: 0.2, dirY: 1.0,  amp: 1.5, freq: 0.02,  speed: 2.5,  phase: 4.5 },   // ripple
  { dirX: -0.4, dirY: 0.9, amp: 1.0, freq: 0.035, speed: 3.0,  phase: 1.3 },   // chop
];

function getWaveHeight(x, z, time) {
  let h = 0;
  for (const w of waves) {
    const dot = x * w.dirX + z * w.dirY;
    h += w.amp * Math.sin(dot * w.freq + time * w.speed + w.phase);
  }
  return h;
}

function animateWaves(time) {
  const positions = waterGeo.attributes.position.array;
  for (let i = 0; i < positions.length; i += 3) {
    const bx = waterBasePositions[i];
    const by = waterBasePositions[i + 1];
    positions[i + 2] = getWaveHeight(bx, by, time);
  }
  waterGeo.attributes.position.needsUpdate = true;
  waterGeo.computeVertexNormals();
}

// ─── Sun Orb (visible golden sun in the sky) ────────────────
const sunGeo = new THREE.SphereGeometry(120, 16, 12);
const sunMat = new THREE.MeshBasicMaterial({ color: 0xffee55 });
const sunOrb = new THREE.Mesh(sunGeo, sunMat);
// Glow ring around the sun
const glowGeo = new THREE.RingGeometry(120, 220, 32);
const glowMat = new THREE.MeshBasicMaterial({ color: 0xffdd44, transparent: true, opacity: 0.25, side: THREE.DoubleSide });
const sunGlow = new THREE.Mesh(glowGeo, glowMat);
sunOrb.add(sunGlow);
scene.add(sunOrb);

// ─── Aurora Borealis (Norrsken) ──────────────────────────────
const auroraGroup = new THREE.Group();
const auroraCols = [0x22ff88, 0x44ffaa, 0x22ddaa, 0x33ff66, 0x55eebb, 0x22ccff];
for (let i = 0; i < 12; i++) {
  const w = 600 + Math.random() * 800;
  const h = 150 + Math.random() * 250;
  const geo = new THREE.PlaneGeometry(w, h, 8, 4);
  // Wavy distortion
  const verts = geo.attributes.position.array;
  for (let v = 0; v < verts.length; v += 3) {
    verts[v] += Math.sin(verts[v + 1] * 0.02) * 50;
    verts[v + 1] += Math.sin(verts[v] * 0.01) * 30;
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshBasicMaterial({
    color: auroraCols[i % auroraCols.length],
    transparent: true,
    opacity: 0.08 + Math.random() * 0.07,
    side: THREE.DoubleSide,
  });
  const curtain = new THREE.Mesh(geo, mat);
  curtain.position.set(
    (Math.random() - 0.5) * 6000,
    800 + Math.random() * 400,
    -2000 - Math.random() * 3000
  );
  curtain.rotation.y = Math.random() * 0.5 - 0.25;
  auroraGroup.add(curtain);
}
scene.add(auroraGroup);

// ─── Swedish Wildflowers (blue & yellow) ─────────────────────
const flowerGroup = new THREE.Group();
const stemMat = new THREE.MeshLambertMaterial({ color: 0x2d7a1e });
// Blåklocka (blue harebell) and Smörblomma (yellow buttercup) - Swedish flag colors
const sweFlowerColors = [0x3366cc, 0x4477dd, 0xffcc00, 0xffdd33, 0xffffff, 0x3355bb];
for (let i = 0; i < 600; i++) {
  const fx = (Math.random() - 0.5) * TERRAIN_SIZE * 0.8;
  const fz = (Math.random() - 0.5) * TERRAIN_SIZE * 0.8;
  const fy = getTerrainHeight(fx, fz);
  if (fy < -10 || fy > 100) continue;

  const color = sweFlowerColors[Math.floor(Math.random() * sweFlowerColors.length)];
  const stemH = 3 + Math.random() * 3;
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, stemH, 3), stemMat);
  stem.position.set(fx, fy + stemH / 2, fz);
  flowerGroup.add(stem);

  const petalMat = new THREE.MeshLambertMaterial({ color });
  for (let p = 0; p < 5; p++) {
    const angle = (p / 5) * Math.PI * 2;
    const petal = new THREE.Mesh(new THREE.SphereGeometry(0.9 + Math.random() * 0.4, 5, 4), petalMat);
    petal.position.set(fx + Math.cos(angle) * 0.9, fy + stemH + 0.3, fz + Math.sin(angle) * 0.9);
    petal.scale.set(1, 0.4, 1);
    flowerGroup.add(petal);
  }
  const center = new THREE.Mesh(
    new THREE.SphereGeometry(0.6, 5, 4),
    new THREE.MeshLambertMaterial({ color: 0xffee44 })
  );
  center.position.set(fx, fy + stemH + 0.3, fz);
  flowerGroup.add(center);
}
scene.add(flowerGroup);

// ─── Midsommarstång (Midsummer Maypole) ─────────────────────
function createMaypole(px, pz) {
  const group = new THREE.Group();
  const woodMat = new THREE.MeshPhongMaterial({ color: 0x8B6914, flatShading: true });
  const greenMat = new THREE.MeshLambertMaterial({ color: 0x228822 });
  const blueMat = new THREE.MeshLambertMaterial({ color: 0x005293 });
  const yellowMat = new THREE.MeshLambertMaterial({ color: 0xfecc02 });

  // Main pole
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 2, 80, 8), woodMat);
  pole.position.y = 40;
  group.add(pole);

  // Leaf garlands wrapped around pole
  for (let i = 0; i < 20; i++) {
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(2, 5, 4), greenMat);
    const angle = i * 0.8;
    leaf.position.set(Math.cos(angle) * 3, 10 + i * 3.5, Math.sin(angle) * 3);
    group.add(leaf);
  }

  // Cross bar at top
  const crossBar = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 40, 6), woodMat);
  crossBar.rotation.z = Math.PI / 2;
  crossBar.position.y = 78;
  group.add(crossBar);

  // Two hanging rings (traditional)
  for (const side of [-1, 1]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(8, 1, 8, 16), greenMat);
    ring.position.set(side * 18, 68, 0);
    group.add(ring);

    // Garland on rings
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const g = new THREE.Mesh(new THREE.SphereGeometry(1.5, 4, 3), greenMat);
      g.position.set(side * 18 + Math.cos(a) * 8, 68 + Math.sin(a) * 8, 0);
      group.add(g);
    }
  }

  // Swedish flag ribbons hanging from crossbar
  for (let i = 0; i < 8; i++) {
    const ribbonMat = i % 2 === 0 ? blueMat : yellowMat;
    const ribbon = new THREE.Mesh(new THREE.BoxGeometry(0.5, 15 + Math.random() * 10, 1.5), ribbonMat);
    ribbon.position.set(-16 + i * 4.5, 68, 0);
    group.add(ribbon);
  }

  // Crown at the very top
  const crown = new THREE.Mesh(new THREE.TorusGeometry(4, 1.5, 6, 12), greenMat);
  crown.position.y = 82;
  crown.rotation.x = Math.PI / 2;
  group.add(crown);

  // Yellow flowers on crown
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const f = new THREE.Mesh(new THREE.SphereGeometry(1.2, 5, 4), yellowMat);
    f.position.set(Math.cos(a) * 4, 82, Math.sin(a) * 4);
    group.add(f);
  }

  const py = getTerrainHeight(px, pz);
  group.position.set(px, py, pz);
  scene.add(group);
  return group;
}

// Place maypoles on meadows
createMaypole(500, -500);
createMaypole(-1500, 1000);
createMaypole(2000, 2000);

const maypolePositions = [
  new THREE.Vector3(500, getTerrainHeight(500, -500), -500),
  new THREE.Vector3(-1500, getTerrainHeight(-1500, 1000), 1000),
  new THREE.Vector3(2000, getTerrainHeight(2000, 2000), 2000),
];

// ─── Airplane Model ──────────────────────────────────────────
function createAirplane() {
  const group = new THREE.Group();

  // Swedish Air Force colors
  const sweBlue = new THREE.MeshPhongMaterial({ color: 0x005293, flatShading: true });
  const sweYellow = new THREE.MeshPhongMaterial({ color: 0xfecc02, flatShading: true });

  // Fuselage - Swedish blue
  const bodyGeo = new THREE.CylinderGeometry(1.5, 1, 12, 8);
  const bodyMat = sweBlue;
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.rotation.z = Math.PI / 2;
  body.castShadow = true;
  group.add(body);

  // Nose cone - Swedish yellow
  const noseGeo = new THREE.ConeGeometry(1.5, 4, 8);
  const noseMat = sweYellow;
  const nose = new THREE.Mesh(noseGeo, noseMat);
  nose.rotation.z = -Math.PI / 2;
  nose.position.x = 8;
  nose.castShadow = true;
  group.add(nose);

  // Cockpit
  const cockpitGeo = new THREE.SphereGeometry(1.3, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2);
  const cockpitMat = new THREE.MeshPhongMaterial({ color: 0x3399ff, transparent: true, opacity: 0.6 });
  const cockpit = new THREE.Mesh(cockpitGeo, cockpitMat);
  cockpit.position.set(2, 1.2, 0);
  cockpit.rotation.x = 0;
  group.add(cockpit);

  // Main wings - blue with yellow stripe
  const wingGeo = new THREE.BoxGeometry(5, 0.3, 18);
  const wingMat = sweBlue;
  const wings = new THREE.Mesh(wingGeo, wingMat);
  wings.position.set(-1, 0, 0);
  wings.castShadow = true;
  group.add(wings);

  // Yellow wing stripes (Swedish cross pattern)
  const stripeGeo = new THREE.BoxGeometry(5.1, 0.35, 1.5);
  const stripeL = new THREE.Mesh(stripeGeo, sweYellow);
  stripeL.position.set(-1, 0.05, -5);
  group.add(stripeL);
  const stripeR = new THREE.Mesh(stripeGeo, sweYellow);
  stripeR.position.set(-1, 0.05, 5);
  group.add(stripeR);

  // Wing tips - yellow
  const tipGeo = new THREE.BoxGeometry(1, 0.4, 1.5);
  const tipL = new THREE.Mesh(tipGeo, sweYellow);
  tipL.position.set(-1, 0.1, -9.5);
  group.add(tipL);
  const tipR = new THREE.Mesh(tipGeo, sweYellow);
  tipR.position.set(-1, 0.1, 9.5);
  group.add(tipR);

  // Tail vertical stabilizer - yellow
  const tailVGeo = new THREE.BoxGeometry(3, 4, 0.3);
  const tailVMat = sweYellow;
  const tailV = new THREE.Mesh(tailVGeo, tailVMat);
  tailV.position.set(-7, 2.5, 0);
  tailV.castShadow = true;
  group.add(tailV);

  // Tail horizontal stabilizer - blue
  const tailHGeo = new THREE.BoxGeometry(2, 0.3, 7);
  const tailHMat = sweBlue;
  const tailH = new THREE.Mesh(tailHGeo, tailHMat);
  tailH.position.set(-7, 0.5, 0);
  group.add(tailH);

  // Engine nacelles
  const engGeo = new THREE.CylinderGeometry(0.6, 0.8, 3, 6);
  const engMat = new THREE.MeshPhongMaterial({ color: 0x666666 });
  const engL = new THREE.Mesh(engGeo, engMat);
  engL.rotation.z = Math.PI / 2;
  engL.position.set(1, -0.5, -4);
  group.add(engL);
  const engR = new THREE.Mesh(engGeo, engMat);
  engR.rotation.z = Math.PI / 2;
  engR.position.set(1, -0.5, 4);
  group.add(engR);

  // ── Swedish Pilot ──
  const pilotSkin = new THREE.MeshPhongMaterial({ color: 0xffddb0, flatShading: true }); // fair Scandinavian skin
  const pilotSuit = new THREE.MeshPhongMaterial({ color: 0x005293, flatShading: true }); // Swedish blue flight suit
  const pilotHelmet = new THREE.MeshPhongMaterial({ color: 0x333333, flatShading: true });
  const pilotVisor = new THREE.MeshPhongMaterial({ color: 0x88ccff, transparent: true, opacity: 0.7 });
  const pilotHairMat = new THREE.MeshPhongMaterial({ color: 0xe8c84a, flatShading: true }); // blond hair

  // Head
  const pilotHead = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), pilotSkin);
  pilotHead.position.set(2, 2.05, 0);
  group.add(pilotHead);

  // Helmet
  const helmet = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2),
    pilotHelmet
  );
  helmet.position.set(2, 2.15, 0);
  group.add(helmet);

  // Visor
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.35, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2), pilotVisor);
  visor.position.set(2.15, 2.0, 0);
  visor.rotation.z = -Math.PI / 2.5;
  group.add(visor);

  // Smile (always happy!)
  const smileMat = new THREE.MeshPhongMaterial({ color: 0xcc4444 });
  const smile = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.03, 4, 8, Math.PI), smileMat);
  smile.position.set(2.35, 1.9, 0);
  smile.rotation.y = Math.PI / 2;
  smile.rotation.x = Math.PI;
  group.add(smile);

  // Blue eyes (typical Swedish)
  const pilotEyeMat = new THREE.MeshPhongMaterial({ color: 0x3388cc });
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.07, 4, 4), pilotEyeMat);
  eyeL.position.set(2.38, 2.05, -0.15);
  group.add(eyeL);
  const eyeR = new THREE.Mesh(new THREE.SphereGeometry(0.07, 4, 4), pilotEyeMat);
  eyeR.position.set(2.38, 2.05, 0.15);
  group.add(eyeR);

  // Blond hair poking from under helmet
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const hair = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.35, 3), pilotHairMat);
    hair.position.set(1.7 + Math.cos(a) * 0.35, 2.0, Math.sin(a) * 0.4);
    hair.rotation.z = 0.5;
    hair.rotation.x = Math.sin(a) * 0.3;
    group.add(hair);
  }

  // Body (torso visible above cockpit rim)
  const pilotBody = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.35, 1.2, 6), pilotSuit);
  pilotBody.position.set(2, 1.0, 0);
  group.add(pilotBody);

  // Left arm (waves when happy)
  const pilotArmPivot = new THREE.Group();
  pilotArmPivot.position.set(2, 1.5, -0.5);
  const pilotArm = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.1, 0.8, 4), pilotSuit);
  pilotArm.position.y = 0.4;
  pilotArmPivot.add(pilotArm);
  // Hand
  const pilotHand = new THREE.Mesh(new THREE.SphereGeometry(0.12, 4, 4), pilotSkin);
  pilotHand.position.y = 0.8;
  pilotArmPivot.add(pilotHand);
  group.add(pilotArmPivot);

  // Machine gun barrels (under each wing)
  const gunGeo = new THREE.CylinderGeometry(0.2, 0.2, 4, 4);
  const gunMat = new THREE.MeshPhongMaterial({ color: 0x333333 });
  const gunL = new THREE.Mesh(gunGeo, gunMat);
  gunL.rotation.z = Math.PI / 2;
  gunL.position.set(3, -0.8, -4);
  group.add(gunL);
  const gunR = new THREE.Mesh(gunGeo, gunMat);
  gunR.rotation.z = Math.PI / 2;
  gunR.position.set(3, -0.8, 4);
  group.add(gunR);

  group.scale.set(2, 2, 2);
  // Rotate entire model so nose (built along +X) faces -Z (the physics forward direction)
  group.rotation.y = Math.PI / 2;
  // Wrap in a parent so flight quaternion applies cleanly
  const wrapper = new THREE.Group();
  wrapper.add(group);
  wrapper.pilotArmPivot = pilotArmPivot;
  wrapper.pilotHead = pilotHead;
  wrapper.smile = smile;
  return wrapper;
}

const airplane = createAirplane();
scene.add(airplane);

// Pilot cheer state
let pilotCheerTimer = 0;

// ─── Walking Pilot (3rd person character) ─────────────────────
function createWalkingPilot() {
  const group = new THREE.Group();
  const skinMat = new THREE.MeshPhongMaterial({ color: 0xffddb0, flatShading: true });
  const suitMat = new THREE.MeshPhongMaterial({ color: 0x005293, flatShading: true });
  const hairMat = new THREE.MeshPhongMaterial({ color: 0xe8c84a, flatShading: true });
  const eyeMat = new THREE.MeshPhongMaterial({ color: 0x3388cc });
  const bootMat = new THREE.MeshPhongMaterial({ color: 0x333333, flatShading: true });
  const smileMat = new THREE.MeshPhongMaterial({ color: 0xcc4444 });

  // Head
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), skinMat);
  head.position.y = 2.7;
  head.castShadow = true;
  group.add(head);

  // Blond hair
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const h = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.3, 3), hairMat);
    h.position.set(Math.sin(a) * 0.35, 3.05, Math.cos(a) * 0.35);
    h.rotation.x = Math.cos(a) * 0.3;
    h.rotation.z = Math.sin(a) * 0.3;
    group.add(h);
  }

  // Blue eyes
  const el = new THREE.Mesh(new THREE.SphereGeometry(0.07, 4, 4), eyeMat);
  el.position.set(-0.18, 2.75, 0.42);
  group.add(el);
  const er = new THREE.Mesh(new THREE.SphereGeometry(0.07, 4, 4), eyeMat);
  er.position.set(0.18, 2.75, 0.42);
  group.add(er);

  // Smile
  const smile = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.025, 4, 8, Math.PI), smileMat);
  smile.position.set(0, 2.55, 0.45);
  smile.rotation.x = Math.PI;
  group.add(smile);

  // Torso
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.35, 1.0, 6), suitMat);
  torso.position.y = 1.8;
  torso.castShadow = true;
  group.add(torso);

  // Left arm
  const leftArmPivot = new THREE.Group();
  leftArmPivot.position.set(-0.55, 2.2, 0);
  const lua = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.1, 0.55, 4), suitMat);
  lua.position.y = -0.275;
  leftArmPivot.add(lua);
  const leftElbowPivot = new THREE.Group();
  leftElbowPivot.position.y = -0.55;
  const lfa = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.08, 0.5, 4), skinMat);
  lfa.position.y = -0.25;
  leftElbowPivot.add(lfa);
  const lh = new THREE.Mesh(new THREE.SphereGeometry(0.1, 4, 4), skinMat);
  lh.position.y = -0.55;
  leftElbowPivot.add(lh);
  leftArmPivot.add(leftElbowPivot);
  group.add(leftArmPivot);

  // Right arm
  const rightArmPivot = new THREE.Group();
  rightArmPivot.position.set(0.55, 2.2, 0);
  const rua = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.1, 0.55, 4), suitMat);
  rua.position.y = -0.275;
  rightArmPivot.add(rua);
  const rightElbowPivot = new THREE.Group();
  rightElbowPivot.position.y = -0.55;
  const rfa = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.08, 0.5, 4), skinMat);
  rfa.position.y = -0.25;
  rightElbowPivot.add(rfa);
  const rh = new THREE.Mesh(new THREE.SphereGeometry(0.1, 4, 4), skinMat);
  rh.position.y = -0.55;
  rightElbowPivot.add(rh);
  rightArmPivot.add(rightElbowPivot);
  group.add(rightArmPivot);

  // Left leg (foot bottom at ~y=0)
  const leftLegPivot = new THREE.Group();
  leftLegPivot.position.set(-0.2, 1.2, 0);
  const lt = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.12, 0.55, 4), suitMat);
  lt.position.y = -0.275;
  leftLegPivot.add(lt);
  const leftKneePivot = new THREE.Group();
  leftKneePivot.position.y = -0.55;
  const ls = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.1, 0.5, 4), suitMat);
  ls.position.y = -0.25;
  leftKneePivot.add(ls);
  const lf = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.1, 0.3), bootMat);
  lf.position.set(0, -0.55, 0.05);
  leftKneePivot.add(lf);
  leftLegPivot.add(leftKneePivot);
  group.add(leftLegPivot);

  // Right leg
  const rightLegPivot = new THREE.Group();
  rightLegPivot.position.set(0.2, 1.2, 0);
  const rt = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.12, 0.55, 4), suitMat);
  rt.position.y = -0.275;
  rightLegPivot.add(rt);
  const rightKneePivot = new THREE.Group();
  rightKneePivot.position.y = -0.55;
  const rs = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.1, 0.5, 4), suitMat);
  rs.position.y = -0.25;
  rightKneePivot.add(rs);
  const rf = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.1, 0.3), bootMat);
  rf.position.set(0, -0.55, 0.05);
  rightKneePivot.add(rf);
  rightLegPivot.add(rightKneePivot);
  group.add(rightLegPivot);

  // Scale up for ground-level visibility (~6 units tall)
  group.scale.set(2, 2, 2);
  group.visible = false;
  scene.add(group);

  return {
    group,
    leftArmPivot, rightArmPivot,
    leftElbowPivot, rightElbowPivot,
    leftLegPivot, rightLegPivot,
    leftKneePivot, rightKneePivot,
  };
}

const walkingPilot = createWalkingPilot();

// ─── Parachute ──────────────────────────────────────────────
const parachuteGroup = new THREE.Group();
const CHUTE_RADIUS = 8;
const CHUTE_LINE_TOP = 14; // canopy height above pilot

// Canopy dome — alternating Swedish blue & yellow panels
for (let i = 0; i < 8; i++) {
  const startAngle = (i / 8) * Math.PI * 2;
  const segAngle = Math.PI * 2 / 8;
  const color = i % 2 === 0 ? 0x005293 : 0xfecc02;
  const geo = new THREE.SphereGeometry(CHUTE_RADIUS, 4, 6, startAngle, segAngle, 0, Math.PI / 2);
  const mat = new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide });
  const panel = new THREE.Mesh(geo, mat);
  panel.position.y = CHUTE_LINE_TOP;
  parachuteGroup.add(panel);
}

// Suspension lines
const chuteLineMat = new THREE.LineBasicMaterial({ color: 0x444444 });
for (let i = 0; i < 12; i++) {
  const a = (i / 12) * Math.PI * 2;
  const pts = [
    new THREE.Vector3(0, 3, 0),
    new THREE.Vector3(Math.cos(a) * CHUTE_RADIUS * 0.85, CHUTE_LINE_TOP, Math.sin(a) * CHUTE_RADIUS * 0.85),
  ];
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  parachuteGroup.add(new THREE.Line(geo, chuteLineMat));
}

parachuteGroup.visible = false;
scene.add(parachuteGroup);

// ─── Collectible Flowers (golden glowing) ────────────────────
const collectibleFlowers = [];

function spawnCollectibleFlowers() {
  // Remove old flowers
  for (const f of collectibleFlowers) {
    scene.remove(f.group);
  }
  collectibleFlowers.length = 0;

  const glowMat = new THREE.MeshPhongMaterial({
    color: 0xffdd00,
    emissive: 0xffaa00,
    emissiveIntensity: 0.6,
    flatShading: true,
  });
  const stemMat2 = new THREE.MeshLambertMaterial({ color: 0x44aa22 });

  for (let i = 0; i < 40; i++) {
    const fx = (Math.random() - 0.5) * TERRAIN_SIZE * 0.7;
    const fz = (Math.random() - 0.5) * TERRAIN_SIZE * 0.7;
    const fy = getTerrainHeight(fx, fz);
    if (fy < -10 || fy > 100) { i--; continue; }

    const g = new THREE.Group();
    // Stem
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.35, 5, 4), stemMat2);
    stem.position.y = 2.5;
    g.add(stem);
    // Petals
    for (let p = 0; p < 6; p++) {
      const a = (p / 6) * Math.PI * 2;
      const petal = new THREE.Mesh(new THREE.SphereGeometry(1.2, 5, 4), glowMat);
      petal.position.set(Math.cos(a) * 1.2, 5.5, Math.sin(a) * 1.2);
      petal.scale.set(1, 0.4, 1);
      g.add(petal);
    }
    // Center
    const center = new THREE.Mesh(new THREE.SphereGeometry(0.8, 5, 4), glowMat);
    center.position.y = 5.5;
    g.add(center);

    g.position.set(fx, fy, fz);
    scene.add(g);
    collectibleFlowers.push({ group: g, collected: false, baseY: fy });
  }
}

spawnCollectibleFlowers();

// ─── Moose ───────────────────────────────────────────────────
const mooseList = [];

function createMoose() {
  const group = new THREE.Group();
  const brownMat = new THREE.MeshPhongMaterial({ color: 0x6b4226, flatShading: true });
  const darkMat = new THREE.MeshPhongMaterial({ color: 0x3d2515, flatShading: true });
  const antlerMat = new THREE.MeshPhongMaterial({ color: 0x8b7355, flatShading: true });

  // Body
  const body = new THREE.Mesh(new THREE.BoxGeometry(3, 2.5, 6), brownMat);
  body.position.y = 4;
  group.add(body);

  // 4 Legs
  for (const [lx, lz] of [[-1, -2], [1, -2], [-1, 2], [1, 2]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.25, 3.5, 4), darkMat);
    leg.position.set(lx, 1.75, lz);
    group.add(leg);
  }

  // Head pivot (for nodding)
  const headPivot = new THREE.Group();
  headPivot.position.set(0, 5, 3.5);

  const head = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.5, 2.5), brownMat);
  head.position.set(0, 0.3, 1);
  headPivot.add(head);

  // Snout
  const snout = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 1.2), darkMat);
  snout.position.set(0, -0.2, 2.2);
  headPivot.add(snout);

  // Dewlap (hanging chin flap)
  const dewlap = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.0, 0.5), brownMat);
  dewlap.position.set(0, -0.8, 1.8);
  headPivot.add(dewlap);

  // Antlers (flat paddles)
  for (const side of [-1, 1]) {
    const antler = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.3, 1.5), antlerMat);
    antler.position.set(side * 1.8, 1.2, 0.5);
    antler.rotation.z = side * 0.3;
    headPivot.add(antler);
    // Tines
    for (let ti = 0; ti < 3; ti++) {
      const tine = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.8, 3), antlerMat);
      tine.position.set(side * (1.0 + ti * 0.7), 1.6, 0.5);
      headPivot.add(tine);
    }
  }

  group.add(headPivot);
  // Scale up for visibility
  group.scale.set(1.5, 1.5, 1.5);
  scene.add(group);

  return { group, headPivot };
}

function spawnMoose() {
  for (const m of mooseList) {
    scene.remove(m.group);
  }
  mooseList.length = 0;

  for (let i = 0; i < 3; i++) {
    let mx, mz, my;
    do {
      mx = (Math.random() - 0.5) * TERRAIN_SIZE * 0.6;
      mz = (Math.random() - 0.5) * TERRAIN_SIZE * 0.6;
      my = getTerrainHeight(mx, mz);
    } while (my < -10 || my > 100);

    const { group, headPivot } = createMoose();
    group.position.set(mx, my, mz);
    group.rotation.y = Math.random() * Math.PI * 2;

    mooseList.push({
      group,
      headPivot,
      petted: false,
      petTimer: 0,
      wanderDir: Math.random() * Math.PI * 2,
      wanderTimer: 3 + Math.random() * 3,
    });
  }
}

spawnMoose();

// ─── Coffee Cup (for fika) ───────────────────────────────────
(function createCoffeeCup() {
  const cupGroup = new THREE.Group();
  const whiteMat = new THREE.MeshPhongMaterial({ color: 0xffffff, flatShading: true });
  const brownLiquid = new THREE.MeshPhongMaterial({ color: 0x4a2c0a, flatShading: true });

  // Cup body
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.10, 0.2, 8), whiteMat);
  cupGroup.add(cup);

  // Handle
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.02, 4, 8, Math.PI), whiteMat);
  handle.position.set(0.14, 0, 0);
  handle.rotation.y = Math.PI / 2;
  cupGroup.add(handle);

  // Coffee liquid top
  const liquid = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.10, 0.02, 8), brownLiquid);
  liquid.position.y = 0.09;
  cupGroup.add(liquid);

  cupGroup.position.set(0, -0.45, 0.15);
  cupGroup.visible = false;
  walkingPilot.rightElbowPivot.add(cupGroup);
  walkingPilot.coffeeCup = cupGroup;
})();

// ─── Clouds ──────────────────────────────────────────────────
function createCloud(x, y, z) {
  const group = new THREE.Group();
  // Soft Scandinavian clouds - white with subtle warm tones from midsummer sun
  const shade = Math.random();
  const cloudColor = shade > 0.6 ? 0xffffff : (shade > 0.3 ? 0xfff5e6 : 0xf0eadd);
  const mat = new THREE.MeshLambertMaterial({ color: cloudColor });
  const count = Math.floor(3 + Math.random() * 5);
  for (let i = 0; i < count; i++) {
    const r = 15 + Math.random() * 30;
    const geo = new THREE.SphereGeometry(r, 7, 5);
    const puff = new THREE.Mesh(geo, mat);
    puff.position.set(
      (Math.random() - 0.5) * 60,
      (Math.random() - 0.5) * 15,
      (Math.random() - 0.5) * 40
    );
    group.add(puff);
  }
  group.position.set(x, y, z);
  scene.add(group);
  return group;
}

const clouds = [];
for (let i = 0; i < 20; i++) {
  const x = (Math.random() - 0.5) * TERRAIN_SIZE * 1.5;
  const z = (Math.random() - 0.5) * TERRAIN_SIZE * 1.5;
  const y = 200 + Math.random() * 500;
  clouds.push(createCloud(x, y, z));
}

// ─── Trees ───────────────────────────────────────────────────
function plantTrees() {
  const trunkGeo = new THREE.CylinderGeometry(1, 1.5, 12, 5);
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x5c3d1e });
  const leavesGeo = new THREE.ConeGeometry(8, 16, 6);
  const leavesMat = new THREE.MeshLambertMaterial({ color: 0x2d7a2d });

  const positions = terrain.geometry.attributes.position.array;
  const count = Math.floor(positions.length / 3);

  for (let i = 0; i < 150; i++) {
    const idx = Math.floor(Math.random() * count);
    const px = positions[idx * 3];
    const py = positions[idx * 3 + 1];
    const h = positions[idx * 3 + 2];

    // Only plant on green areas
    if (h < -10 || h > 100) continue;

    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.set(px, h + 6, -py);
    scene.add(trunk);

    const leaves = new THREE.Mesh(leavesGeo, leavesMat);
    leaves.position.set(px, h + 18, -py);
    scene.add(leaves);
  }
}
plantTrees();

// ─── Collision System ────────────────────────────────────────
// Each collider: { x, z, hw, hd, cosR, sinR } — oriented bounding box
const colliders = [];

function addCollider(px, pz, halfW, halfD, rotation) {
  const r = rotation || 0;
  colliders.push({ x: px, z: pz, hw: halfW + 1, hd: halfD + 1, cosR: Math.cos(r), sinR: Math.sin(r) });
}

function resolveCollisions(px, pz) {
  for (const c of colliders) {
    // Transform player position into collider's local space
    const dx = px - c.x;
    const dz = pz - c.z;
    const lx = dx * c.cosR + dz * c.sinR;
    const lz = -dx * c.sinR + dz * c.cosR;

    // Check if inside the box
    if (Math.abs(lx) < c.hw && Math.abs(lz) < c.hd) {
      // Push out along the shortest axis
      const overlapX = c.hw - Math.abs(lx);
      const overlapZ = c.hd - Math.abs(lz);
      if (overlapX < overlapZ) {
        const signX = lx > 0 ? 1 : -1;
        const nlx = signX * c.hw;
        px = c.x + nlx * c.cosR - lz * (-c.sinR);
        pz = c.z + nlx * c.sinR + lz * c.cosR;
      } else {
        const signZ = lz > 0 ? 1 : -1;
        const nlz = signZ * c.hd;
        px = c.x + lx * c.cosR - nlz * (-c.sinR);
        pz = c.z + lx * c.sinR + nlz * c.cosR;
      }
    }
  }
  return { x: px, z: pz };
}

// ─── Swedish Houses (Röda Stugor) ────────────────────────────
function createHouse(px, pz, scale, rotation) {
  const group = new THREE.Group();
  const s = scale || 1;

  // Falu red walls (classic Swedish cottage color)
  const wallMat = new THREE.MeshPhongMaterial({ color: 0x8B2500, flatShading: true });
  const whiteTrim = new THREE.MeshPhongMaterial({ color: 0xf5f0e0, flatShading: true });
  const roofMat = new THREE.MeshPhongMaterial({ color: 0x3a3a3a, flatShading: true });
  const doorMat = new THREE.MeshPhongMaterial({ color: 0xf5f0e0, flatShading: true });
  const glassMat = new THREE.MeshPhongMaterial({ color: 0x88bbdd, flatShading: true, transparent: true, opacity: 0.6 });
  const chimneyMat = new THREE.MeshPhongMaterial({ color: 0x8B4513, flatShading: true });

  const w = 12 * s, h = 8 * s, d = 16 * s;

  // Main walls
  const walls = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
  walls.position.y = h / 2;
  walls.castShadow = true;
  group.add(walls);

  // Roof (triangular prism via extruded shape)
  const roofW = w * 1.15, roofH = 6 * s, roofD = d * 1.1;
  const roofShape = new THREE.Shape();
  roofShape.moveTo(-roofW / 2, 0);
  roofShape.lineTo(0, roofH);
  roofShape.lineTo(roofW / 2, 0);
  roofShape.lineTo(-roofW / 2, 0);
  const roofGeo = new THREE.ExtrudeGeometry(roofShape, { depth: roofD, bevelEnabled: false });
  const roof = new THREE.Mesh(roofGeo, roofMat);
  roof.position.set(0, h, -roofD / 2);
  roof.castShadow = true;
  group.add(roof);

  // White corner trim
  for (const cx of [-1, 1]) {
    for (const cz of [-1, 1]) {
      const trim = new THREE.Mesh(new THREE.BoxGeometry(0.8 * s, h * 1.02, 0.8 * s), whiteTrim);
      trim.position.set(cx * w / 2, h / 2, cz * d / 2);
      group.add(trim);
    }
  }

  // White base trim
  const baseTrim = new THREE.Mesh(new THREE.BoxGeometry(w * 1.04, 0.6 * s, d * 1.04), whiteTrim);
  baseTrim.position.y = 0.3 * s;
  group.add(baseTrim);

  // Door (front face)
  const door = new THREE.Mesh(new THREE.BoxGeometry(2.5 * s, 5 * s, 0.3 * s), doorMat);
  door.position.set(0, 2.5 * s, d / 2 + 0.15 * s);
  group.add(door);

  // Windows (2 per long side)
  for (const side of [-1, 1]) {
    for (const wx of [-1, 1]) {
      // Window frame
      const frame = new THREE.Mesh(new THREE.BoxGeometry(2.8 * s, 2.8 * s, 0.4 * s), whiteTrim);
      frame.position.set(wx * 3.5 * s, h * 0.6, side * (d / 2 + 0.15 * s));
      group.add(frame);
      // Glass
      const glass = new THREE.Mesh(new THREE.BoxGeometry(2.2 * s, 2.2 * s, 0.5 * s), glassMat);
      glass.position.set(wx * 3.5 * s, h * 0.6, side * (d / 2 + 0.15 * s));
      group.add(glass);
    }
  }

  // Side windows (1 per short side)
  for (const side of [-1, 1]) {
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.4 * s, 2.8 * s, 2.8 * s), whiteTrim);
    frame.position.set(side * (w / 2 + 0.15 * s), h * 0.6, 0);
    group.add(frame);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.5 * s, 2.2 * s, 2.2 * s), glassMat);
    glass.position.set(side * (w / 2 + 0.15 * s), h * 0.6, 0);
    group.add(glass);
  }

  // Chimney
  const chimney = new THREE.Mesh(new THREE.BoxGeometry(2 * s, 5 * s, 2 * s), chimneyMat);
  chimney.position.set(w * 0.25, h + 4 * s, 0);
  group.add(chimney);

  // Sample terrain at 4 corners (accounting for rotation) to find proper placement
  const rot = rotation || 0;
  const cosR = Math.cos(rot), sinR = Math.sin(rot);
  const hw = w / 2 + 1, hd = d / 2 + 1; // slightly wider than footprint
  const corners = [
    [-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]
  ];
  let minH = Infinity, maxH = -Infinity;
  for (const [cx, cz] of corners) {
    const wx = px + cx * cosR - cz * sinR;
    const wz = pz + cx * sinR + cz * cosR;
    const ch = getTerrainHeight(wx, wz);
    if (ch < minH) minH = ch;
    if (ch > maxH) maxH = ch;
  }
  // Place building at highest corner so no corner clips into terrain
  const py = maxH;
  // Stone foundation filling gap from building base to lowest terrain point
  const foundationDepth = maxH - minH + 3 * s;
  if (foundationDepth > 0.5) {
    const foundMat = new THREE.MeshPhongMaterial({ color: 0x777770, flatShading: true });
    const foundation = new THREE.Mesh(
      new THREE.BoxGeometry(w * 1.08, foundationDepth, d * 1.08),
      foundMat
    );
    foundation.position.y = -foundationDepth / 2;
    group.add(foundation);
  }

  group.position.set(px, py, pz);
  group.rotation.y = rot;
  scene.add(group);
  addCollider(px, pz, w / 2, d / 2, rot);
  return group;
}

// ─── Barn ─────────────────────────────────────────────────────
function createBarn(px, pz, rotation) {
  const group = new THREE.Group();
  const wallMat = new THREE.MeshPhongMaterial({ color: 0x8B2500, flatShading: true });
  const roofMat = new THREE.MeshPhongMaterial({ color: 0x555555, flatShading: true });
  const whiteTrim = new THREE.MeshPhongMaterial({ color: 0xf5f0e0, flatShading: true });
  const doorMat = new THREE.MeshPhongMaterial({ color: 0x5c3d1e, flatShading: true });

  // Larger structure
  const w = 20, h = 14, d = 30;
  const walls = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
  walls.position.y = h / 2;
  walls.castShadow = true;
  group.add(walls);

  // Gambrel-ish roof (simple triangle)
  const roofShape = new THREE.Shape();
  roofShape.moveTo(-w * 0.6, 0);
  roofShape.lineTo(0, 10);
  roofShape.lineTo(w * 0.6, 0);
  roofShape.lineTo(-w * 0.6, 0);
  const roofGeo = new THREE.ExtrudeGeometry(roofShape, { depth: d * 1.1, bevelEnabled: false });
  const roof = new THREE.Mesh(roofGeo, roofMat);
  roof.position.set(0, h, -d * 0.55);
  group.add(roof);

  // Big barn doors
  for (const side of [-1, 1]) {
    const bDoor = new THREE.Mesh(new THREE.BoxGeometry(6, 10, 0.5), doorMat);
    bDoor.position.set(side * 3.5, 5, d / 2 + 0.25);
    group.add(bDoor);
  }

  // White trim X on doors
  const trimGeo = new THREE.BoxGeometry(0.4, 14, 0.6);
  const xTrim1 = new THREE.Mesh(trimGeo, whiteTrim);
  xTrim1.position.set(0, 5, d / 2 + 0.4);
  xTrim1.rotation.z = 0.5;
  group.add(xTrim1);
  const xTrim2 = new THREE.Mesh(trimGeo, whiteTrim);
  xTrim2.position.set(0, 5, d / 2 + 0.4);
  xTrim2.rotation.z = -0.5;
  group.add(xTrim2);

  // Sample terrain at 4 corners for proper placement
  const rot = rotation || 0;
  const cosR = Math.cos(rot), sinR = Math.sin(rot);
  const hw = w / 2 + 1, hd = d / 2 + 1;
  const corners = [
    [-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]
  ];
  let minH = Infinity, maxH = -Infinity;
  for (const [cx, cz] of corners) {
    const wx = px + cx * cosR - cz * sinR;
    const wz = pz + cx * sinR + cz * cosR;
    const ch = getTerrainHeight(wx, wz);
    if (ch < minH) minH = ch;
    if (ch > maxH) maxH = ch;
  }
  const py = maxH;
  const foundationDepth = maxH - minH + 4;
  if (foundationDepth > 0.5) {
    const foundMat = new THREE.MeshPhongMaterial({ color: 0x777770, flatShading: true });
    const foundation = new THREE.Mesh(
      new THREE.BoxGeometry(w * 1.08, foundationDepth, d * 1.08),
      foundMat
    );
    foundation.position.y = -foundationDepth / 2;
    group.add(foundation);
  }

  group.position.set(px, py, pz);
  group.rotation.y = rot;
  scene.add(group);
  addCollider(px, pz, w / 2, d / 2, rot);
  return group;
}

// ─── Fences ──────────────────────────────────────────────────
function createFence(startX, startZ, endX, endZ) {
  const woodMat = new THREE.MeshLambertMaterial({ color: 0x8B7355 });
  const dx = endX - startX;
  const dz = endZ - startZ;
  const len = Math.sqrt(dx * dx + dz * dz);
  const angle = Math.atan2(dx, dz);
  const postCount = Math.floor(len / 6);

  for (let i = 0; i <= postCount; i++) {
    const frac = i / postCount;
    const px = startX + dx * frac;
    const pz = startZ + dz * frac;
    const py = getTerrainHeight(px, pz);

    // Post
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.35, 4, 4), woodMat);
    post.position.set(px, py + 2, pz);
    scene.add(post);

    // Horizontal rails between posts
    if (i < postCount) {
      const nx = startX + dx * ((i + 1) / postCount);
      const nz = startZ + dz * ((i + 1) / postCount);
      const ny = getTerrainHeight(nx, nz);
      const mx = (px + nx) / 2;
      const mz = (pz + nz) / 2;
      const my = ((py + ny) / 2);
      const segLen = Math.sqrt((nx - px) ** 2 + (nz - pz) ** 2);

      for (const rh of [1.2, 3.0]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, segLen), woodMat);
        rail.position.set(mx, my + rh, mz);
        rail.rotation.y = angle;
        rail.rotation.x = Math.atan2(ny - py, segLen);
        scene.add(rail);
      }
    }
  }
}

// ─── Hay Bales ───────────────────────────────────────────────
function createHayBale(px, pz) {
  const hayMat = new THREE.MeshPhongMaterial({ color: 0xd4aa50, flatShading: true });
  const bale = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 4, 12), hayMat);
  const py = getTerrainHeight(px, pz);
  bale.position.set(px, py + 3, pz);
  bale.rotation.z = Math.PI / 2;
  bale.rotation.y = Math.random() * Math.PI;
  bale.castShadow = false;
  scene.add(bale);
}

// ─── Boats ───────────────────────────────────────────────────
const boats = [];
function createBoat(px, pz) {
  const group = new THREE.Group();
  const hullMat = new THREE.MeshPhongMaterial({ color: 0x8B2500, flatShading: true });
  const seatMat = new THREE.MeshPhongMaterial({ color: 0x8B7355, flatShading: true });

  // Hull (tapered box)
  const hull = new THREE.Mesh(new THREE.BoxGeometry(3, 1.5, 8), hullMat);
  hull.position.y = 0.5;
  group.add(hull);

  // Bow taper
  const bow = new THREE.Mesh(new THREE.ConeGeometry(1.5, 3, 4), hullMat);
  bow.rotation.x = Math.PI / 2;
  bow.position.set(0, 0.5, 5);
  group.add(bow);

  // Seats
  for (const sz of [-1.5, 1.5]) {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.2, 1), seatMat);
    seat.position.set(0, 1.2, sz);
    group.add(seat);
  }

  group.position.set(px, -39.5, pz);
  group.rotation.y = Math.random() * Math.PI * 2;
  scene.add(group);
  boats.push({ group, baseX: px, baseZ: pz });
  return group;
}

// ─── Stone Walls ─────────────────────────────────────────────
function createStoneWall(startX, startZ, endX, endZ) {
  const stoneMat = new THREE.MeshPhongMaterial({ color: 0x888880, flatShading: true });
  const dx = endX - startX;
  const dz = endZ - startZ;
  const len = Math.sqrt(dx * dx + dz * dz);
  const stoneCount = Math.floor(len / 2.5);

  for (let i = 0; i < stoneCount; i++) {
    const frac = (i + 0.5) / stoneCount;
    const sx = startX + dx * frac + (Math.random() - 0.5) * 0.5;
    const sz = startZ + dz * frac + (Math.random() - 0.5) * 0.5;
    const sy = getTerrainHeight(sx, sz);
    const r = 0.8 + Math.random() * 0.8;
    const stone = new THREE.Mesh(
      new THREE.DodecahedronGeometry(r, 0),
      stoneMat
    );
    stone.position.set(sx, sy + r * 0.7, sz);
    stone.rotation.set(Math.random(), Math.random(), Math.random());
    scene.add(stone);
  }
}

// ─── Populate the Land ───────────────────────────────────────
(function populateLand() {
  // ── Village clusters (groups of houses near maypoles) ──
  const villages = [
    { cx: 500, cz: -500 },     // near maypole 1
    { cx: -1500, cz: 1000 },   // near maypole 2
    { cx: 2000, cz: 2000 },    // near maypole 3
  ];

  for (const v of villages) {
    // 4-6 houses around each maypole
    const count = 4 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
      const dist = 60 + Math.random() * 80;
      const hx = v.cx + Math.cos(angle) * dist;
      const hz = v.cz + Math.sin(angle) * dist;
      const hy = getTerrainHeight(hx, hz);
      if (hy < -10 || hy > 80) continue;
      const scale = 0.8 + Math.random() * 0.4;
      createHouse(hx, hz, scale, angle + Math.PI + (Math.random() - 0.5) * 0.8);
    }
    // One barn per village
    const ba = Math.random() * Math.PI * 2;
    const bd = 100 + Math.random() * 40;
    const bx = v.cx + Math.cos(ba) * bd;
    const bz = v.cz + Math.sin(ba) * bd;
    const by = getTerrainHeight(bx, bz);
    if (by > -10 && by < 80) createBarn(bx, bz, ba);

    // Fences around village
    for (let i = 0; i < 3; i++) {
      const fa = Math.random() * Math.PI * 2;
      const fd = 50 + Math.random() * 60;
      const fx1 = v.cx + Math.cos(fa) * fd;
      const fz1 = v.cz + Math.sin(fa) * fd;
      const fx2 = fx1 + Math.cos(fa + 0.3) * (20 + Math.random() * 30);
      const fz2 = fz1 + Math.sin(fa + 0.3) * (20 + Math.random() * 30);
      const fy = getTerrainHeight(fx1, fz1);
      if (fy > -10 && fy < 80) createFence(fx1, fz1, fx2, fz2);
    }

    // Hay bales near barn
    for (let i = 0; i < 5; i++) {
      const hba = Math.random() * Math.PI * 2;
      const hbd = 15 + Math.random() * 20;
      const hbx = v.cx + Math.cos(ba) * bd + Math.cos(hba) * hbd;
      const hbz = v.cz + Math.sin(ba) * bd + Math.sin(hba) * hbd;
      const hby = getTerrainHeight(hbx, hbz);
      if (hby > -10 && hby < 80) createHayBale(hbx, hbz);
    }

    // Stone walls bordering fields
    for (let i = 0; i < 2; i++) {
      const sa = Math.random() * Math.PI * 2;
      const sd = 80 + Math.random() * 60;
      const sx1 = v.cx + Math.cos(sa) * sd;
      const sz1 = v.cz + Math.sin(sa) * sd;
      const sx2 = sx1 + Math.cos(sa + 0.15) * (30 + Math.random() * 40);
      const sz2 = sz1 + Math.sin(sa + 0.15) * (30 + Math.random() * 40);
      const sy = getTerrainHeight(sx1, sz1);
      if (sy > -10 && sy < 80) createStoneWall(sx1, sz1, sx2, sz2);
    }
  }

  // ── Scattered farmsteads across the terrain ──
  for (let i = 0; i < 25; i++) {
    const fx = (Math.random() - 0.5) * TERRAIN_SIZE * 0.7;
    const fz = (Math.random() - 0.5) * TERRAIN_SIZE * 0.7;
    const fy = getTerrainHeight(fx, fz);
    if (fy < -5 || fy > 70) continue;

    // Skip if too close to a village center or airport
    let nearVillage = false;
    for (const v of villages) {
      const vdx = fx - v.cx, vdz = fz - v.cz;
      if (Math.sqrt(vdx * vdx + vdz * vdz) < 200) { nearVillage = true; break; }
    }
    if (nearVillage) continue;
    const adx = fx - 300, adz = fz - (-350);
    if (Math.sqrt(adx * adx + adz * adz) < 150) continue;

    const rot = Math.random() * Math.PI * 2;
    const scale = 0.7 + Math.random() * 0.5;
    createHouse(fx, fz, scale, rot);

    // Some farmsteads get a small fence
    if (Math.random() < 0.5) {
      const fenceAngle = rot + Math.PI / 2;
      const fl = 15 + Math.random() * 15;
      createFence(
        fx + Math.cos(fenceAngle) * 10, fz + Math.sin(fenceAngle) * 10,
        fx + Math.cos(fenceAngle) * 10 + Math.cos(rot) * fl,
        fz + Math.sin(fenceAngle) * 10 + Math.sin(rot) * fl
      );
    }

    // Some get hay bales
    if (Math.random() < 0.4) {
      for (let j = 0; j < 3; j++) {
        const ha = Math.random() * Math.PI * 2;
        createHayBale(fx + Math.cos(ha) * (12 + Math.random() * 10), fz + Math.sin(ha) * (12 + Math.random() * 10));
      }
    }
  }

  // ── Boats along waterline ──
  for (let i = 0; i < 12; i++) {
    const bx = (Math.random() - 0.5) * TERRAIN_SIZE * 0.6;
    const bz = (Math.random() - 0.5) * TERRAIN_SIZE * 0.6;
    const bh = getTerrainHeight(bx, bz);
    // Place near water's edge
    if (bh > -50 && bh < -30) {
      createBoat(bx, bz);
    }
  }

  // ── Additional stone walls in fields ──
  for (let i = 0; i < 15; i++) {
    const sx = (Math.random() - 0.5) * TERRAIN_SIZE * 0.5;
    const sz = (Math.random() - 0.5) * TERRAIN_SIZE * 0.5;
    const sh = getTerrainHeight(sx, sz);
    if (sh < 0 || sh > 60) continue;
    const wallAngle = Math.random() * Math.PI * 2;
    const wallLen = 20 + Math.random() * 40;
    createStoneWall(sx, sz, sx + Math.cos(wallAngle) * wallLen, sz + Math.sin(wallAngle) * wallLen);
  }

  // ── Hay bales in meadows ──
  for (let i = 0; i < 30; i++) {
    const hx = (Math.random() - 0.5) * TERRAIN_SIZE * 0.6;
    const hz = (Math.random() - 0.5) * TERRAIN_SIZE * 0.6;
    const hh = getTerrainHeight(hx, hz);
    if (hh > 0 && hh < 50) createHayBale(hx, hz);
  }
})();

// ─── Airport ────────────────────────────────────────────────
const AIRPORT_POS = { x: 300, z: -350 }; // visible from player start, clear of village
const AIRPORT_HEADING = -0.3; // runway heading (radians)

(function createAirport() {
  const cx = AIRPORT_POS.x;
  const cz = AIRPORT_POS.z;
  const baseY = getTerrainHeight(cx, cz);
  const cosH = Math.cos(AIRPORT_HEADING);
  const sinH = Math.sin(AIRPORT_HEADING);

  // ── Runway — flat gray strip ──
  const runwayLen = 200, runwayW = 18;
  const runwayGeo = new THREE.BoxGeometry(runwayW, 0.5, runwayLen);
  const runwayMat = new THREE.MeshPhongMaterial({ color: 0x555555 });
  const runway = new THREE.Mesh(runwayGeo, runwayMat);
  runway.position.set(cx, baseY + 0.25, cz);
  runway.rotation.y = AIRPORT_HEADING;
  runway.receiveShadow = true;
  scene.add(runway);

  // Runway center line — dashed white
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (let i = -8; i <= 8; i++) {
    const dash = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.1, 6), lineMat);
    dash.position.set(
      cx + sinH * (i * 12),
      baseY + 0.55,
      cz + cosH * (i * 12)
    );
    dash.rotation.y = AIRPORT_HEADING;
    scene.add(dash);
  }

  // Runway threshold markings
  for (const end of [-1, 1]) {
    for (let s = -3; s <= 3; s++) {
      const mark = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.1, 8), lineMat);
      const along = end * (runwayLen / 2 - 6);
      mark.position.set(
        cx + sinH * along + cosH * (s * 2.2),
        baseY + 0.55,
        cz + cosH * along - sinH * (s * 2.2)
      );
      mark.rotation.y = AIRPORT_HEADING;
      scene.add(mark);
    }
  }

  // ── Taxiway ──
  const taxiGeo = new THREE.BoxGeometry(8, 0.4, 40);
  const taxiMat = new THREE.MeshPhongMaterial({ color: 0x666666 });
  const taxi = new THREE.Mesh(taxiGeo, taxiMat);
  taxi.position.set(cx + cosH * 20, baseY + 0.2, cz - sinH * 20);
  taxi.rotation.y = AIRPORT_HEADING + Math.PI / 2;
  taxi.receiveShadow = true;
  scene.add(taxi);

  // ── Apron (parking area) ──
  const apronGeo = new THREE.BoxGeometry(40, 0.3, 30);
  const apronMat = new THREE.MeshPhongMaterial({ color: 0x606060 });
  const apron = new THREE.Mesh(apronGeo, apronMat);
  apron.position.set(cx + cosH * 40, baseY + 0.15, cz - sinH * 40);
  apron.rotation.y = AIRPORT_HEADING;
  apron.receiveShadow = true;
  scene.add(apron);

  // ── Terminal building — small wooden Swedish-style ──
  const termGroup = new THREE.Group();
  const wallMat = new THREE.MeshPhongMaterial({ color: 0x8B2500, flatShading: true }); // falu red
  const trimMat = new THREE.MeshPhongMaterial({ color: 0xf5f0e0 });
  const roofMat = new THREE.MeshPhongMaterial({ color: 0x555555, flatShading: true });
  const glassMat = new THREE.MeshPhongMaterial({ color: 0x88bbdd, transparent: true, opacity: 0.5 });

  // Main walls
  const termWall = new THREE.Mesh(new THREE.BoxGeometry(30, 8, 10), wallMat);
  termWall.position.y = 4;
  termWall.castShadow = true;
  termGroup.add(termWall);

  // White trim
  for (const x of [-15, 15]) {
    const trim = new THREE.Mesh(new THREE.BoxGeometry(0.5, 8.5, 10.5), trimMat);
    trim.position.set(x, 4, 0);
    termGroup.add(trim);
  }

  // Roof (simple pitched)
  const roofShape = new THREE.Shape();
  roofShape.moveTo(-16, 0);
  roofShape.lineTo(0, 5);
  roofShape.lineTo(16, 0);
  roofShape.lineTo(-16, 0);
  const roofGeo = new THREE.ExtrudeGeometry(roofShape, { depth: 11, bevelEnabled: false });
  const roof = new THREE.Mesh(roofGeo, roofMat);
  roof.rotation.x = -Math.PI / 2;
  roof.position.set(0, 8, 5.5);
  roof.castShadow = true;
  termGroup.add(roof);

  // Windows
  for (let i = -3; i <= 3; i++) {
    const win = new THREE.Mesh(new THREE.BoxGeometry(2, 2.5, 0.2), glassMat);
    win.position.set(i * 4, 4.5, 5.1);
    termGroup.add(win);
    // Window frame
    const frame = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.9, 0.1), trimMat);
    frame.position.set(i * 4, 4.5, 5.05);
    termGroup.add(frame);
  }

  // Door
  const door = new THREE.Mesh(new THREE.BoxGeometry(3, 5, 0.3), new THREE.MeshPhongMaterial({ color: 0x444444 }));
  door.position.set(0, 2.5, 5.2);
  termGroup.add(door);

  // "FLYGPLATS" sign
  const signGeo = new THREE.BoxGeometry(12, 2, 0.3);
  const signMat = new THREE.MeshPhongMaterial({ color: 0x005293 }); // Swedish blue
  const sign = new THREE.Mesh(signGeo, signMat);
  sign.position.set(0, 10, 5.2);
  termGroup.add(sign);

  termGroup.position.set(cx + cosH * 52, baseY, cz - sinH * 52);
  termGroup.rotation.y = AIRPORT_HEADING;
  scene.add(termGroup);

  // ── Control Tower ──
  const towerGroup = new THREE.Group();
  // Tower shaft
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(2, 2.5, 20, 8), new THREE.MeshPhongMaterial({ color: 0xcccccc }));
  shaft.position.y = 10;
  shaft.castShadow = true;
  towerGroup.add(shaft);
  // Cab (glass top)
  const cab = new THREE.Mesh(new THREE.CylinderGeometry(4, 3, 5, 8), glassMat);
  cab.position.y = 22.5;
  towerGroup.add(cab);
  // Cab roof
  const cabRoof = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.5, 0.5, 8), roofMat);
  cabRoof.position.y = 25.25;
  towerGroup.add(cabRoof);
  // Antenna
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 6, 4), new THREE.MeshPhongMaterial({ color: 0x888888 }));
  antenna.position.y = 28.5;
  towerGroup.add(antenna);
  // Red light on top
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.4, 6, 6), new THREE.MeshBasicMaterial({ color: 0xff0000 }));
  light.position.y = 31.5;
  towerGroup.add(light);

  towerGroup.position.set(cx + cosH * 55 - sinH * 25, baseY, cz - sinH * 55 - cosH * 25);
  scene.add(towerGroup);

  // ── Hangar ──
  const hangarGroup = new THREE.Group();
  const hangarMat = new THREE.MeshPhongMaterial({ color: 0x777777, flatShading: true });
  // Quonset-hut style (half-cylinder)
  const hangarGeo = new THREE.CylinderGeometry(12, 12, 20, 12, 1, false, 0, Math.PI);
  const hangar = new THREE.Mesh(hangarGeo, hangarMat);
  hangar.rotation.z = Math.PI / 2;
  hangar.rotation.y = Math.PI / 2;
  hangar.position.y = 0;
  hangar.castShadow = true;
  hangarGroup.add(hangar);
  // Back wall
  const backWall = new THREE.Mesh(new THREE.CircleGeometry(12, 12, 0, Math.PI), hangarMat);
  backWall.position.z = -10;
  backWall.position.y = 0;
  hangarGroup.add(backWall);
  // Front opening (no wall — open hangar door)

  hangarGroup.position.set(cx + cosH * 40 + sinH * 25, baseY, cz - sinH * 40 + cosH * 25);
  hangarGroup.rotation.y = AIRPORT_HEADING;
  scene.add(hangarGroup);

  // ── Windsock ──
  const sockGroup = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 8, 4), new THREE.MeshPhongMaterial({ color: 0x888888 }));
  pole.position.y = 4;
  sockGroup.add(pole);
  // Sock (cone)
  const sockGeo = new THREE.ConeGeometry(0.6, 3, 6);
  const sockMesh = new THREE.Mesh(sockGeo, new THREE.MeshPhongMaterial({ color: 0xff6600 }));
  sockMesh.rotation.z = -Math.PI / 2;
  sockMesh.position.set(1.5, 7.5, 0);
  sockGroup.add(sockMesh);

  sockGroup.position.set(cx - sinH * (runwayLen / 2 - 10), baseY, cz - cosH * (runwayLen / 2 - 10));
  scene.add(sockGroup);

  // ── Runway edge lights ──
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xffffaa });
  for (let i = -9; i <= 9; i++) {
    for (const side of [-1, 1]) {
      const lx = cx + sinH * (i * 10) + cosH * (side * (runwayW / 2 + 1));
      const lz = cz + cosH * (i * 10) - sinH * (side * (runwayW / 2 + 1));
      const lMesh = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.5, 0.3), lightMat);
      lMesh.position.set(lx, baseY + 0.5, lz);
      scene.add(lMesh);
    }
  }
})();

// Plane parking position on the runway center
const PLANE_PARK = {
  x: AIRPORT_POS.x,
  y: getTerrainHeight(AIRPORT_POS.x, AIRPORT_POS.z) + 6,
  z: AIRPORT_POS.z,
};

// ─── Villagers ───────────────────────────────────────────────
const villagers = [];

const villagerOutfits = [
  { shirt: 0x005293, pants: 0x333355, apron: 0xfecc02 },  // blue Swedish + yellow apron
  { shirt: 0xcc3333, pants: 0x443333, apron: 0xf5f0e0 },  // red folk + white apron
  { shirt: 0xf5f0e0, pants: 0x556644, apron: 0x005293 },  // white blouse + blue apron
  { shirt: 0xfecc02, pants: 0x444444, apron: null },       // yellow top
  { shirt: 0x44aa66, pants: 0x554433, apron: 0xf5f0e0 },  // green vest + white apron
  { shirt: 0xdd7744, pants: 0x3a3a55, apron: null },       // orange
  { shirt: 0x8866aa, pants: 0x444444, apron: 0xddaacc },   // purple + pink apron
  { shirt: 0xddaacc, pants: 0x556655, apron: null },       // pink
  { shirt: 0x335577, pants: 0x222233, apron: null },       // dark blue
  { shirt: 0xbb8844, pants: 0x443322, apron: 0xf5f0e0 },  // brown vest + white apron
  { shirt: 0xaa3355, pants: 0x333344, apron: 0xfecc02 },  // burgundy + yellow apron
  { shirt: 0x66aa88, pants: 0x445544, apron: null },       // teal
];

const villagerHairColors = [0xe8c84a, 0xd4a530, 0xb87333, 0x8b4513, 0xc9b89a, 0xf0d080, 0xaa6622, 0x222222, 0xcc8844, 0xf5deb3];

function createVillager(px, pz, outfitIdx) {
  const group = new THREE.Group();
  const outfit = villagerOutfits[outfitIdx % villagerOutfits.length];
  const hairColor = villagerHairColors[Math.floor(Math.random() * villagerHairColors.length)];
  const isFemale = Math.random() > 0.45;

  const skinMat = new THREE.MeshPhongMaterial({ color: 0xffddb0, flatShading: true });
  const shirtMat = new THREE.MeshPhongMaterial({ color: outfit.shirt, flatShading: true });
  const pantsMat = new THREE.MeshPhongMaterial({ color: outfit.pants, flatShading: true });
  const hairMat = new THREE.MeshPhongMaterial({ color: hairColor, flatShading: true });
  const eyeMat = new THREE.MeshPhongMaterial({ color: 0x3388cc });
  const pupilMat = new THREE.MeshPhongMaterial({ color: 0x111111 });
  const bootMat = new THREE.MeshPhongMaterial({ color: 0x554433, flatShading: true });
  const smileMat = new THREE.MeshPhongMaterial({ color: 0xcc5555 });

  // Head
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), skinMat);
  head.position.y = 2.7;
  head.castShadow = true;
  group.add(head);

  // Nose
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.12, 4), skinMat);
  nose.position.set(0, 2.68, 0.48);
  nose.rotation.x = -0.3;
  group.add(nose);

  // Ears
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.1, 5, 4), skinMat);
    ear.position.set(side * 0.45, 2.72, 0);
    ear.scale.set(0.5, 0.8, 0.6);
    group.add(ear);
  }

  // Hair — 4 styles
  const hairStyle = Math.floor(Math.random() * 4);
  if (hairStyle === 0) {
    // Long flowing hair
    const hairTop = new THREE.Mesh(new THREE.SphereGeometry(0.53, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.6), hairMat);
    hairTop.position.y = 2.75;
    group.add(hairTop);
    const hairBack = new THREE.Mesh(new THREE.BoxGeometry(0.75, 1.0, 0.3), hairMat);
    hairBack.position.set(0, 2.3, -0.3);
    group.add(hairBack);
    // Side strands
    for (const side of [-1, 1]) {
      const strand = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.7, 0.2), hairMat);
      strand.position.set(side * 0.4, 2.5, 0.05);
      group.add(strand);
    }
  } else if (hairStyle === 1) {
    // Braided pigtails
    const hairTop = new THREE.Mesh(new THREE.SphereGeometry(0.53, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), hairMat);
    hairTop.position.y = 2.75;
    group.add(hairTop);
    for (const side of [-1, 1]) {
      for (let b = 0; b < 4; b++) {
        const braid = new THREE.Mesh(new THREE.SphereGeometry(0.08, 5, 4), hairMat);
        braid.position.set(side * 0.4, 2.5 - b * 0.2, -0.2);
        group.add(braid);
      }
    }
  } else if (hairStyle === 2) {
    // Short cropped
    const hairTop = new THREE.Mesh(new THREE.SphereGeometry(0.52, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.45), hairMat);
    hairTop.position.y = 2.78;
    group.add(hairTop);
  } else {
    // Spiky/messy short
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const spike = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.07, 0.2 + Math.random() * 0.15, 3), hairMat);
      spike.position.set(Math.sin(a) * 0.35, 3.0 + Math.random() * 0.05, Math.cos(a) * 0.35);
      spike.rotation.x = Math.cos(a) * 0.35;
      spike.rotation.z = Math.sin(a) * 0.35;
      group.add(spike);
    }
  }

  // Eyes with pupils and whites
  for (const side of [-1, 1]) {
    const eyeWhite = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 5), new THREE.MeshPhongMaterial({ color: 0xffffff }));
    eyeWhite.position.set(side * 0.17, 2.75, 0.42);
    group.add(eyeWhite);
    const iris = new THREE.Mesh(new THREE.SphereGeometry(0.05, 5, 4), eyeMat);
    iris.position.set(side * 0.17, 2.75, 0.47);
    group.add(iris);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.025, 4, 3), pupilMat);
    pupil.position.set(side * 0.17, 2.75, 0.49);
    group.add(pupil);
  }

  // Eyebrows
  const browMat = new THREE.MeshPhongMaterial({ color: hairColor, flatShading: true });
  for (const side of [-1, 1]) {
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.03, 0.04), browMat);
    brow.position.set(side * 0.17, 2.87, 0.43);
    group.add(brow);
  }

  // Smile
  const smile = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.025, 4, 8, Math.PI), smileMat);
  smile.position.set(0, 2.57, 0.45);
  smile.rotation.x = Math.PI;
  group.add(smile);

  // Rosy cheeks
  const cheekMat = new THREE.MeshPhongMaterial({ color: 0xffaaaa, transparent: true, opacity: 0.4 });
  for (const side of [-1, 1]) {
    const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.08, 5, 4), cheekMat);
    cheek.position.set(side * 0.3, 2.62, 0.35);
    group.add(cheek);
  }

  // Neck
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.18, 0.2, 6), skinMat);
  neck.position.y = 2.3;
  group.add(neck);

  // Torso
  const torsoW = isFemale ? 0.40 : 0.45;
  const torsoB = isFemale ? 0.30 : 0.35;
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(torsoW, torsoB, 1.0, 8), shirtMat);
  torso.position.y = 1.8;
  torso.castShadow = true;
  group.add(torso);

  // Collar
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.04, 4, 8, Math.PI), shirtMat);
  collar.position.set(0, 2.25, 0.1);
  collar.rotation.x = -0.5;
  group.add(collar);

  // Apron (if outfit has one)
  if (outfit.apron) {
    const apronMat = new THREE.MeshPhongMaterial({ color: outfit.apron, flatShading: true });
    const apron = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.7, 0.05), apronMat);
    apron.position.set(0, 1.65, torsoW * 0.85);
    group.add(apron);
    // Apron strings
    for (const side of [-1, 1]) {
      const str = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.04, 0.35), apronMat);
      str.position.set(side * 0.28, 1.95, torsoW * 0.4);
      group.add(str);
    }
  }

  // Skirt for female characters (over pants)
  if (isFemale && Math.random() > 0.3) {
    const skirtMat = new THREE.MeshPhongMaterial({ color: outfit.pants, flatShading: true });
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.45, 0.5, 8), skirtMat);
    skirt.position.y = 1.15;
    group.add(skirt);
  }

  // Hat (30% chance)
  if (Math.random() < 0.3) {
    const hatMat = new THREE.MeshPhongMaterial({ color: Math.random() > 0.5 ? 0x554433 : outfit.shirt, flatShading: true });
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.05, 10), hatMat);
    brim.position.y = 3.15;
    group.add(brim);
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.35, 0.3, 8), hatMat);
    crown.position.y = 3.3;
    group.add(crown);
  }
  // Flower crown (20% of those without hats)
  else if (Math.random() < 0.2) {
    const crownBase = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.03, 4, 12), new THREE.MeshPhongMaterial({ color: 0x228822, flatShading: true }));
    crownBase.position.y = 3.1;
    crownBase.rotation.x = Math.PI / 2;
    group.add(crownBase);
    const fCols = [0xffdd33, 0x3366cc, 0xff6688, 0xffffff];
    for (let i = 0; i < 6; i++) {
      const fa = (i / 6) * Math.PI * 2;
      const fc = new THREE.Mesh(new THREE.SphereGeometry(0.06, 4, 3), new THREE.MeshPhongMaterial({ color: fCols[i % fCols.length] }));
      fc.position.set(Math.cos(fa) * 0.4, 3.1, Math.sin(fa) * 0.4);
      group.add(fc);
    }
  }

  // Arms (higher poly)
  const leftArmPivot = new THREE.Group();
  leftArmPivot.position.set(-0.52, 2.15, 0);
  const lua = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.10, 0.5, 6), shirtMat);
  lua.position.y = -0.25;
  leftArmPivot.add(lua);
  const leftElbow = new THREE.Group();
  leftElbow.position.y = -0.5;
  const lfa = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.08, 0.45, 6), skinMat);
  lfa.position.y = -0.225;
  leftElbow.add(lfa);
  const lh = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), skinMat);
  lh.position.y = -0.5;
  leftElbow.add(lh);
  leftArmPivot.add(leftElbow);
  group.add(leftArmPivot);

  const rightArmPivot = new THREE.Group();
  rightArmPivot.position.set(0.52, 2.15, 0);
  const rua = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.10, 0.5, 6), shirtMat);
  rua.position.y = -0.25;
  rightArmPivot.add(rua);
  const rightElbow = new THREE.Group();
  rightElbow.position.y = -0.5;
  const rfa = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.08, 0.45, 6), skinMat);
  rfa.position.y = -0.225;
  rightElbow.add(rfa);
  const rh = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), skinMat);
  rh.position.y = -0.5;
  rightElbow.add(rh);
  rightArmPivot.add(rightElbow);
  group.add(rightArmPivot);

  // Belt
  const beltMat = new THREE.MeshPhongMaterial({ color: 0x443322, flatShading: true });
  const belt = new THREE.Mesh(new THREE.CylinderGeometry(torsoB + 0.02, torsoB + 0.02, 0.08, 8), beltMat);
  belt.position.y = 1.32;
  group.add(belt);
  // Belt buckle
  const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.03), new THREE.MeshPhongMaterial({ color: 0xccaa44 }));
  buckle.position.set(0, 1.32, torsoB + 0.03);
  group.add(buckle);

  // Legs (higher poly)
  const leftLegPivot = new THREE.Group();
  leftLegPivot.position.set(-0.18, 1.15, 0);
  const lt = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.12, 0.5, 6), pantsMat);
  lt.position.y = -0.25;
  leftLegPivot.add(lt);
  const leftKnee = new THREE.Group();
  leftKnee.position.y = -0.5;
  const ls = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.10, 0.45, 6), pantsMat);
  ls.position.y = -0.225;
  leftKnee.add(ls);
  const lf = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.10, 0.30), bootMat);
  lf.position.set(0, -0.50, 0.04);
  leftKnee.add(lf);
  // Boot cuff
  const lbc = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.12, 0.06, 6), bootMat);
  lbc.position.y = -0.42;
  leftKnee.add(lbc);
  leftLegPivot.add(leftKnee);
  group.add(leftLegPivot);

  const rightLegPivot = new THREE.Group();
  rightLegPivot.position.set(0.18, 1.15, 0);
  const rt = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.12, 0.5, 6), pantsMat);
  rt.position.y = -0.25;
  rightLegPivot.add(rt);
  const rightKnee = new THREE.Group();
  rightKnee.position.y = -0.5;
  const rs = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.10, 0.45, 6), pantsMat);
  rs.position.y = -0.225;
  rightKnee.add(rs);
  const rf = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.10, 0.30), bootMat);
  rf.position.set(0, -0.50, 0.04);
  rightKnee.add(rf);
  const rbc = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.12, 0.06, 6), bootMat);
  rbc.position.y = -0.42;
  rightKnee.add(rbc);
  rightLegPivot.add(rightKnee);
  group.add(rightLegPivot);

  // Scale to visible size (~6 units tall like pilot)
  group.scale.set(2, 2, 2);

  const py = getExactGroundHeight(px, pz);
  group.position.set(px, py, pz);
  group.rotation.y = Math.random() * Math.PI * 2;
  scene.add(group);

  return {
    group,
    leftArmPivot, rightArmPivot,
    leftElbow, rightElbow,
    leftLegPivot, rightLegPivot,
    leftKnee, rightKnee,
  };
}

function spawnVillagers() {
  // Remove old villagers
  for (const v of villagers) scene.remove(v.group);
  villagers.length = 0;

  const villageCenters = [
    { cx: 500, cz: -500 },
    { cx: -1500, cz: 1000 },
    { cx: 2000, cz: 2000 },
  ];

  let outfitIdx = 0;

  function makeVillagerEntry(vx, vz, homeX, homeZ) {
    const parts = createVillager(vx, vz, outfitIdx++);
    const behavior = Math.random();
    let type;
    if (behavior < 0.45) type = "wander";
    else if (behavior < 0.75) type = "chat";
    else type = "sit";
    return {
      ...parts,
      homeX, homeZ,
      type, baseType: type,
      wanderDir: Math.random() * Math.PI * 2,
      wanderTimer: 2 + Math.random() * 4,
      walkSpeed: 8 + Math.random() * 8,
      phase: Math.random() * Math.PI * 2,
      gestureTimer: Math.random() * 3,
      chatPartner: null,
      waveTimer: 0,
      followingPilot: false,
      dancingMaypole: false,
      danceAngle: Math.random() * Math.PI * 2,
      greetTarget: null,
      greetTimer: 0,
    };
  }

  // ~25 villagers per village (75 total from villages)
  for (const vc of villageCenters) {
    const villageVillagers = [];
    const count = 23 + Math.floor(Math.random() * 5); // 23-27
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 10 + Math.random() * 90;
      const vx = vc.cx + Math.cos(angle) * dist;
      const vz = vc.cz + Math.sin(angle) * dist;
      const vy = getTerrainHeight(vx, vz);
      if (vy < -10 || vy > 80) continue;

      const entry = makeVillagerEntry(vx, vz, vc.cx, vc.cz);
      villagers.push(entry);
      villageVillagers.push(entry);
    }

    // Pair up chatters to face each other
    const chatters = villageVillagers.filter(v => v.type === "chat");
    for (let i = 0; i + 1 < chatters.length; i += 2) {
      const a = chatters[i], b = chatters[i + 1];
      a.chatPartner = b;
      b.chatPartner = a;
      const mx = (a.group.position.x + b.group.position.x) / 2;
      const mz = (a.group.position.z + b.group.position.z) / 2;
      const my = getExactGroundHeight(mx, mz);
      a.group.position.set(mx - 2, my, mz);
      b.group.position.set(mx + 2, my, mz);
      a.group.rotation.y = Math.PI / 2;
      b.group.rotation.y = -Math.PI / 2;
    }
  }

  // ~25 scattered villagers near farmsteads and meadows
  const scatterPoints = [
    { x: 800, z: 200 }, { x: -600, z: -800 }, { x: 1200, z: -1200 },
    { x: -2000, z: -500 }, { x: 1500, z: 500 }, { x: -800, z: 2200 },
    { x: 300, z: 1500 }, { x: -1000, z: -200 }, { x: 2500, z: 800 },
    { x: -300, z: 600 }, { x: 1800, z: -600 }, { x: -1200, z: 1800 },
    { x: 600, z: -1500 }, { x: -500, z: 300 }, { x: 1000, z: 2500 },
    { x: -1800, z: -1000 }, { x: 2200, z: 1500 }, { x: -400, z: -1200 },
    { x: 700, z: 800 }, { x: -900, z: 500 }, { x: 1600, z: 1200 },
    { x: -1400, z: -600 }, { x: 400, z: -300 }, { x: -200, z: 1000 },
    { x: 1100, z: -900 },
  ];
  for (const sp of scatterPoints) {
    const vx = sp.x + (Math.random() - 0.5) * 40;
    const vz = sp.z + (Math.random() - 0.5) * 40;
    const vy = getTerrainHeight(vx, vz);
    if (vy < -10 || vy > 80) continue;
    const entry = makeVillagerEntry(vx, vz, sp.x, sp.z);
    villagers.push(entry);
  }
}

spawnVillagers();

function updateVillagers(t) {
  const pilotOnGround = controlMode === "walking" && player.onGround && !player.swimming;
  const px = player.position.x;
  const pz = player.position.z;

  // ── Pairwise separation between detailed villagers ──
  const SEP_DIST = 3.0;
  const SEP_FORCE = 12;
  for (let i = 0; i < villagers.length; i++) {
    const a = villagers[i];
    if (a.type === "sit") continue;
    for (let j = i + 1; j < villagers.length; j++) {
      const b = villagers[j];
      if (b.type === "sit") continue;
      const ddx = a.group.position.x - b.group.position.x;
      const ddz = a.group.position.z - b.group.position.z;
      const dd = Math.sqrt(ddx * ddx + ddz * ddz);
      if (dd < SEP_DIST && dd > 0.01) {
        const push = (SEP_DIST - dd) / SEP_DIST * SEP_FORCE * t;
        const nx = (ddx / dd) * push;
        const nz = (ddz / dd) * push;
        a.group.position.x += nx;
        a.group.position.z += nz;
        b.group.position.x -= nx;
        b.group.position.z -= nz;
        const ay = getTerrainHeight(a.group.position.x, a.group.position.z);
        const by = getTerrainHeight(b.group.position.x, b.group.position.z);
        if (a.type !== "sit") a.group.position.y = ay;
        if (b.type !== "sit") b.group.position.y = by;
      }
    }
  }

  for (let vi = 0; vi < villagers.length; vi++) {
    const v = villagers[vi];
    v.phase += t * 6;
    const s = Math.sin(v.phase);
    const vx = v.group.position.x;
    const vz = v.group.position.z;

    // ── Distance to pilot ──
    const dxP = px - vx;
    const dzP = pz - vz;
    const distToPilot = Math.sqrt(dxP * dxP + dzP * dzP);

    // ── Check proximity to maypoles ──
    let nearMaypolePos = null;
    for (const mp of maypolePositions) {
      const mdx = vx - mp.x, mdz = vz - mp.z;
      if (Math.sqrt(mdx * mdx + mdz * mdz) < 50) { nearMaypolePos = mp; break; }
    }

    // ── Decide current behavior (priority system) ──

    // Priority 1: Join maypole dance if pilot is dancing nearby
    if (nearMaypolePos && player.nearMaypole && distToPilot < 80) {
      v.dancingMaypole = true;
      v.followingPilot = false;
      v.waveTimer = 0;
    }
    // Priority 2: Wave at pilot when first spotted nearby (25-40 units)
    else if (pilotOnGround && distToPilot < 40 && distToPilot > 10 && v.waveTimer <= 0 && !v.followingPilot) {
      v.waveTimer = 2.0; // wave for 2 seconds
      v.dancingMaypole = false;
    }
    // Priority 3: Follow pilot if very close (< 20 units) and on ground
    else if (pilotOnGround && distToPilot < 20 && distToPilot > 5 && v.baseType === "wander") {
      v.followingPilot = true;
      v.dancingMaypole = false;
    }
    // Return to base behavior when pilot is far
    else if (distToPilot > 50) {
      v.followingPilot = false;
      v.dancingMaypole = false;
    }

    // ── Greet other villagers when passing nearby ──
    if (!v.greetTarget && v.baseType === "wander" && !v.followingPilot && !v.dancingMaypole) {
      for (let oi = vi + 1; oi < villagers.length; oi++) {
        const o = villagers[oi];
        if (o === v || o.chatPartner === v) continue;
        const odx = o.group.position.x - vx;
        const odz = o.group.position.z - vz;
        const oDist = Math.sqrt(odx * odx + odz * odz);
        if (oDist < 12 && oDist > 3 && !o.greetTarget && o.greetTimer <= 0) {
          v.greetTarget = o;
          o.greetTarget = v;
          v.greetTimer = 1.5;
          o.greetTimer = 1.5;
          break;
        }
      }
    }

    // Tick greet timer
    if (v.greetTimer > 0) {
      v.greetTimer -= t;
      if (v.greetTimer <= 0) {
        v.greetTarget = null;
      }
    }

    // ══════════════════════════════════════════
    // ── Animate based on current state ──
    // ══════════════════════════════════════════

    // ── Maypole Dance ──
    if (v.dancingMaypole && nearMaypolePos) {
      v.danceAngle += 1.2 * t;
      const danceR = 22 + (vi % 4) * 3; // stagger radii so they don't overlap
      v.group.position.x = nearMaypolePos.x + Math.cos(v.danceAngle) * danceR;
      v.group.position.z = nearMaypolePos.z + Math.sin(v.danceAngle) * danceR;
      v.group.position.y = getTerrainHeight(v.group.position.x, v.group.position.z);
      v.group.rotation.y = v.danceAngle + Math.PI / 2;

      // Dance animation: arms raised, bouncing legs
      v.leftArmPivot.rotation.x = -2.5;
      v.rightArmPivot.rotation.x = -2.5;
      v.leftArmPivot.rotation.z = -0.4 + s * 0.25;
      v.rightArmPivot.rotation.z = 0.4 - s * 0.25;
      v.leftElbow.rotation.x = -0.3;
      v.rightElbow.rotation.x = -0.3;
      v.leftLegPivot.rotation.x = -s * 0.6;
      v.rightLegPivot.rotation.x = s * 0.6;
      v.leftKnee.rotation.x = Math.max(0, s) * 0.8;
      v.rightKnee.rotation.x = Math.max(0, -s) * 0.8;
      v.group.rotation.z = 0;
      continue;
    }

    // ── Waving at pilot ──
    if (v.waveTimer > 0) {
      v.waveTimer -= t;
      // Face pilot
      v.group.rotation.y = Math.atan2(dxP, dzP);

      // Right arm waves overhead
      v.rightArmPivot.rotation.x = -2.8;
      v.rightArmPivot.rotation.z = 0.3 + Math.sin(v.phase * 4) * 0.4;
      v.rightElbow.rotation.x = -0.2 + Math.sin(v.phase * 5) * 0.3;
      // Left arm at side
      v.leftArmPivot.rotation.x *= 0.85;
      v.leftArmPivot.rotation.z *= 0.85;
      v.leftElbow.rotation.x *= 0.85;
      // Legs still
      v.leftLegPivot.rotation.x *= 0.9;
      v.rightLegPivot.rotation.x *= 0.9;
      v.leftKnee.rotation.x *= 0.9;
      v.rightKnee.rotation.x *= 0.9;
      continue;
    }

    // ── Following pilot ──
    if (v.followingPilot && pilotOnGround) {
      // Walk toward pilot but stop at ~6 units
      if (distToPilot > 6) {
        const toAngle = Math.atan2(dxP, dzP);
        v.wanderDir = toAngle;
        const spd = v.walkSpeed * 1.4; // a bit eager
        const nx = vx + Math.sin(toAngle) * spd * t;
        const nz = vz + Math.cos(toAngle) * spd * t;
        const ny = getTerrainHeight(nx, nz);
        if (ny > -10 && ny < 80) {
          v.group.position.set(nx, ny, nz);
        }
        v.group.rotation.y = toAngle;

        // Walk animation
        v.leftArmPivot.rotation.x = s * 0.5;
        v.rightArmPivot.rotation.x = -s * 0.5;
        v.leftElbow.rotation.x = -Math.abs(s) * 0.25;
        v.rightElbow.rotation.x = -Math.abs(s) * 0.25;
        v.leftLegPivot.rotation.x = -s * 0.4;
        v.rightLegPivot.rotation.x = s * 0.4;
        v.leftKnee.rotation.x = Math.max(0, s) * 0.5;
        v.rightKnee.rotation.x = Math.max(0, -s) * 0.5;
        v.leftArmPivot.rotation.z = 0;
        v.rightArmPivot.rotation.z = 0;
      } else {
        // Near pilot: stand and face, gentle happy bounce
        v.group.rotation.y = Math.atan2(dxP, dzP);
        v.leftArmPivot.rotation.x = Math.sin(v.phase * 0.8) * 0.1;
        v.rightArmPivot.rotation.x = Math.sin(v.phase * 0.8 + 1) * 0.1;
        v.leftArmPivot.rotation.z = 0;
        v.rightArmPivot.rotation.z = 0;
        v.leftElbow.rotation.x *= 0.9;
        v.rightElbow.rotation.x *= 0.9;
        v.leftLegPivot.rotation.x *= 0.9;
        v.rightLegPivot.rotation.x *= 0.9;
        v.leftKnee.rotation.x *= 0.9;
        v.rightKnee.rotation.x *= 0.9;
      }
      continue;
    }

    // ── Greeting another villager in passing ──
    if (v.greetTarget && v.greetTimer > 0) {
      const gx = v.greetTarget.group.position.x;
      const gz = v.greetTarget.group.position.z;
      // Face the other villager
      v.group.rotation.y = Math.atan2(gx - vx, gz - vz);
      // Small wave
      v.rightArmPivot.rotation.x = -2.0;
      v.rightArmPivot.rotation.z = 0.2 + Math.sin(v.phase * 4) * 0.3;
      v.rightElbow.rotation.x = -0.1;
      v.leftArmPivot.rotation.x *= 0.9;
      v.leftArmPivot.rotation.z *= 0.9;
      v.leftElbow.rotation.x *= 0.9;
      v.leftLegPivot.rotation.x *= 0.9;
      v.rightLegPivot.rotation.x *= 0.9;
      v.leftKnee.rotation.x *= 0.9;
      v.rightKnee.rotation.x *= 0.9;
      continue;
    }

    // ══════════════════════════════════════════
    // ── Base behaviors (no special interaction) ──
    // ══════════════════════════════════════════

    if (v.type === "wander") {
      v.wanderTimer -= t;
      if (v.wanderTimer <= 0) {
        v.wanderDir += (Math.random() - 0.5) * 2.0;
        v.wanderTimer = 2 + Math.random() * 5;
      }

      const nx = vx + Math.sin(v.wanderDir) * v.walkSpeed * t;
      const nz = vz + Math.cos(v.wanderDir) * v.walkSpeed * t;

      // Stay near village
      const dxH = nx - v.homeX;
      const dzH = nz - v.homeZ;
      if (Math.sqrt(dxH * dxH + dzH * dzH) > 100) {
        v.wanderDir = Math.atan2(v.homeX - vx, v.homeZ - vz);
        v.wanderTimer = 2;
      }

      const ny = getTerrainHeight(nx, nz);
      if (ny > -10 && ny < 80) {
        v.group.position.set(nx, ny, nz);
      } else {
        v.wanderDir += Math.PI;
      }
      v.group.rotation.y = v.wanderDir;

      // Walk animation
      v.leftArmPivot.rotation.x = s * 0.5;
      v.rightArmPivot.rotation.x = -s * 0.5;
      v.leftElbow.rotation.x = -Math.abs(s) * 0.25;
      v.rightElbow.rotation.x = -Math.abs(s) * 0.25;
      v.leftLegPivot.rotation.x = -s * 0.4;
      v.rightLegPivot.rotation.x = s * 0.4;
      v.leftKnee.rotation.x = Math.max(0, s) * 0.5;
      v.rightKnee.rotation.x = Math.max(0, -s) * 0.5;
      v.leftArmPivot.rotation.z = 0;
      v.rightArmPivot.rotation.z = 0;

    } else if (v.type === "chat") {
      // Face chat partner if available
      if (v.chatPartner) {
        const cp = v.chatPartner;
        v.group.rotation.y = Math.atan2(
          cp.group.position.x - vx,
          cp.group.position.z - vz
        );
      }

      v.gestureTimer -= t;
      if (v.gestureTimer <= 0) {
        v.gestureTimer = 1.5 + Math.random() * 3;
      }
      const gesturing = v.gestureTimer < 1.0;

      v.leftLegPivot.rotation.x *= 0.9;
      v.rightLegPivot.rotation.x *= 0.9;
      v.leftKnee.rotation.x *= 0.9;
      v.rightKnee.rotation.x *= 0.9;

      if (gesturing) {
        // Alternate which arm gestures (based on vi parity for variety)
        if (vi % 2 === 0) {
          v.rightArmPivot.rotation.x = -0.8 + Math.sin(v.phase * 2) * 0.4;
          v.rightArmPivot.rotation.z = 0.3;
          v.rightElbow.rotation.x = -0.5 + Math.sin(v.phase * 3) * 0.2;
          v.leftArmPivot.rotation.x *= 0.9;
          v.leftArmPivot.rotation.z *= 0.9;
          v.leftElbow.rotation.x *= 0.9;
        } else {
          v.leftArmPivot.rotation.x = -0.8 + Math.sin(v.phase * 2) * 0.4;
          v.leftArmPivot.rotation.z = -0.3;
          v.leftElbow.rotation.x = -0.5 + Math.sin(v.phase * 3) * 0.2;
          v.rightArmPivot.rotation.x *= 0.9;
          v.rightArmPivot.rotation.z *= 0.9;
          v.rightElbow.rotation.x *= 0.9;
        }
      } else {
        // Listening: slight nod and body sway
        v.leftArmPivot.rotation.x = Math.sin(v.phase * 0.5) * 0.05;
        v.rightArmPivot.rotation.x = Math.sin(v.phase * 0.5 + 1) * 0.05;
        v.leftArmPivot.rotation.z = 0;
        v.rightArmPivot.rotation.z = 0;
        v.leftElbow.rotation.x *= 0.9;
        v.rightElbow.rotation.x *= 0.9;
      }

      v.group.rotation.z = Math.sin(v.phase * 0.3) * 0.02;

    } else if (v.type === "sit") {
      // Sitting — look at pilot if nearby
      if (pilotOnGround && distToPilot < 30) {
        v.group.rotation.y = Math.atan2(dxP, dzP);
        // Wave from sitting position
        v.rightArmPivot.rotation.x = -1.5 + Math.sin(v.phase * 3) * 0.3;
        v.rightArmPivot.rotation.z = 0.2;
        v.rightElbow.rotation.x = -0.2;
      } else {
        v.rightArmPivot.rotation.x = -0.6;
        v.rightArmPivot.rotation.z = 0;
        v.rightElbow.rotation.x = -0.4;
      }
      v.leftLegPivot.rotation.x = -1.2;
      v.rightLegPivot.rotation.x = -1.2;
      v.leftKnee.rotation.x = 1.3;
      v.rightKnee.rotation.x = 1.3;
      v.leftArmPivot.rotation.x = -0.6;
      v.leftArmPivot.rotation.z = 0;
      v.leftElbow.rotation.x = -0.4;
      v.group.position.y = getTerrainHeight(v.group.position.x, v.group.position.z) - 1.2;
    }
  }
}


// ─── Exhaust System (pooled) ────────────────────────────────
const EX_POOL_SIZE = 80;
const exGeo = new THREE.SphereGeometry(1, 3, 2);
const exPool = [];
const exActive = [];

for (let i = 0; i < EX_POOL_SIZE; i++) {
  const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 });
  const mesh = new THREE.Mesh(exGeo, mat);
  mesh.visible = false;
  scene.add(mesh);
  exPool.push({ mesh, mat, velocity: new THREE.Vector3(), life: 0, maxLife: 0, baseScale: 0 });
}

function updateExhaust(t) {
  const rate = 5 + flight.throttle * 40 + (flight.boost ? 30 : 0);
  const count = Math.ceil(rate * t);

  for (let i = 0; i < count && exPool.length > 0; i++) {
    const p = exPool.pop();
    // Position behind center
    p.mesh.position.copy(flight.position);
    p.mesh.position.addScaledVector(forward, -18);
    p.mesh.position.x += (Math.random() - 0.5) * 2;
    p.mesh.position.y += (Math.random() - 0.5) * 2;
    p.mesh.position.z += (Math.random() - 0.5) * 2;

    const color = flight.boost
      ? (Math.random() > 0.5 ? 0x4488ff : 0xaaddff)
      : (Math.random() > 0.3 ? 0xff6600 : 0xff9933);
    p.mat.color.setHex(color);
    p.mat.opacity = 0.7;
    p.baseScale = 0.4 + flight.throttle * 0.6 + (flight.boost ? 0.5 : 0);
    p.mesh.scale.setScalar(p.baseScale);
    p.mesh.visible = true;

    p.velocity.copy(forward).multiplyScalar(-15 - Math.random() * 10);
    p.velocity.y += Math.random() * 4;
    p.velocity.x += (Math.random() - 0.5) * 5;
    p.velocity.z += (Math.random() - 0.5) * 5;

    p.life = 0.3 + Math.random() * 0.5;
    p.maxLife = 0.8;
    exActive.push(p);
  }

  for (let i = exActive.length - 1; i >= 0; i--) {
    const p = exActive[i];
    p.life -= t;
    p.mesh.position.addScaledVector(p.velocity, t);
    const age = 1 - p.life / p.maxLife;
    p.mat.opacity = Math.max(0, (1 - age) * 0.7);
    p.mesh.scale.setScalar(p.baseScale + age * p.baseScale * 3);

    if (p.life <= 0) {
      p.mesh.visible = false;
      exActive[i] = exActive[exActive.length - 1];
      exActive.pop();
      exPool.push(p);
    }
  }
}

function clearExhaust() {
  for (let i = exActive.length - 1; i >= 0; i--) {
    const p = exActive[i];
    p.mesh.visible = false;
    exPool.push(p);
  }
  exActive.length = 0;
}

// ─── Machinegun System ──────────────────────────────────────
const FIRE_RATE = 10;       // rounds per second
const BULLET_SPEED = 500;   // units/s
const BULLET_LIFE = 2.0;    // seconds
const bullets = [];
const explosionParticles = [];
let fireTimer = 0;
let firing = false;
let targetsDestroyed = 0;

const bulletGeo = new THREE.SphereGeometry(1.2, 4, 4);
const bulletMat = new THREE.MeshBasicMaterial({ color: 0xffff44 });

function fireBullet() {
  const side = bullets.length % 2 === 0 ? -1 : 1;
  const mesh = new THREE.Mesh(bulletGeo, bulletMat);

  if (controlMode === "walking") {
    // Fire from player's chest level in camera-look direction
    const camFwd = new THREE.Vector3(
      -Math.sin(mouse.yaw) * Math.cos(mouse.pitch),
      -Math.sin(mouse.pitch),
      -Math.cos(mouse.yaw) * Math.cos(mouse.pitch)
    ).normalize();
    mesh.position.set(player.position.x, player.position.y + 8, player.position.z);
    scene.add(mesh);
    const vel = camFwd.multiplyScalar(BULLET_SPEED);
    bullets.push({ mesh, velocity: vel, life: BULLET_LIFE });
  } else {
    mesh.position.copy(flight.position)
      .addScaledVector(forward, 20)
      .addScaledVector(right, side * 8)
      .addScaledVector(up, -3);
    scene.add(mesh);
    const vel = new THREE.Vector3().copy(forward).multiplyScalar(BULLET_SPEED).add(flight.velocity);
    bullets.push({ mesh, velocity: vel, life: BULLET_LIFE });
  }
  playGunSound();
}

function updateBullets(t) {
  // Firing
  if (firing && state === "playing") {
    fireTimer -= t;
    if (fireTimer <= 0) {
      fireBullet();
      fireTimer = 1 / FIRE_RATE;
    }
  } else {
    fireTimer = 0;
  }

  // Move & collide bullets
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.life -= t;
    b.mesh.position.addScaledVector(b.velocity, t);

    // Ground collision
    const bTerrH = getTerrainHeight(b.mesh.position.x, b.mesh.position.z);
    if (b.mesh.position.y < Math.max(bTerrH, -40)) {
      spawnExplosion(b.mesh.position, 4);
      b.life = 0;
    }

    // Target collision
    if (b.life > 0) {
      for (let j = 0; j < targets.length; j++) {
        const tgt = targets[j];
        if (tgt.destroyed) continue;
        if (b.mesh.position.distanceTo(tgt.group.position) < 12) {
          tgt.destroyed = true;
          targetsDestroyed++;
          score += 200;
          spawnExplosion(tgt.group.position, 20);
          playExplosionSound();
          scene.remove(tgt.group);
          b.life = 0;
          break;
        }
      }
    }

    // Zombie collision
    if (b.life > 0) {
      for (let j = 0; j < zombies.length; j++) {
        const z = zombies[j];
        if (z.destroyed || z.dying) continue;
        tmpVec2.copy(z.group.position);
        tmpVec2.y += 750;
        if (b.mesh.position.distanceTo(tmpVec2) < 500) {
          z.hp--;
          spawnExplosion(b.mesh.position, 6);
          b.life = 0;
          if (z.hp <= 0 && !z.dying) {
            z.dying = true;
            z.deathTimer = 0;
            zombiesKilled++;
            score += 500;
            pilotCheerTimer = 3; // pilot celebrates for 3 seconds
            tmpVec2.copy(z.group.position).setY(z.group.position.y + 750);
            spawnExplosion(tmpVec2, 80);
            playExplosionSound();
          }
          break;
        }
      }
    }

    if (b.life <= 0) {
      scene.remove(b.mesh);
      bullets[i] = bullets[bullets.length - 1];
      bullets.pop();
    }
  }
}

function spawnExplosion(pos, size) {
  const count = size > 10 ? 15 : 5;
  for (let i = 0; i < count; i++) {
    const r = 0.5 + Math.random() * size * 0.15;
    const geo = new THREE.SphereGeometry(r, 4, 4);
    const color = Math.random() > 0.5 ? 0xff4400 : 0xffaa00;
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    scene.add(mesh);

    explosionParticles.push({
      mesh, geo, mat,
      velocity: new THREE.Vector3(
        (Math.random() - 0.5) * size * 3,
        Math.random() * size * 2 + 5,
        (Math.random() - 0.5) * size * 3
      ),
      life: 0.5 + Math.random() * 0.5,
      maxLife: 1.0,
    });
  }
}

function updateExplosions(t) {
  for (let i = explosionParticles.length - 1; i >= 0; i--) {
    const p = explosionParticles[i];
    p.life -= t;
    p.velocity.y -= 30 * t;
    p.mesh.position.addScaledVector(p.velocity, t);
    p.mat.opacity = Math.max(0, p.life / p.maxLife);

    if (p.life <= 0) {
      scene.remove(p.mesh);
      p.geo.dispose();
      p.mat.dispose();
      explosionParticles[i] = explosionParticles[explosionParticles.length - 1];
      explosionParticles.pop();
    }
  }
}

function clearBullets() {
  for (const b of bullets) scene.remove(b.mesh);
  bullets.length = 0;
  for (const p of explosionParticles) {
    scene.remove(p.mesh);
    p.geo.dispose();
    p.mat.dispose();
  }
  explosionParticles.length = 0;
  fireTimer = 0;
}

// ─── Ground Targets ─────────────────────────────────────────
const TARGET_COUNT = 15;
const targets = [];

function createTarget(x, y, z) {
  const group = new THREE.Group();

  const baseGeo = new THREE.CylinderGeometry(5, 5, 3, 8);
  const baseMat = new THREE.MeshPhongMaterial({ color: 0xff3333, emissive: 0x441111 });
  const base = new THREE.Mesh(baseGeo, baseMat);
  group.add(base);

  const topGeo = new THREE.TorusGeometry(4, 0.5, 6, 12);
  const topMat = new THREE.MeshPhongMaterial({ color: 0xff6600, emissive: 0x331100 });
  const top = new THREE.Mesh(topGeo, topMat);
  top.rotation.x = Math.PI / 2;
  top.position.y = 2;
  group.add(top);

  const poleGeo = new THREE.CylinderGeometry(0.3, 0.3, 8, 4);
  const poleMat = new THREE.MeshPhongMaterial({ color: 0x888888 });
  const pole = new THREE.Mesh(poleGeo, poleMat);
  pole.position.y = 5.5;
  group.add(pole);

  group.position.set(x, y, z);
  scene.add(group);
  return group;
}

function spawnTargets() {
  for (const t of targets) {
    scene.remove(t.group);
    t.group.traverse(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
  }
  targets.length = 0;

  for (let i = 0; i < TARGET_COUNT; i++) {
    const angle = (i / TARGET_COUNT) * Math.PI * 2 + 0.3;
    const radius = 500 + Math.random() * 2500;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const y = getTerrainHeight(x, z) + 1.5;
    if (y < -35) continue;

    const group = createTarget(x, y, z);
    targets.push({ group, destroyed: false });
  }
}

// ─── Giant Zombies ──────────────────────────────────────────
const ZOMBIE_COUNT = 1;
const zombies = [];
let zombiesKilled = 0;

function createZombie() {
  const group = new THREE.Group();
  const skinMat = new THREE.MeshPhongMaterial({ color: 0x4a7a3a, flatShading: true });
  const darkSkinMat = new THREE.MeshPhongMaterial({ color: 0x3a5a2a, flatShading: true });
  const clothMat = new THREE.MeshPhongMaterial({ color: 0x4a3a2a, flatShading: true });
  const boneMat = new THREE.MeshPhongMaterial({ color: 0xccccaa, flatShading: true });
  const mouthMat = new THREE.MeshPhongMaterial({ color: 0x2a1a1a });
  const nailMat = new THREE.MeshPhongMaterial({ color: 0x222222 });

  // ── Torso ──
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(4, 5.5, 20, 12), clothMat);
  torso.position.y = 30;
  torso.castShadow = true;
  group.add(torso);

  // Chest (broader upper)
  const chest = new THREE.Mesh(new THREE.SphereGeometry(6.5, 12, 10, 0, Math.PI * 2, 0, Math.PI / 2), clothMat);
  chest.position.y = 36;
  chest.castShadow = true;
  group.add(chest);

  // Pectoral muscles
  const pecGeo = new THREE.SphereGeometry(3.5, 8, 6);
  const pecL = new THREE.Mesh(pecGeo, clothMat);
  pecL.position.set(-3, 36, 3);
  pecL.scale.set(1, 0.7, 0.6);
  group.add(pecL);
  const pecR = new THREE.Mesh(pecGeo, clothMat);
  pecR.position.set(3, 36, 3);
  pecR.scale.set(1, 0.7, 0.6);
  group.add(pecR);

  // Belly (protruding gut)
  const belly = new THREE.Mesh(new THREE.SphereGeometry(5.5, 10, 8), darkSkinMat);
  belly.position.set(0, 25, 2);
  belly.scale.set(1, 0.9, 1.0);
  group.add(belly);

  // Spine bumps (visible through skin)
  for (let i = 0; i < 5; i++) {
    const bump = new THREE.Mesh(new THREE.SphereGeometry(1, 6, 4), darkSkinMat);
    bump.position.set(0, 24 + i * 4, -5);
    bump.scale.set(1.2, 0.6, 0.8);
    group.add(bump);
  }

  // Collarbone
  const collarGeo = new THREE.CylinderGeometry(0.5, 0.5, 12, 6);
  const collarL = new THREE.Mesh(collarGeo, skinMat);
  collarL.position.set(-4, 40, 2.5);
  collarL.rotation.z = Math.PI / 2 + 0.3;
  group.add(collarL);
  const collarR = new THREE.Mesh(collarGeo, skinMat);
  collarR.position.set(4, 40, 2.5);
  collarR.rotation.z = Math.PI / 2 - 0.3;
  group.add(collarR);

  // ── Head ──
  const head = new THREE.Mesh(new THREE.SphereGeometry(5.5, 12, 10), skinMat);
  head.position.y = 47;
  head.scale.set(1, 1.15, 1.05);
  head.castShadow = true;
  group.add(head);

  // Neck
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 3, 5, 8), skinMat);
  neck.position.y = 41;
  group.add(neck);

  // Brow ridge (heavy, overhanging)
  const brow = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.2, 2, 12, 1, false, 0, Math.PI), darkSkinMat);
  brow.position.set(0, 49.5, 2.5);
  brow.rotation.x = Math.PI / 2;
  group.add(brow);

  // Nose (bridge + nostrils)
  const noseBridge = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.2, 3.5, 6), skinMat);
  noseBridge.position.set(0, 46, 5.5);
  noseBridge.rotation.x = -0.2;
  group.add(noseBridge);
  const nostrilGeo = new THREE.SphereGeometry(0.8, 6, 4);
  const nostrilL = new THREE.Mesh(nostrilGeo, darkSkinMat);
  nostrilL.position.set(-0.7, 44.8, 6);
  group.add(nostrilL);
  const nostrilR = new THREE.Mesh(nostrilGeo, darkSkinMat);
  nostrilR.position.set(0.7, 44.8, 6);
  group.add(nostrilR);

  // Eye sockets (sunken dark areas)
  const socketGeo = new THREE.SphereGeometry(1.8, 8, 6);
  const socketMat = new THREE.MeshPhongMaterial({ color: 0x1a2a1a });
  const socketL = new THREE.Mesh(socketGeo, socketMat);
  socketL.position.set(-2.2, 47.5, 4.2);
  group.add(socketL);
  const socketR = new THREE.Mesh(socketGeo, socketMat);
  socketR.position.set(2.2, 47.5, 4.2);
  group.add(socketR);

  // Eyes (glowing red)
  const eyeGeo = new THREE.SphereGeometry(1.2, 8, 6);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
  const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
  eyeL.position.set(-2.2, 47.5, 4.8);
  group.add(eyeL);
  const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
  eyeR.position.set(2.2, 47.5, 4.8);
  group.add(eyeR);

  // Pupils
  const pupilGeo = new THREE.SphereGeometry(0.5, 6, 4);
  const pupilMat = new THREE.MeshBasicMaterial({ color: 0x440000 });
  const pupilL = new THREE.Mesh(pupilGeo, pupilMat);
  pupilL.position.set(-2.2, 47.5, 5.9);
  group.add(pupilL);
  const pupilR = new THREE.Mesh(pupilGeo, pupilMat);
  pupilR.position.set(2.2, 47.5, 5.9);
  group.add(pupilR);

  // Jaw (open, hanging)
  const jaw = new THREE.Mesh(new THREE.SphereGeometry(4.2, 10, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), darkSkinMat);
  jaw.position.set(0, 42.5, 1.5);
  jaw.scale.set(1, 0.8, 0.95);
  jaw.rotation.x = 0.15;
  group.add(jaw);

  // Mouth opening
  const mouth = new THREE.Mesh(new THREE.SphereGeometry(2.5, 8, 4), mouthMat);
  mouth.position.set(0, 43.5, 4.5);
  mouth.scale.set(1.2, 0.5, 0.6);
  group.add(mouth);

  // Teeth (upper row)
  const toothGeo = new THREE.ConeGeometry(0.4, 1.5, 4);
  for (let i = 0; i < 6; i++) {
    const angle = (i - 2.5) * 0.35;
    const tooth = new THREE.Mesh(toothGeo, boneMat);
    tooth.position.set(Math.sin(angle) * 2.5, 43.8, Math.cos(angle) * 0.8 + 4.5);
    tooth.rotation.x = Math.PI;
    group.add(tooth);
  }

  // Teeth (lower fangs)
  for (let i = 0; i < 4; i++) {
    const angle = (i - 1.5) * 0.5;
    const tooth = new THREE.Mesh(toothGeo, boneMat);
    tooth.position.set(Math.sin(angle) * 2, 42.5, Math.cos(angle) * 0.6 + 4.5);
    group.add(tooth);
  }

  // Ears
  const earGeo = new THREE.SphereGeometry(1.5, 6, 6);
  const earL = new THREE.Mesh(earGeo, skinMat);
  earL.position.set(-5.8, 47, 0);
  earL.scale.set(0.4, 1, 0.7);
  group.add(earL);
  const earR = new THREE.Mesh(earGeo, skinMat);
  earR.position.set(5.8, 47, 0);
  earR.scale.set(0.4, 1, 0.7);
  group.add(earR);

  // ── Viking Helmet ──
  const helmetMat = new THREE.MeshPhongMaterial({ color: 0x777766, flatShading: true });
  const helmetRimMat = new THREE.MeshPhongMaterial({ color: 0x998844, flatShading: true });

  // Helmet dome
  const helmetDome = new THREE.Mesh(
    new THREE.SphereGeometry(6.2, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    helmetMat
  );
  helmetDome.position.y = 48;
  group.add(helmetDome);

  // Nose guard (vertical strip down the front)
  const noseGuard = new THREE.Mesh(new THREE.BoxGeometry(0.8, 8, 1), helmetRimMat);
  noseGuard.position.set(0, 48, 5.5);
  group.add(noseGuard);

  // Helmet rim band
  const rimBand = new THREE.Mesh(new THREE.TorusGeometry(6.2, 0.6, 6, 16), helmetRimMat);
  rimBand.position.y = 48;
  rimBand.rotation.x = Math.PI / 2;
  group.add(rimBand);

  // Horns! (classic Viking style)
  const hornMat = new THREE.MeshPhongMaterial({ color: 0xccbb88, flatShading: true });
  for (const side of [-1, 1]) {
    // Horn base
    const hornBase = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.8, 4, 6), hornMat);
    hornBase.position.set(side * 5.5, 50, -1);
    hornBase.rotation.z = side * -0.6;
    hornBase.rotation.x = -0.2;
    group.add(hornBase);
    // Horn middle
    const hornMid = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.2, 5, 6), hornMat);
    hornMid.position.set(side * 7.5, 53, -1.5);
    hornMid.rotation.z = side * -0.8;
    hornMid.rotation.x = -0.3;
    group.add(hornMid);
    // Horn tip (curves up)
    const hornTip = new THREE.Mesh(new THREE.ConeGeometry(0.8, 4, 6), hornMat);
    hornTip.position.set(side * 9, 56.5, -1);
    hornTip.rotation.z = side * -1.0;
    hornTip.rotation.x = -0.1;
    group.add(hornTip);
  }

  // ── Viking Beard (big braided red-brown beard) ──
  const beardMat = new THREE.MeshPhongMaterial({ color: 0x884422, flatShading: true });

  // Main beard mass
  const beardMain = new THREE.Mesh(new THREE.SphereGeometry(4, 8, 6), beardMat);
  beardMain.position.set(0, 41, 4);
  beardMain.scale.set(1.2, 1.5, 0.8);
  group.add(beardMain);

  // Braids hanging down
  for (const bx of [-2.5, 0, 2.5]) {
    for (let i = 0; i < 4; i++) {
      const bead = new THREE.Mesh(new THREE.SphereGeometry(1.2 - i * 0.15, 6, 4), beardMat);
      bead.position.set(bx, 38 - i * 2.5, 4.5 + Math.sin(i * 0.5) * 0.5);
      bead.scale.set(0.8, 1.2, 0.7);
      group.add(bead);
    }
    // Braid ring/bead at end
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.3, 4, 8), helmetRimMat);
    ring.position.set(bx, 29, 4.5);
    ring.rotation.x = Math.PI / 2;
    group.add(ring);
  }

  // Mustache
  for (const side of [-1, 1]) {
    const stache = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.8, 4, 5), beardMat);
    stache.position.set(side * 2, 43.5, 5.5);
    stache.rotation.z = side * 1.2;
    stache.rotation.x = 0.2;
    group.add(stache);
  }

  // Scraggly hair from under helmet
  const hairMat = new THREE.MeshPhongMaterial({ color: 0x884422 });
  for (let i = 0; i < 12; i++) {
    const a = Math.random() * Math.PI * 2;
    const hair = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.35, 5 + Math.random() * 5, 3), hairMat);
    hair.position.set(Math.sin(a) * 5.5, 46 - Math.random() * 3, Math.cos(a) * 4 - 1);
    hair.rotation.set(Math.sin(a) * 0.4, 0, Math.cos(a) * 0.4);
    group.add(hair);
  }

  // ── Arms ──
  const upperArmGeo = new THREE.CylinderGeometry(2.2, 1.8, 13, 8);
  const forearmGeo = new THREE.CylinderGeometry(1.8, 1.4, 11, 8);
  const shoulderGeo = new THREE.SphereGeometry(3, 8, 6);
  const elbowGeo = new THREE.SphereGeometry(2, 6, 4);
  const handGeo = new THREE.SphereGeometry(1.8, 8, 6);
  const fingerGeo = new THREE.CylinderGeometry(0.3, 0.25, 3, 4);
  const clawGeo = new THREE.ConeGeometry(0.3, 1.2, 4);

  function buildArm(side) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 8, 38, 0);

    const shoulder = new THREE.Mesh(shoulderGeo, skinMat);
    shoulder.castShadow = false;
    pivot.add(shoulder);

    // Deltoid muscle
    const deltoid = new THREE.Mesh(new THREE.SphereGeometry(2.5, 6, 4), skinMat);
    deltoid.position.set(side * 0.5, 0.5, 0);
    deltoid.scale.set(1.2, 0.8, 1);
    pivot.add(deltoid);

    const upper = new THREE.Mesh(upperArmGeo, skinMat);
    upper.position.y = -7;
    upper.castShadow = false;
    pivot.add(upper);

    // Forearm sub-pivot at elbow position
    const elbowPivot = new THREE.Group();
    elbowPivot.position.y = -13;

    const elbow = new THREE.Mesh(elbowGeo, darkSkinMat);
    elbowPivot.add(elbow);

    const fore = new THREE.Mesh(forearmGeo, skinMat);
    fore.position.y = -6;
    fore.castShadow = false;
    elbowPivot.add(fore);

    // Wrist
    const wrist = new THREE.Mesh(new THREE.SphereGeometry(1.5, 6, 4), skinMat);
    wrist.position.y = -11;
    elbowPivot.add(wrist);

    // Hand
    const hand = new THREE.Mesh(handGeo, skinMat);
    hand.position.set(0, -13, 0.5);
    hand.scale.set(1, 0.6, 1.2);
    elbowPivot.add(hand);

    // Fingers with claws
    for (let f = 0; f < 4; f++) {
      const fx = (f - 1.5) * 0.9;
      const finger = new THREE.Mesh(fingerGeo, darkSkinMat);
      finger.position.set(fx, -15, 1);
      finger.rotation.x = 0.3;
      elbowPivot.add(finger);

      const claw = new THREE.Mesh(clawGeo, nailMat);
      claw.position.set(fx, -16.5, 1.8);
      claw.rotation.x = 0.3;
      elbowPivot.add(claw);
    }

    // Thumb
    const thumb = new THREE.Mesh(fingerGeo, darkSkinMat);
    thumb.position.set(side * 1.5, -13, 1.5);
    thumb.rotation.set(0.4, 0, side * -0.5);
    thumb.scale.set(1.2, 0.7, 1.2);
    elbowPivot.add(thumb);

    pivot.add(elbowPivot);
    return { pivot, elbowPivot };
  }

  const leftArm = buildArm(-1);
  group.add(leftArm.pivot);
  const rightArm = buildArm(1);
  group.add(rightArm.pivot);

  // ── Legs ──
  const thighGeo = new THREE.CylinderGeometry(3, 2.4, 13, 8);
  const shinGeo = new THREE.CylinderGeometry(2.4, 1.8, 11, 8);
  const hipGeo = new THREE.SphereGeometry(3.2, 8, 6);
  const kneeGeo = new THREE.SphereGeometry(2.2, 6, 4);
  const footGeo = new THREE.SphereGeometry(2, 8, 6);
  const toeGeo = new THREE.SphereGeometry(0.6, 4, 4);

  function buildLeg(side) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 3.5, 20, 0);

    const hip = new THREE.Mesh(hipGeo, darkSkinMat);
    hip.castShadow = false;
    pivot.add(hip);

    const thigh = new THREE.Mesh(thighGeo, darkSkinMat);
    thigh.position.y = -7;
    thigh.castShadow = false;
    pivot.add(thigh);

    // Shin sub-pivot at knee position
    const kneePivot = new THREE.Group();
    kneePivot.position.set(0, -13, 0);

    const knee = new THREE.Mesh(kneeGeo, skinMat);
    knee.position.set(0, 0, 1);
    kneePivot.add(knee);

    const shin = new THREE.Mesh(shinGeo, darkSkinMat);
    shin.position.y = -6;
    shin.castShadow = false;
    kneePivot.add(shin);

    // Ankle
    const ankle = new THREE.Mesh(new THREE.SphereGeometry(1.8, 6, 4), skinMat);
    ankle.position.y = -11;
    kneePivot.add(ankle);

    // Foot
    const foot = new THREE.Mesh(footGeo, darkSkinMat);
    foot.position.set(0, -12, 2);
    foot.scale.set(0.9, 0.5, 1.5);
    kneePivot.add(foot);

    // Toes
    for (let ti = 0; ti < 3; ti++) {
      const toe = new THREE.Mesh(toeGeo, darkSkinMat);
      toe.position.set((ti - 1) * 1, -12.5, 4.5);
      kneePivot.add(toe);
    }

    pivot.add(kneePivot);
    return { pivot, kneePivot };
  }

  const leftLeg = buildLeg(-1);
  group.add(leftLeg.pivot);
  const rightLeg = buildLeg(1);
  group.add(rightLeg.pivot);

  // ── Wounds / gore details ──
  const woundMat = new THREE.MeshPhongMaterial({ color: 0x661111 });
  // Gash on torso
  const gash = new THREE.Mesh(new THREE.BoxGeometry(1.5, 6, 1), woundMat);
  gash.position.set(3, 28, 4.5);
  gash.rotation.z = 0.3;
  group.add(gash);

  // Exposed rib hints
  for (let i = 0; i < 3; i++) {
    const rib = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 4, 4), boneMat);
    rib.position.set(3.5, 30 + i * 2, 4);
    rib.rotation.z = Math.PI / 2;
    rib.rotation.y = 0.2;
    group.add(rib);
  }

  // ── Insect swarm from mouth ──
  const INSECT_COUNT = 1000;
  const insectPositions = new Float32Array(INSECT_COUNT * 3);
  const insectVelocities = new Float32Array(INSECT_COUNT * 3);
  const insectColors = new Float32Array(INSECT_COUNT * 3);
  // Mouth position in local zombie coords
  const mouthX = 0, mouthY = 43.5, mouthZ = 4.5;

  for (let i = 0; i < INSECT_COUNT; i++) {
    const i3 = i * 3;
    // Start spread around the mouth
    insectPositions[i3]     = mouthX + (Math.random() - 0.5) * 20;
    insectPositions[i3 + 1] = mouthY + (Math.random() - 0.5) * 20;
    insectPositions[i3 + 2] = mouthZ + Math.random() * 15;
    // Random buzzing velocities
    insectVelocities[i3]     = (Math.random() - 0.5) * 8;
    insectVelocities[i3 + 1] = (Math.random() - 0.5) * 8;
    insectVelocities[i3 + 2] = (Math.random() - 0.5) * 8;
    // Dark colors: black/brown flies
    const shade = 0.05 + Math.random() * 0.15;
    insectColors[i3]     = shade;
    insectColors[i3 + 1] = shade * 0.8;
    insectColors[i3 + 2] = shade * 0.5;
  }

  const insectGeo = new THREE.BufferGeometry();
  insectGeo.setAttribute('position', new THREE.BufferAttribute(insectPositions, 3));
  insectGeo.setAttribute('color', new THREE.BufferAttribute(insectColors, 3));

  const insectMat = new THREE.PointsMaterial({
    size: 8,
    vertexColors: true,
    sizeAttenuation: true,
  });

  const insectMesh = new THREE.Points(insectGeo, insectMat);
  group.add(insectMesh);

  return {
    group,
    leftArmPivot: leftArm.pivot, rightArmPivot: rightArm.pivot,
    leftElbow: leftArm.elbowPivot, rightElbow: rightArm.elbowPivot,
    leftLegPivot: leftLeg.pivot, rightLegPivot: rightLeg.pivot,
    leftKnee: leftLeg.kneePivot, rightKnee: rightLeg.kneePivot,
    insectGeo, insectVelocities, insectMesh,
  };
}

function spawnZombies() {
  for (const z of zombies) {
    scene.remove(z.group);
    z.group.traverse(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
  }
  zombies.length = 0;

  for (let i = 0; i < ZOMBIE_COUNT; i++) {
    // Spawn directly ahead of the plane (facing -Z at start)
    const radius = 6000;
    const x = 0;
    const z = -radius;
    const y = getTerrainHeight(x, z);

    const zombie = createZombie();
    zombie.group.position.set(x, y + 180, z);
    zombie.group.scale.set(30, 30, 30);
    zombie.group.rotation.y = Math.random() * Math.PI * 2;
    scene.add(zombie.group);

    zombies.push({
      ...zombie,
      hp: 5,
      destroyed: false,
      walkDir: Math.random() * Math.PI * 2,
      walkTimer: Math.random() * 3,
      walkSpeed: 60 + Math.random() * 30,
      phase: Math.random() * Math.PI * 2,
      grabState: 0,   // 0=walking, 1=reaching, 2=grabbed
      grabTimer: 0,
      reachBlend: 0,
      dancing: false,
      danceAngle: Math.random() * Math.PI * 2,
    });
  }
}

function spawnOneZombie() {
  // Spawn ahead of player's current position/direction
  const spawnOrigin = controlMode === "walking" ? player.position : flight.position;
  const fwd = controlMode === "walking"
    ? new THREE.Vector3(Math.sin(player.yaw), 0, Math.cos(player.yaw))
    : new THREE.Vector3(0, 0, -1).applyQuaternion(flight.quaternion);
  const dist = 4000 + Math.random() * 4000;
  const lateral = (Math.random() - 0.5) * 4000;
  const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
  const x = spawnOrigin.x + fwd.x * dist + right.x * lateral;
  const z = spawnOrigin.z + fwd.z * dist + right.z * lateral;
  const y = getTerrainHeight(x, z);

  const zombie = createZombie();
  zombie.group.position.set(x, y + 180, z);
  zombie.group.scale.set(30, 30, 30);
  zombie.group.rotation.y = Math.random() * Math.PI * 2;
  scene.add(zombie.group);

  zombies.push({
    ...zombie,
    hp: 5,
    destroyed: false,
    dying: false,
    walkDir: Math.random() * Math.PI * 2,
    walkTimer: Math.random() * 3,
    walkSpeed: 60 + Math.random() * 30,
    phase: Math.random() * Math.PI * 2,
    grabState: 0,
    grabTimer: 0,
    reachBlend: 0,
    dancing: false,
    danceAngle: Math.random() * Math.PI * 2,
  });
}

function updateZombies(t) {
  for (const z of zombies) {
    if (z.destroyed) continue;

    // Death + stand-up animation phases:
    //  0.0 - 1.5s : fall backward to ground (ease-in gravity)
    //  1.5 - 10.0s: lie dead on the ground
    // 10.0 - 11.0s: twitch and roll onto stomach
    // 11.0 - 12.5s: push up to hands and knees
    // 12.5 - 14.0s: rise from knees to standing
    // 14.0s+      : fully alive again
    if (z.dying) {
      z.deathTimer += t;
      const dt = z.deathTimer;
      const lerp = THREE.MathUtils.lerp;
      const clamp = THREE.MathUtils.clamp;

      if (dt < 1.5) {
        // ── Phase 1: Fall backward ──
        const p = dt / 1.5;
        const eased = p * p; // gravity ease-in
        z.group.rotation.x = -eased * (Math.PI / 2);
        z.group.rotation.z = 0;

        // Limbs go limp
        const limp = Math.min(1, dt * 3);
        z.leftArmPivot.rotation.x = lerp(z.leftArmPivot.rotation.x, -0.2, limp * t * 5);
        z.leftArmPivot.rotation.z = lerp(z.leftArmPivot.rotation.z, -0.6, limp * t * 5);
        z.rightArmPivot.rotation.x = lerp(z.rightArmPivot.rotation.x, -0.2, limp * t * 5);
        z.rightArmPivot.rotation.z = lerp(z.rightArmPivot.rotation.z, 0.6, limp * t * 5);
        z.leftElbow.rotation.x = lerp(z.leftElbow.rotation.x, -0.4, limp * t * 5);
        z.rightElbow.rotation.x = lerp(z.rightElbow.rotation.x, -0.4, limp * t * 5);
        z.leftLegPivot.rotation.x = lerp(z.leftLegPivot.rotation.x, 0.1, limp * t * 5);
        z.rightLegPivot.rotation.x = lerp(z.rightLegPivot.rotation.x, 0.1, limp * t * 5);
        z.leftKnee.rotation.x = lerp(z.leftKnee.rotation.x, 0.3, limp * t * 5);
        z.rightKnee.rotation.x = lerp(z.rightKnee.rotation.x, 0.3, limp * t * 5);

      } else if (dt < 10.0) {
        // ── Phase 2: Lie dead on ground ──
        z.group.rotation.x = -Math.PI / 2;
        z.group.rotation.z = 0;
        // Occasional twitch near the end to foreshadow revival
        if (dt > 8.5) {
          const twitch = Math.sin((dt - 8.5) * 12) * 0.03 * (dt - 8.5);
          z.leftArmPivot.rotation.x = -0.2 + twitch;
          z.rightArmPivot.rotation.x = -0.2 - twitch;
          z.group.children[0].rotation.x = 0.04 + twitch * 0.5;
        }

      } else if (dt < 11.0) {
        // ── Phase 3: Roll onto stomach ──
        const p = clamp((dt - 10.0) / 1.0, 0, 1);
        // Smooth ease in-out
        const smooth = p * p * (3 - 2 * p);
        // Roll from on-back (-PI/2) through side (-PI) to face-down (-3PI/2 = PI/2 equivalent)
        z.group.rotation.x = lerp(-Math.PI / 2, -Math.PI, smooth);
        // Slight lateral roll during the turn
        z.group.rotation.z = Math.sin(smooth * Math.PI) * 0.3;

        // Arms sweep to sides to help roll
        z.leftArmPivot.rotation.x = lerp(-0.2, 0.5, smooth);
        z.leftArmPivot.rotation.z = lerp(-0.6, -1.2, smooth);
        z.rightArmPivot.rotation.x = lerp(-0.2, 0.5, smooth);
        z.rightArmPivot.rotation.z = lerp(0.6, 1.2, smooth);
        z.leftElbow.rotation.x = lerp(-0.4, -1.0, smooth);
        z.rightElbow.rotation.x = lerp(-0.4, -1.0, smooth);

        // Legs curl to help roll
        z.leftLegPivot.rotation.x = lerp(0.1, -0.4, smooth);
        z.rightLegPivot.rotation.x = lerp(0.1, -0.3, smooth);
        z.leftKnee.rotation.x = lerp(0.3, 0.8, smooth);
        z.rightKnee.rotation.x = lerp(0.3, 0.7, smooth);

      } else if (dt < 12.5) {
        // ── Phase 4: Push up to hands and knees ──
        const p = clamp((dt - 11.0) / 1.5, 0, 1);
        const smooth = p * p * (3 - 2 * p);

        // Body rises from face-down (-PI) to hunched forward (-PI + PI*0.75 ~ crouching angle)
        // Face-down is -PI rotation.x; hands-and-knees is roughly -0.8
        z.group.rotation.x = lerp(-Math.PI, -0.8, smooth);
        z.group.rotation.z = lerp(z.group.rotation.z, 0, smooth);

        // Arms plant on ground then push up - shoulders rotate forward, elbows bend
        z.leftArmPivot.rotation.x = lerp(0.5, -1.5, smooth);
        z.leftArmPivot.rotation.z = lerp(-1.2, -0.2, smooth);
        z.rightArmPivot.rotation.x = lerp(0.5, -1.5, smooth);
        z.rightArmPivot.rotation.z = lerp(1.2, 0.2, smooth);
        // Elbows straighten as zombie pushes up
        z.leftElbow.rotation.x = lerp(-1.0, -0.3, smooth);
        z.rightElbow.rotation.x = lerp(-1.0, -0.3, smooth);

        // Legs pull underneath - knees bend, thighs tuck
        z.leftLegPivot.rotation.x = lerp(-0.4, -1.2, smooth);
        z.rightLegPivot.rotation.x = lerp(-0.3, -1.2, smooth);
        z.leftKnee.rotation.x = lerp(0.8, 1.8, smooth);
        z.rightKnee.rotation.x = lerp(0.7, 1.8, smooth);

        // Stagger: body wobbles side to side with effort
        z.group.rotation.z += Math.sin(dt * 8) * 0.04 * (1 - smooth);

      } else if (dt < 14.0) {
        // ── Phase 5: Rise from knees to full standing ──
        const p = clamp((dt - 12.5) / 1.5, 0, 1);
        const smooth = p * p * (3 - 2 * p);

        // Torso straightens fully
        z.group.rotation.x = lerp(-0.8, 0, smooth);
        // Slight stagger wobble
        z.group.rotation.z = Math.sin(dt * 5) * 0.06 * (1 - smooth);

        // Arms lower to sides, slightly shambling
        z.leftArmPivot.rotation.x = lerp(-1.5, 0, smooth);
        z.leftArmPivot.rotation.z = lerp(-0.2, 0, smooth);
        z.rightArmPivot.rotation.x = lerp(-1.5, 0, smooth);
        z.rightArmPivot.rotation.z = lerp(0.2, 0, smooth);
        z.leftElbow.rotation.x = lerp(-0.3, -0.25, smooth);
        z.rightElbow.rotation.x = lerp(-0.3, -0.25, smooth);

        // Legs straighten from kneeling to standing
        z.leftLegPivot.rotation.x = lerp(-1.2, 0, smooth);
        z.rightLegPivot.rotation.x = lerp(-1.2, 0, smooth);
        z.leftKnee.rotation.x = lerp(1.8, 0, smooth);
        z.rightKnee.rotation.x = lerp(1.8, 0, smooth);

        // Head lolls then snaps forward (looking for prey)
        z.group.children[0].rotation.x = 0.04 + Math.sin(dt * 3) * 0.1 * (1 - smooth);

      } else {
        // ── Fully revived: reset to alive state ──
        z.dying = false;
        z.deathTimer = 0;
        z.hp = 5;
        z.grabState = 0;
        z.grabTimer = 0;
        z.reachBlend = 0;
        z.group.rotation.x = 0;
        z.group.rotation.z = 0;
        z.leftArmPivot.rotation.x = 0;
        z.leftArmPivot.rotation.z = 0;
        z.rightArmPivot.rotation.x = 0;
        z.rightArmPivot.rotation.z = 0;
        z.leftElbow.rotation.x = -0.25;
        z.rightElbow.rotation.x = -0.25;
        z.leftLegPivot.rotation.x = 0;
        z.rightLegPivot.rotation.x = 0;
        z.leftKnee.rotation.x = 0;
        z.rightKnee.rotation.x = 0;
      }
      // Keep zombie on terrain during all phases
      z.group.position.y = getTerrainHeight(z.group.position.x, z.group.position.z) + 180;
      continue;
    }

    // ── Zombie Maypole Dance ──
    z.dancing = false;
    for (const mp of maypolePositions) {
      const mdx = z.group.position.x - mp.x;
      const mdz = z.group.position.z - mp.z;
      const mDist = Math.sqrt(mdx * mdx + mdz * mdz);
      if (mDist < 120) {
        z.dancing = true;
        z.danceAngle += 1.0 * t;
        const danceRadius = 80;
        z.group.position.x = mp.x + Math.cos(z.danceAngle) * danceRadius;
        z.group.position.z = mp.z + Math.sin(z.danceAngle) * danceRadius;
        z.group.position.y = getTerrainHeight(z.group.position.x, z.group.position.z) + 180;
        z.group.rotation.y = z.danceAngle + Math.PI / 2;

        // Dance animation: arms up, bouncing legs
        z.phase += t * 8;
        const ds = Math.sin(z.phase);
        z.leftArmPivot.rotation.x = -2.5;
        z.rightArmPivot.rotation.x = -2.5;
        z.leftArmPivot.rotation.z = -0.4 + ds * 0.3;
        z.rightArmPivot.rotation.z = 0.4 - ds * 0.3;
        z.leftElbow.rotation.x = -0.3;
        z.rightElbow.rotation.x = -0.3;
        z.leftLegPivot.rotation.x = -ds * 0.6;
        z.rightLegPivot.rotation.x = ds * 0.6;
        z.leftKnee.rotation.x = Math.max(0, ds) * 0.9;
        z.rightKnee.rotation.x = Math.max(0, -ds) * 0.9;
        z.group.rotation.z = 0;
        z.group.rotation.x = 0;
        break;
      }
    }
    if (z.dancing) continue;

    // Distance to target (plane only — zombies ignore pilot on foot)
    const trackPos = flight.position;
    const dx = trackPos.x - z.group.position.x;
    const dz = trackPos.z - z.group.position.z;
    tmpVec.copy(z.group.position);
    tmpVec.y += 750;
    const dist = trackPos.distanceTo(tmpVec);

    // Reach/grab state transitions (only when flying)
    const REACH_DIST = 1800;

    if (controlMode === "flying" && z.grabState === 0 && dist < REACH_DIST) {
      z.grabState = 1;
    } else if (z.grabState === 1 && (dist >= REACH_DIST || controlMode === "walking")) {
      z.grabState = 0;
    }

    // Blend reach animation (0→1)
    const reachTarget = z.grabState >= 1 ? 1 : 0;
    z.reachBlend = THREE.MathUtils.lerp(z.reachBlend, reachTarget, t * 4);

    // Walking: wander randomly. Flying: chase the plane.
    const speedMult = z.grabState === 2 ? 0 : (z.grabState === 1 ? 0.5 : 1);
    if (controlMode === "walking") {
      z.walkTimer -= t;
      if (z.walkTimer <= 0) {
        z.walkDir += (Math.random() - 0.5) * 1.5;
        z.walkTimer = 2 + Math.random() * 4;
      }
    } else {
      z.walkDir = Math.atan2(dx, dz);
    }

    z.group.position.x += Math.sin(z.walkDir) * z.walkSpeed * speedMult * t;
    z.group.position.z += Math.cos(z.walkDir) * z.walkSpeed * speedMult * t;

    // Stick to terrain (feet bottom is at ~y=-6 local * 30 scale = -180)
    z.group.position.y = getTerrainHeight(z.group.position.x, z.group.position.z) + 180;

    // Face the plane
    z.group.rotation.y = z.walkDir;

    // ── Animate limbs ──
    const stride = 1150;
    z.phase += (z.walkSpeed * speedMult * t / stride) * Math.PI * 2;
    const s = Math.sin(z.phase);
    const c = Math.cos(z.phase);
    const rb = z.reachBlend;

    // Reach angle: negative rotation.x = forward, more negative = upward
    const dy = trackPos.y - (z.group.position.y + 38 * 30);
    const horizDist = Math.sqrt(dx * dx + dz * dz);
    const angleAbove = Math.atan2(dy, horizDist);
    const reachShoulder = THREE.MathUtils.clamp(-(Math.PI / 2 + angleAbove), -2.8, -0.5);

    // Left arm: always normal walk swing
    z.leftArmPivot.rotation.x = s * 0.65;
    z.leftElbow.rotation.x = -Math.max(0, -s) * 1.0 - 0.25;
    z.leftArmPivot.rotation.z = 0;

    // Right arm: blend between walk and reach/grab
    const walkArmR = -s * 0.65;
    const walkElbowR = -Math.max(0, s) * 1.0 - 0.25;

    if (z.grabState === 2) {
      // Grab: right hand closes around plane
      z.grabTimer += t;
      const grabClose = Math.min(1, z.grabTimer * 2);

      z.rightArmPivot.rotation.x = reachShoulder;
      z.rightElbow.rotation.x = THREE.MathUtils.lerp(-0.15, -1.6, grabClose);
      z.rightArmPivot.rotation.z = 0;

      // Pull the plane toward the zombie's hand
      const pullStrength = 400 * grabClose;
      tmpVec.copy(z.group.position);
      tmpVec.y += 750;
      tmpVec.sub(flight.position).normalize().multiplyScalar(pullStrength * t);
      flight.position.add(tmpVec);
      flight.speed *= (1 - t * 3);

      if (z.grabTimer > 0.8) {
        crash();
        return;
      }
    } else {
      // Reaching: right arm extends toward plane
      z.rightArmPivot.rotation.x = THREE.MathUtils.lerp(walkArmR, reachShoulder, rb);
      z.rightElbow.rotation.x = THREE.MathUtils.lerp(walkElbowR, -0.15, rb);
      z.rightArmPivot.rotation.z = 0;
    }

    // Compute right hand world position for grab collision
    // Arm total length ~26 local units (shoulder to fingertips)
    const armLen = 26;
    const shoulderAngle = z.grabState === 2 ? reachShoulder :
      THREE.MathUtils.lerp(walkArmR, reachShoulder, rb);
    // Hand in arm-pivot local: rotated along -Y by shoulderAngle around X
    const handLocalY = -armLen * Math.cos(shoulderAngle);
    const handLocalZ = -armLen * Math.sin(shoulderAngle);
    // In zombie local coords (add pivot offset: x=8, y=38)
    const handZX = 8;
    const handZY = 38 + handLocalY;
    const handZZ = handLocalZ;
    // Apply zombie rotation.y and scale 30x to get world position
    const cosW = Math.cos(z.walkDir);
    const sinW = Math.sin(z.walkDir);
    tmpVec2.set(
      z.group.position.x + (handZX * cosW + handZZ * sinW) * 30,
      z.group.position.y + handZY * 30,
      z.group.position.z + (-handZX * sinW + handZZ * cosW) * 30
    );
    const handDist = trackPos.distanceTo(tmpVec2);

    // Grab triggers when hand actually touches the plane (flying only)
    if (controlMode === "flying" && z.grabState === 1 && handDist < 150) {
      z.grabState = 2;
      z.grabTimer = 0;
    }

    // Legs: walk animation (reduced when reaching/grabbed)
    z.leftLegPivot.rotation.x = -s * 0.5 * (1 - rb * 0.5);
    z.rightLegPivot.rotation.x = s * 0.5 * (1 - rb * 0.5);
    z.leftKnee.rotation.x = Math.max(0, s) * 0.8 * (1 - rb * 0.5);
    z.rightKnee.rotation.x = Math.max(0, -s) * 0.8 * (1 - rb * 0.5);

    // Body sway and lean
    z.group.rotation.z = Math.sin(z.phase * 0.5) * 0.04 * (1 - rb);
    z.group.children[0].rotation.x = 0.04 + Math.abs(c) * 0.02;

    // ── Update insect swarm ──
    const pos = z.insectGeo.attributes.position.array;
    const vel = z.insectVelocities;
    const mX = 0, mY = 43.5, mZ = 4.5; // mouth in local coords
    const swarmRadius = 30; // how far insects roam from mouth

    for (let i = 0; i < pos.length; i += 3) {
      // Erratic buzzing: randomize velocity frequently
      vel[i]     += (Math.random() - 0.5) * 40 * t;
      vel[i + 1] += (Math.random() - 0.5) * 40 * t;
      vel[i + 2] += (Math.random() - 0.5) * 40 * t;

      // Push away from mouth (outward emission)
      const ox = pos[i] - mX, oy = pos[i + 1] - mY, oz = pos[i + 2] - mZ;
      const d = Math.sqrt(ox * ox + oy * oy + oz * oz);
      const push = 6;
      vel[i]     += ox / (d + 0.1) * push * t;
      vel[i + 1] += oy / (d + 0.1) * push * t;
      vel[i + 2] += oz / (d + 0.1) * push * t;

      // Slight forward bias (insects fly out in front of face, +Z in local)
      vel[i + 2] += 3 * t;

      // Damping
      vel[i]     *= 0.96;
      vel[i + 1] *= 0.96;
      vel[i + 2] *= 0.96;

      // Move
      pos[i]     += vel[i] * t;
      pos[i + 1] += vel[i + 1] * t;
      pos[i + 2] += vel[i + 2] * t;

      // Respawn at mouth when too far
      const dx2 = pos[i] - mX, dy2 = pos[i + 1] - mY, dz2 = pos[i + 2] - mZ;
      const d2 = Math.sqrt(dx2 * dx2 + dy2 * dy2 + dz2 * dz2);
      if (d2 > swarmRadius) {
        pos[i]     = mX + (Math.random() - 0.5) * 2;
        pos[i + 1] = mY + (Math.random() - 0.5) * 2;
        pos[i + 2] = mZ + Math.random();
        vel[i]     = (Math.random() - 0.5) * 8;
        vel[i + 1] = (Math.random() - 0.5) * 8;
        vel[i + 2] = 2 + Math.random() * 6;
      }
    }
    z.insectGeo.attributes.position.needsUpdate = true;

    // Direct collision (flying only — zombies ignore walking pilot)
    if (controlMode === "flying" && z.grabState < 2 && dist < 500) {
      crash();
      return;
    }
  }
}

function clearZombies() {
  for (const z of zombies) {
    scene.remove(z.group);
    z.group.traverse(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
  }
  zombies.length = 0;
}

// ─── Sound Effects (Web Audio API) ───────────────────────────
const audio = { ctx: null, master: null, engine: {}, wind: {} };

function initAudio() {
  if (audio.ctx) { audio.ctx.resume(); return; }

  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  audio.ctx = ctx;

  audio.master = ctx.createGain();
  audio.master.gain.value = 0.4;
  audio.master.connect(ctx.destination);

  // Engine: two detuned sawtooth oscillators → lowpass → gain
  const engFilter = ctx.createBiquadFilter();
  engFilter.type = "lowpass";
  engFilter.frequency.value = 200;
  engFilter.Q.value = 3;

  const engGain = ctx.createGain();
  engGain.gain.value = 0;
  engFilter.connect(engGain);
  engGain.connect(audio.master);

  const osc1 = ctx.createOscillator();
  osc1.type = "sawtooth";
  osc1.frequency.value = 80;
  osc1.connect(engFilter);
  osc1.start();

  const osc2 = ctx.createOscillator();
  osc2.type = "sawtooth";
  osc2.frequency.value = 82;
  osc2.connect(engFilter);
  osc2.start();

  audio.engine = { osc1, osc2, gain: engGain, filter: engFilter };

  // Wind: looping white noise → bandpass → gain
  const windBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const wd = windBuf.getChannelData(0);
  for (let i = 0; i < wd.length; i++) wd[i] = Math.random() * 2 - 1;

  const windSrc = ctx.createBufferSource();
  windSrc.buffer = windBuf;
  windSrc.loop = true;

  const windFilter = ctx.createBiquadFilter();
  windFilter.type = "bandpass";
  windFilter.frequency.value = 800;
  windFilter.Q.value = 0.5;

  const windGain = ctx.createGain();
  windGain.gain.value = 0;

  windSrc.connect(windFilter);
  windFilter.connect(windGain);
  windGain.connect(audio.master);
  windSrc.start();

  audio.wind = { source: windSrc, gain: windGain, filter: windFilter };
}

function updateSounds() {
  if (!audio.ctx) return;
  const t = audio.ctx.currentTime + 0.05;

  // Engine pitch & volume follow throttle
  const baseFreq = 60 + flight.throttle * 80 + (flight.boost ? 30 : 0);
  audio.engine.osc1.frequency.linearRampToValueAtTime(baseFreq, t);
  audio.engine.osc2.frequency.linearRampToValueAtTime(baseFreq * 1.02, t);
  audio.engine.filter.frequency.linearRampToValueAtTime(150 + flight.throttle * 300, t);
  audio.engine.gain.gain.linearRampToValueAtTime(0.12 + flight.throttle * 0.18, t);

  // Wind volume follows speed
  const speedPct = Math.min(1, flight.speed / flight.maxSpeed);
  audio.wind.gain.gain.linearRampToValueAtTime(speedPct * 0.25, t);
  audio.wind.filter.frequency.linearRampToValueAtTime(400 + speedPct * 1200, t);
}

function stopContinuousSounds() {
  if (!audio.ctx) return;
  const t = audio.ctx.currentTime + 0.1;
  audio.engine.gain.gain.linearRampToValueAtTime(0, t);
  audio.wind.gain.gain.linearRampToValueAtTime(0, t);
}

let gunSoundBuf = null;

function playGunSound() {
  if (!audio.ctx) return;
  const ctx = audio.ctx;

  if (!gunSoundBuf) {
    gunSoundBuf = ctx.createBuffer(1, ctx.sampleRate * 0.04, ctx.sampleRate);
    const d = gunSoundBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.008));
  }

  const src = ctx.createBufferSource();
  src.buffer = gunSoundBuf;
  const f = ctx.createBiquadFilter();
  f.type = "highpass";
  f.frequency.value = 600;
  const g = ctx.createGain();
  g.gain.value = 0.12;

  src.connect(f);
  f.connect(g);
  g.connect(audio.master);
  src.start();
}

function playExplosionSound() {
  if (!audio.ctx) return;
  const ctx = audio.ctx;
  const now = ctx.currentTime;

  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(80, now);
  osc.frequency.exponentialRampToValueAtTime(20, now + 0.4);
  const og = ctx.createGain();
  og.gain.setValueAtTime(0.4, now);
  og.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
  osc.connect(og);
  og.connect(audio.master);
  osc.start(now);
  osc.stop(now + 0.5);

  const buf = ctx.createBuffer(1, ctx.sampleRate * 0.3, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.06));
  const noise = ctx.createBufferSource();
  noise.buffer = buf;
  const nf = ctx.createBiquadFilter();
  nf.type = "lowpass";
  nf.frequency.value = 500;
  const ng = ctx.createGain();
  ng.gain.value = 0.2;
  noise.connect(nf);
  nf.connect(ng);
  ng.connect(audio.master);
  noise.start(now);
}

function playCrashSound() {
  if (!audio.ctx) return;
  const ctx = audio.ctx;
  const now = ctx.currentTime;

  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(100, now);
  osc.frequency.exponentialRampToValueAtTime(15, now + 0.8);
  const og = ctx.createGain();
  og.gain.setValueAtTime(0.5, now);
  og.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
  osc.connect(og);
  og.connect(audio.master);
  osc.start(now);
  osc.stop(now + 0.9);

  const buf = ctx.createBuffer(1, ctx.sampleRate * 0.6, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.15));
  const noise = ctx.createBufferSource();
  noise.buffer = buf;
  const ng = ctx.createGain();
  ng.gain.value = 0.35;
  noise.connect(ng);
  ng.connect(audio.master);
  noise.start(now);
}

// ─── Flight Physics ──────────────────────────────────────────
const flight = {
  position: new THREE.Vector3(0, 250, 0),
  velocity: new THREE.Vector3(0, 0, 0),
  speed: 2,
  throttle: 0.5,
  maxSpeed: 8,
  minSpeed: 0.5,
  pitch: 0,    // current rates
  yaw: 0,
  roll: 0,
  quaternion: new THREE.Quaternion(),
  boost: false,
};

// Initialize facing forward
const initEuler = new THREE.Euler(0, 0, 0, "YXZ");
flight.quaternion.setFromEuler(initEuler);

// ─── Walking / Ground State ──────────────────────────────────
let controlMode = "flying"; // "flying" or "walking"

const player = {
  position: new THREE.Vector3(),
  velocity: new THREE.Vector3(),
  yaw: 0,
  speed: 0,
  onGround: false,
  walkPhase: 0,
  parachuteOpen: false,
  chuteDeployTimer: 0,
  swimming: false,
  idleTimer: 0,
  flowersCollected: 0,
  moosePetted: 0,
  maypoleScore: 0,
  nearMaypole: false,
  pettingMoose: null,
  fikaActive: false,
  danceAngle: 0,
};

const autopilot = {
  direction: new THREE.Vector3(0, 0, -1),
  speed: 0,
  active: false,
  crashed: false,
};

// ─── Input ───────────────────────────────────────────────────
const keys = {};
const mouse = { yaw: 0, pitch: 0.3 }; // orbital angles (radians)
const MOUSE_SENSITIVITY = 0.003;
const CAM_DIST = 70;
const CAM_MIN_PITCH = -0.5;
const CAM_MAX_PITCH = 1.2;

let screenshotFlashTimer = 0;

function takeScreenshot() {
  // Render fresh frame and read pixels immediately (works without preserveDrawingBuffer)
  renderer.render(scene, camera);
  const gl = renderer.getContext();
  const w = gl.drawingBufferWidth;
  const h = gl.drawingBufferHeight;
  const pixels = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

  // Flip vertically (WebGL reads bottom-up)
  const rowSize = w * 4;
  const halfH = Math.floor(h / 2);
  const tempRow = new Uint8Array(rowSize);
  for (let y = 0; y < halfH; y++) {
    const topOff = y * rowSize;
    const botOff = (h - 1 - y) * rowSize;
    tempRow.set(pixels.subarray(topOff, topOff + rowSize));
    pixels.copyWithin(topOff, botOff, botOff + rowSize);
    pixels.set(tempRow, botOff);
  }

  // Write to offscreen canvas
  const offscreen = document.createElement("canvas");
  offscreen.width = w;
  offscreen.height = h;
  const ctx = offscreen.getContext("2d");
  const imgData = ctx.createImageData(w, h);
  imgData.data.set(pixels);
  ctx.putImageData(imgData, 0, 0);

  const dpr = renderer.getPixelRatio();

  // Draw HUD info directly with canvas 2D text
  const green = "rgba(0,255,136,0.8)";
  const greenDim = "rgba(0,255,136,0.5)";
  const scale = dpr;

  // Score — top right
  ctx.font = `bold ${28 * scale}px 'Segoe UI', system-ui, sans-serif`;
  ctx.fillStyle = green;
  ctx.textAlign = "right";
  const scoreText = dom.scoreDisplay.textContent;
  ctx.fillText(scoreText, w - 24 * scale, 40 * scale);

  // Rings/targets info
  ctx.font = `${13 * scale}px 'Segoe UI', system-ui, sans-serif`;
  ctx.fillStyle = greenDim;
  ctx.fillText(dom.ringsLeft.textContent, w - 24 * scale, 58 * scale);

  // Compass — top center
  ctx.textAlign = "center";
  ctx.font = `bold ${14 * scale}px 'Segoe UI', system-ui, sans-serif`;
  ctx.fillStyle = green;
  ctx.fillText(dom.compass.textContent, w / 2, 28 * scale);

  // FPS — top left
  ctx.textAlign = "left";
  ctx.font = `bold ${14 * scale}px 'Segoe UI', system-ui, sans-serif`;
  ctx.fillStyle = greenDim;
  ctx.fillText(dom.fps.textContent, 24 * scale, 32 * scale);

  // Gauges — bottom left
  const gaugeLabels = ["ALT", "SPD", "THR"];
  const gaugeVals = [dom.altVal.textContent, dom.spdVal.textContent, dom.thrVal.textContent];
  const gaugeY = h - 60 * scale;
  for (let i = 0; i < 3; i++) {
    const y = gaugeY + i * 20 * scale;
    ctx.font = `bold ${11 * scale}px 'Segoe UI', system-ui, sans-serif`;
    ctx.fillStyle = greenDim;
    ctx.textAlign = "right";
    ctx.fillText(gaugeLabels[i], 60 * scale, y);
    ctx.textAlign = "left";
    ctx.font = `bold ${14 * scale}px 'Segoe UI', system-ui, sans-serif`;
    ctx.fillStyle = green;
    ctx.fillText(gaugeVals[i], 72 * scale, y);
  }

  // Crosshair
  ctx.strokeStyle = "rgba(0,255,136,0.4)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(w / 2 - 15, h / 2);
  ctx.lineTo(w / 2 + 15, h / 2);
  ctx.moveTo(w / 2, h / 2 - 15);
  ctx.lineTo(w / 2, h / 2 + 15);
  ctx.stroke();

  // Timestamp watermark
  const now = new Date();
  const ts = now.toISOString().replace("T", " ").slice(0, 19);
  ctx.font = `${12 * scale}px monospace`;
  ctx.fillStyle = "rgba(0,255,136,0.4)";
  ctx.textAlign = "left";
  ctx.fillText(ts, 10, h - 10);

  // Trigger download
  const link = document.createElement("a");
  link.download = `flight-sim-${Date.now()}.png`;
  link.href = offscreen.toDataURL("image/png");
  link.click();

  screenshotFlashTimer = 0.3;
}

window.addEventListener("keydown", (e) => {
  keys[e.code] = true;
  if (["Space", "ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight"].includes(e.code)) {
    e.preventDefault();
  }
  // Screenshot
  if (e.code === "KeyP") {
    takeScreenshot();
  }
  // Eject from plane / Board plane
  if (e.code === "KeyF" && state === "playing") {
    if (controlMode === "flying") {
      ejectFromPlane();
    } else if (controlMode === "walking" && player.onGround) {
      // Check if near the airplane
      const dx = player.position.x - flight.position.x;
      const dz = player.position.z - flight.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < 30 && airplane.visible && !autopilot.crashed) {
        boardPlane();
      }
    }
  }
});

function ejectFromPlane() {
  controlMode = "walking";
  stopContinuousSounds();

  // Compute forward direction from current flight quaternion
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(flight.quaternion);

  // Position pilot at plane's current position
  player.position.copy(flight.position);
  player.yaw = Math.atan2(fwd.x, -fwd.z);
  // Catapult: upward + slight forward velocity
  player.velocity.set(fwd.x * 40, 100, fwd.z * 40);
  player.onGround = false;
  player.walkPhase = 0;
  player.speed = 0;
  player.parachuteOpen = false;
  player.chuteDeployTimer = 0.5; // brief freefall before chute opens

  // Show walking pilot
  walkingPilot.group.visible = true;
  walkingPilot.group.position.copy(player.position);
  walkingPilot.group.rotation.y = player.yaw;

  // Set up autopilot for the plane
  autopilot.direction.copy(fwd);
  autopilot.speed = flight.speed;
  autopilot.active = true;
  autopilot.crashed = false;
}

function boardPlane() {
  controlMode = "flying";

  // Hide walking pilot, show airplane
  walkingPilot.group.visible = false;
  walkingPilot.coffeeCup.visible = false;
  parachuteGroup.visible = false;
  airplane.visible = true;

  // Position plane for takeoff — place on runway facing along it
  const rx = AIRPORT_POS.x - Math.sin(AIRPORT_HEADING) * 80; // back of runway
  const rz = AIRPORT_POS.z - Math.cos(AIRPORT_HEADING) * 80;
  const ry = getTerrainHeight(AIRPORT_POS.x, AIRPORT_POS.z) + 6;
  flight.position.set(rx, ry, rz);
  flight.velocity.set(0, 0, 0);
  flight.speed = 0.5;
  flight.throttle = 0.5;
  flight.quaternion.setFromEuler(new THREE.Euler(0, AIRPORT_HEADING, 0, "YXZ"));
  airplane.position.copy(flight.position);
  airplane.quaternion.copy(flight.quaternion);

  // Reset pilot state
  player.onGround = false;
  player.swimming = false;
  player.parachuteOpen = false;
  player.idleTimer = 0;
  player.fikaActive = false;
  player.nearMaypole = false;
  player.pettingMoose = null;

  autopilot.active = false;
  autopilot.crashed = false;

  mouse.yaw = AIRPORT_HEADING;
  mouse.pitch = 0.3;
}

window.addEventListener("keyup", (e) => { keys[e.code] = false; });
window.addEventListener("mousedown", (e) => { if (e.button === 0 && state === "playing") { firing = true; e.preventDefault(); } });
window.addEventListener("mouseup", (e) => { if (e.button === 0) firing = false; });
window.addEventListener("mousemove", (e) => {
  if (state !== "playing") return;
  mouse.yaw -= e.movementX * MOUSE_SENSITIVITY;
  mouse.pitch = THREE.MathUtils.clamp(mouse.pitch + e.movementY * MOUSE_SENSITIVITY, CAM_MIN_PITCH, CAM_MAX_PITCH);
});

// Request pointer lock on canvas click during gameplay
renderer.domElement.addEventListener("click", () => {
  if (state === "playing" && !document.pointerLockElement) {
    renderer.domElement.requestPointerLock();
  }
});

// ─── Game State ──────────────────────────────────────────────
let state = "start";
let score = 0;
let distanceTraveled = 0;
let lastPosition = new THREE.Vector3();
let clock = new THREE.Clock();

function getTerrainHeight(x, z) {
  // Approximate — same formula as generation
  let h = 0;
  h += Math.sin(x * 0.002) * Math.cos(-z * 0.002) * 120;
  h += Math.sin(x * 0.005 + 1) * Math.cos(-z * 0.004 + 2) * 60;
  h += Math.sin(x * 0.01 + 3) * Math.cos(-z * 0.012 + 1) * 30;
  h += Math.sin(x * 0.025) * Math.cos(-z * 0.02) * 15;

  // Apply airport flattening (must match generateTerrain)
  const apX = 300, apZ = -350, apInner = 120, apOuter = 250;
  const dx = x - apX, dz = z - apZ;
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dist < apInner) {
    let ch = 0;
    ch += Math.sin(apX * 0.002) * Math.cos(-apZ * 0.002) * 120;
    ch += Math.sin(apX * 0.005 + 1) * Math.cos(-apZ * 0.004 + 2) * 60;
    ch += Math.sin(apX * 0.01 + 3) * Math.cos(-apZ * 0.012 + 1) * 30;
    ch += Math.sin(apX * 0.025) * Math.cos(-apZ * 0.02) * 15;
    h = ch;
  } else if (dist < apOuter) {
    let ch = 0;
    ch += Math.sin(apX * 0.002) * Math.cos(-apZ * 0.002) * 120;
    ch += Math.sin(apX * 0.005 + 1) * Math.cos(-apZ * 0.004 + 2) * 60;
    ch += Math.sin(apX * 0.01 + 3) * Math.cos(-apZ * 0.012 + 1) * 30;
    ch += Math.sin(apX * 0.025) * Math.cos(-apZ * 0.02) * 15;
    const blend = (dist - apInner) / (apOuter - apInner);
    const smooth = blend * blend * (3 - 2 * blend);
    h = ch * (1 - smooth) + h * smooth;
  }

  return h;
}

function resetFlight() {
  // Park the plane at the airport
  flight.position.set(PLANE_PARK.x, PLANE_PARK.y, PLANE_PARK.z);
  flight.velocity.set(0, 0, 0);
  flight.speed = 0;
  flight.throttle = 0;
  flight.pitch = 0;
  flight.yaw = 0;
  flight.roll = 0;
  flight.quaternion.setFromEuler(new THREE.Euler(0, AIRPORT_HEADING, 0, "YXZ"));
  flight.boost = false;

  // Start pilot on ground facing airport, maypole and village visible
  controlMode = "walking";
  const startX = 220, startZ = -245;
  const startY = getExactGroundHeight(startX, startZ);
  player.position.set(startX, startY, startZ);
  player.velocity.set(0, 0, 0);
  player.yaw = 2.6; // face toward airport
  player.speed = 0;
  player.onGround = true;
  player.walkPhase = 0;
  player.parachuteOpen = false;
  player.chuteDeployTimer = 0;
  player.swimming = false;
  player.idleTimer = 0;
  player.flowersCollected = 0;
  player.moosePetted = 0;
  player.maypoleScore = 0;
  player.nearMaypole = false;
  player.pettingMoose = null;
  player.fikaActive = false;
  player.danceAngle = 0;
  walkingPilot.coffeeCup.visible = false;
  walkingPilot.group.visible = true;
  walkingPilot.group.position.copy(player.position);
  walkingPilot.group.rotation.y = player.yaw;
  parachuteGroup.visible = false;
  airplane.visible = true;
  airplane.position.copy(flight.position);
  airplane.quaternion.copy(flight.quaternion);
  autopilot.active = false;
  autopilot.crashed = false;

  score = 0;
  distanceTraveled = 0;
  targetsDestroyed = 0;
  zombiesKilled = 0;
  lastPosition.copy(player.position);
  clearBullets();
  clearExhaust();
  clearZombies();
  spawnTargets();
  spawnZombies();
  spawnCollectibleFlowers();
  spawnMoose();
  spawnVillagers();

  // Snap camera to correct position immediately (avoid lerp pop-in)
  const cosP = Math.cos(0.3); // default pitch
  const initCamYaw = 0;
  camera.position.set(
    player.position.x + Math.sin(initCamYaw) * cosP * 15,
    player.position.y + Math.sin(0.3) * 15 + 6,
    player.position.z + Math.cos(initCamYaw) * cosP * 15
  );
  camera.lookAt(player.position.x, player.position.y + 5, player.position.z);
}

// ─── Cached DOM Elements ─────────────────────────────────────
const dom = {
  altVal: document.getElementById("alt-val"),
  altBar: document.getElementById("alt-bar"),
  spdVal: document.getElementById("spd-val"),
  spdBar: document.getElementById("spd-bar"),
  thrVal: document.getElementById("thr-val"),
  thrBar: document.getElementById("thr-bar"),
  scoreDisplay: document.getElementById("score-display"),
  ringsLeft: document.getElementById("rings-left"),
  compass: document.getElementById("compass"),
  warning: document.getElementById("warning"),
  fps: document.getElementById("fps"),
  finalScore: document.getElementById("final-score"),
  crashScreen: document.getElementById("crash-screen"),
  startScreen: document.getElementById("start-screen"),
};

// ─── Update ──────────────────────────────────────────────────
const tmpQuat = new THREE.Quaternion();
const forward = new THREE.Vector3();
const up = new THREE.Vector3();
const right = new THREE.Vector3();
const tmpVec = new THREE.Vector3();
const tmpVec2 = new THREE.Vector3();
const axisX = new THREE.Vector3(1, 0, 0);
const axisY = new THREE.Vector3(0, 1, 0);
const axisZ = new THREE.Vector3(0, 0, 1);
const sunOffset = new THREE.Vector3(500, 800, 300);

// ─── Ground Interactions ─────────────────────────────────────
function updateGroundInteractions(t) {
  const px = player.position.x;
  const pz = player.position.z;

  // ── Maypole Dance ──
  player.nearMaypole = false;
  for (const mp of maypolePositions) {
    const dx = px - mp.x;
    const dz = pz - mp.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < 30) {
      player.nearMaypole = true;
      // Auto-circle the maypole
      player.danceAngle += 1.5 * t;
      const radius = 20;
      player.position.x = mp.x + Math.cos(player.danceAngle) * radius;
      player.position.z = mp.z + Math.sin(player.danceAngle) * radius;
      player.position.y = getExactGroundHeight(player.position.x, player.position.z);
      // Face tangent direction (perpendicular to radius)
      player.yaw = player.danceAngle + Math.PI / 2;
      player.speed = 30; // visual speed for animation
      player.maypoleScore += 20 * t;
      break;
    }
  }

  // ── Flower Collection ──
  for (const f of collectibleFlowers) {
    if (f.collected) continue;
    const dx = px - f.group.position.x;
    const dz = pz - f.group.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < 8) {
      f.collected = true;
      scene.remove(f.group);
      player.flowersCollected++;
    }
  }

  // ── Moose Petting ──
  if (!player.pettingMoose) {
    for (const m of mooseList) {
      if (m.petted) continue;
      const dx = px - m.group.position.x;
      const dz = pz - m.group.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < 12) {
        player.pettingMoose = m;
        m.petTimer = 2.0;
        break;
      }
    }
  }

  if (player.pettingMoose) {
    const m = player.pettingMoose;
    m.petTimer -= t;
    // Moose nods during petting
    m.headPivot.rotation.x = Math.sin(Date.now() * 0.008) * 0.4;
    // Face the moose
    const toMooseX = m.group.position.x - px;
    const toMooseZ = m.group.position.z - pz;
    player.yaw = Math.atan2(toMooseX, toMooseZ);
    player.speed = 0;
    if (m.petTimer <= 0) {
      m.petted = true;
      player.moosePetted++;
      player.pettingMoose = null;
    }
  }

  // ── Moose Wandering ──
  for (const m of mooseList) {
    // Idle head bob
    if (!player.pettingMoose || player.pettingMoose !== m) {
      m.headPivot.rotation.x = Math.sin(Date.now() * 0.002) * 0.1;
    }
    // Wander
    m.wanderTimer -= t;
    if (m.wanderTimer <= 0) {
      m.wanderDir = Math.random() * Math.PI * 2;
      m.wanderTimer = 3 + Math.random() * 3;
    }
    const wanderSpeed = 8;
    m.group.position.x += Math.sin(m.wanderDir) * wanderSpeed * t;
    m.group.position.z += Math.cos(m.wanderDir) * wanderSpeed * t;
    const my = getTerrainHeight(m.group.position.x, m.group.position.z);
    if (my > -10 && my < 100) {
      m.group.position.y = my;
    } else {
      // Reverse direction if hitting water or mountains
      m.wanderDir += Math.PI;
      m.group.position.x -= Math.sin(m.wanderDir) * wanderSpeed * t * 2;
      m.group.position.z -= Math.cos(m.wanderDir) * wanderSpeed * t * 2;
    }
    m.group.rotation.y = m.wanderDir;
  }

  // ── Collectible Flower Bobbing ──
  const now = Date.now() * 0.001;
  for (let i = 0; i < collectibleFlowers.length; i++) {
    const f = collectibleFlowers[i];
    if (f.collected) continue;
    f.group.position.y = f.baseY + Math.sin(now * 2 + i) * 0.5;
    f.group.rotation.y = now * 0.5 + i;
  }
}

// ─── Walking Update ──────────────────────────────────────────
const WALK_SPEED = 50;
const SWIM_SPEED = 25;
const WALK_CAM_DIST = 15;
const WATER_LEVEL = -40;

function updateWalking(t) {
  // ── Parachute deployment timer ──
  if (!player.onGround && !player.swimming && !player.parachuteOpen && player.chuteDeployTimer > 0) {
    player.chuteDeployTimer -= t;
    if (player.chuteDeployTimer <= 0) {
      player.parachuteOpen = true;
      parachuteGroup.visible = true;
    }
  }

  // ── Detect water: terrain below water level ──
  const rawTerrH = getTerrainHeight(player.position.x, player.position.z);
  const overWater = rawTerrH < WATER_LEVEL;

  // ── Gravity / buoyancy / parachute ──
  if (player.swimming) {
    // Buoyancy: bob at water surface, following waves
    const wh = getWaveHeight(player.position.x, player.position.z, Date.now() * 0.001);
    const waterSurface = WATER_LEVEL + wh - 2; // submerged to chest, riding waves
    const diff = waterSurface - player.position.y;
    player.velocity.y += diff * 8 * t; // spring toward surface
    player.velocity.y *= Math.pow(0.05, t); // heavy water damping
  } else if (player.parachuteOpen && !player.onGround) {
    player.velocity.y -= 25 * t;
    player.velocity.y = Math.max(player.velocity.y, -35);
    player.velocity.x *= Math.pow(0.3, t);
    player.velocity.z *= Math.pow(0.3, t);
  } else if (!player.onGround) {
    player.velocity.y -= 80 * t;
  }

  // ── WASD movement ──
  const camFwdX = -Math.sin(mouse.yaw);
  const camFwdZ = -Math.cos(mouse.yaw);
  const camRightX = Math.cos(mouse.yaw);
  const camRightZ = -Math.sin(mouse.yaw);

  const inputZ = (keys["KeyW"] ? 1 : 0) - (keys["KeyS"] ? 1 : 0);
  const inputX = (keys["KeyD"] ? 1 : 0) - (keys["KeyA"] ? 1 : 0);

  if (player.swimming) {
    // Swimming movement — slower, water drag
    const spd = SWIM_SPEED;
    if (inputX !== 0 || inputZ !== 0) {
      const moveX = camFwdX * inputZ + camRightX * inputX;
      const moveZ = camFwdZ * inputZ + camRightZ * inputX;
      const len = Math.sqrt(moveX * moveX + moveZ * moveZ);
      player.velocity.x = THREE.MathUtils.lerp(player.velocity.x, (moveX / len) * spd, t * 4);
      player.velocity.z = THREE.MathUtils.lerp(player.velocity.z, (moveZ / len) * spd, t * 4);
      player.yaw = Math.atan2(moveX, moveZ);
      player.speed = spd;
    } else {
      player.velocity.x *= Math.pow(0.08, t); // water drag
      player.velocity.z *= Math.pow(0.08, t);
      player.speed = 0;
    }
  } else if ((player.onGround) && (inputX !== 0 || inputZ !== 0)) {
    const moveX = camFwdX * inputZ + camRightX * inputX;
    const moveZ = camFwdZ * inputZ + camRightZ * inputX;
    const len = Math.sqrt(moveX * moveX + moveZ * moveZ);
    player.velocity.x = (moveX / len) * WALK_SPEED;
    player.velocity.z = (moveZ / len) * WALK_SPEED;
    player.yaw = Math.atan2(moveX, moveZ);
    player.speed = WALK_SPEED;
  } else if (player.onGround) {
    player.velocity.x *= Math.pow(0.02, t);
    player.velocity.z *= Math.pow(0.02, t);
    player.speed = 0;
  }

  // ── Move horizontally ──
  player.position.x += player.velocity.x * t;
  player.position.z += player.velocity.z * t;

  // ── Resolve building collisions ──
  const resolved = resolveCollisions(player.position.x, player.position.z);
  if (resolved.x !== player.position.x || resolved.z !== player.position.z) {
    player.position.x = resolved.x;
    player.position.z = resolved.z;
    player.velocity.x = 0;
    player.velocity.z = 0;
  }

  // ── Re-check water at new position ──
  const rawTerrHNew = getTerrainHeight(player.position.x, player.position.z);
  const overWaterNow = rawTerrHNew < WATER_LEVEL;

  // ── Ground / water surface resolution ──
  if (player.swimming) {
    // Already swimming — apply vertical velocity
    player.position.y += player.velocity.y * t;

    // Did we reach land?
    if (!overWaterNow) {
      const landH = getExactGroundHeight(player.position.x, player.position.z);
      if (player.position.y <= landH) {
        player.position.y = landH;
        player.velocity.y = 0;
        player.swimming = false;
        player.onGround = true;
      }
    }
  } else if (player.onGround) {
    if (overWaterNow) {
      // Walked into water → start swimming
      player.swimming = true;
      player.onGround = false;
      const entryWh = getWaveHeight(player.position.x, player.position.z, Date.now() * 0.001);
      player.position.y = WATER_LEVEL + entryWh - 2;
      player.velocity.y = 0;
      // Close parachute if still open
      if (player.parachuteOpen) {
        player.parachuteOpen = false;
        parachuteGroup.visible = false;
      }
    } else {
      // Stick to exact mesh surface
      const groundH = getExactGroundHeight(player.position.x, player.position.z);
      player.position.y = groundH;
      player.velocity.y = 0;
    }
  } else {
    // Airborne
    player.position.y += player.velocity.y * t;

    const splashWh = getWaveHeight(player.position.x, player.position.z, Date.now() * 0.001);
    if (overWaterNow && player.position.y <= WATER_LEVEL + splashWh) {
      // Splash into water → start swimming
      player.swimming = true;
      player.onGround = false;
      player.position.y = WATER_LEVEL + splashWh - 2;
      player.velocity.y = 0;
      if (player.parachuteOpen) {
        player.parachuteOpen = false;
        parachuteGroup.visible = false;
      }
    } else {
      const groundH = getExactGroundHeight(player.position.x, player.position.z);
      if (player.position.y <= groundH) {
        player.position.y = groundH;
        player.velocity.y = 0;
        player.onGround = true;
        if (player.parachuteOpen) {
          player.parachuteOpen = false;
          parachuteGroup.visible = false;
        }
      }
    }
  }

  // ── Update walking pilot visual ──
  walkingPilot.group.position.copy(player.position);
  walkingPilot.group.rotation.y = player.yaw;

  // ── Swimming: tilt body forward, sink lower ──
  if (player.swimming) {
    walkingPilot.group.rotation.x = -0.5; // lean forward in water
  } else {
    walkingPilot.group.rotation.x = 0;
  }

  // ── Update parachute visual ──
  if (parachuteGroup.visible) {
    parachuteGroup.position.copy(player.position);
    const now = Date.now() * 0.001;
    parachuteGroup.rotation.z = Math.sin(now * 1.2) * 0.08;
    parachuteGroup.rotation.x = Math.sin(now * 0.9 + 1) * 0.06;
  }

  // ── Ground Interactions ──
  if (player.onGround && !player.swimming) {
    updateGroundInteractions(t);
  }

  // ── Idle Timer ──
  if (player.speed === 0 && player.onGround && !player.nearMaypole && !player.pettingMoose) {
    player.idleTimer += t;
  } else {
    player.idleTimer = 0;
    if (player.fikaActive) {
      player.fikaActive = false;
      walkingPilot.coffeeCup.visible = false;
    }
  }

  // Update visual position after interactions may have moved it
  walkingPilot.group.position.copy(player.position);
  walkingPilot.group.rotation.y = player.yaw;

  // ── Animations (priority order) ──
  if (player.swimming) {
    // 1. Swimming crawl animation
    player.walkPhase += t * 5;
    const s = Math.sin(player.walkPhase);
    const c = Math.cos(player.walkPhase);
    walkingPilot.leftArmPivot.rotation.x = -1.5 + s * 1.2;
    walkingPilot.leftArmPivot.rotation.z = -0.3;
    walkingPilot.leftElbowPivot.rotation.x = -0.5 - Math.max(0, -s) * 0.8;
    walkingPilot.rightArmPivot.rotation.x = -1.5 + c * 1.2;
    walkingPilot.rightArmPivot.rotation.z = 0.3;
    walkingPilot.rightElbowPivot.rotation.x = -0.5 - Math.max(0, -c) * 0.8;
    walkingPilot.leftLegPivot.rotation.x = s * 0.35;
    walkingPilot.rightLegPivot.rotation.x = -s * 0.35;
    walkingPilot.leftKneePivot.rotation.x = 0.15 + Math.max(0, s) * 0.25;
    walkingPilot.rightKneePivot.rotation.x = 0.15 + Math.max(0, -s) * 0.25;

  } else if (!player.onGround && !player.swimming) {
    // 2. Airborne: hold chute lines
    walkingPilot.leftArmPivot.rotation.x = -2.8;
    walkingPilot.rightArmPivot.rotation.x = -2.8;
    walkingPilot.leftArmPivot.rotation.z = 0;
    walkingPilot.rightArmPivot.rotation.z = 0;
    walkingPilot.leftElbowPivot.rotation.x = 0.2;
    walkingPilot.rightElbowPivot.rotation.x = 0.2;
    walkingPilot.leftLegPivot.rotation.x = 0.15;
    walkingPilot.rightLegPivot.rotation.x = 0.15;
    walkingPilot.leftKneePivot.rotation.x = 0.3;
    walkingPilot.rightKneePivot.rotation.x = 0.3;

  } else if (player.pettingMoose) {
    // 3. Petting moose — right arm extended, left at side
    walkingPilot.rightArmPivot.rotation.x = -1.2;
    walkingPilot.rightArmPivot.rotation.z = 0;
    walkingPilot.rightElbowPivot.rotation.x = -0.3;
    walkingPilot.leftArmPivot.rotation.x = 0;
    walkingPilot.leftArmPivot.rotation.z = 0;
    walkingPilot.leftElbowPivot.rotation.x = 0;
    walkingPilot.leftLegPivot.rotation.x = 0;
    walkingPilot.rightLegPivot.rotation.x = 0;
    walkingPilot.leftKneePivot.rotation.x = 0;
    walkingPilot.rightKneePivot.rotation.x = 0;

  } else if (player.nearMaypole) {
    // 4. Maypole dancing — arms raised, bouncing legs
    player.walkPhase += t * 10;
    const s = Math.sin(player.walkPhase);
    walkingPilot.leftArmPivot.rotation.x = -2.5;
    walkingPilot.rightArmPivot.rotation.x = -2.5;
    walkingPilot.leftArmPivot.rotation.z = -0.4 + s * 0.2;
    walkingPilot.rightArmPivot.rotation.z = 0.4 - s * 0.2;
    walkingPilot.leftElbowPivot.rotation.x = -0.3;
    walkingPilot.rightElbowPivot.rotation.x = -0.3;
    // Bouncing legs
    walkingPilot.leftLegPivot.rotation.x = -s * 0.6;
    walkingPilot.rightLegPivot.rotation.x = s * 0.6;
    walkingPilot.leftKneePivot.rotation.x = Math.max(0, s) * 0.8;
    walkingPilot.rightKneePivot.rotation.x = Math.max(0, -s) * 0.8;

  } else if (player.speed > 0 && player.onGround) {
    // 7. Walk animation
    player.walkPhase += t * 8;
    const s = Math.sin(player.walkPhase);
    walkingPilot.leftArmPivot.rotation.x = s * 0.6;
    walkingPilot.rightArmPivot.rotation.x = -s * 0.6;
    walkingPilot.leftArmPivot.rotation.z = 0;
    walkingPilot.rightArmPivot.rotation.z = 0;
    walkingPilot.leftElbowPivot.rotation.x = -Math.abs(s) * 0.3;
    walkingPilot.rightElbowPivot.rotation.x = -Math.abs(s) * 0.3;
    walkingPilot.leftLegPivot.rotation.x = -s * 0.5;
    walkingPilot.rightLegPivot.rotation.x = s * 0.5;
    walkingPilot.leftKneePivot.rotation.x = Math.max(0, s) * 0.6;
    walkingPilot.rightKneePivot.rotation.x = Math.max(0, -s) * 0.6;

  } else {
    // 8. Idle (0-2s) — gradually return limbs to rest
    walkingPilot.leftArmPivot.rotation.x *= 0.9;
    walkingPilot.rightArmPivot.rotation.x *= 0.9;
    walkingPilot.leftArmPivot.rotation.z *= 0.9;
    walkingPilot.rightArmPivot.rotation.z *= 0.9;
    walkingPilot.leftLegPivot.rotation.x *= 0.9;
    walkingPilot.rightLegPivot.rotation.x *= 0.9;
    walkingPilot.leftKneePivot.rotation.x *= 0.9;
    walkingPilot.rightKneePivot.rotation.x *= 0.9;
    walkingPilot.leftElbowPivot.rotation.x *= 0.9;
    walkingPilot.rightElbowPivot.rotation.x *= 0.9;
  }

  // ── Camera follows walking pilot ──
  const cosP = Math.cos(mouse.pitch);
  const camOffX = Math.sin(mouse.yaw) * cosP * WALK_CAM_DIST;
  const camOffY = Math.sin(mouse.pitch) * WALK_CAM_DIST + 6;
  const camOffZ = Math.cos(mouse.yaw) * cosP * WALK_CAM_DIST;
  tmpVec.set(
    player.position.x + camOffX,
    player.position.y + camOffY,
    player.position.z + camOffZ
  );
  camera.position.lerp(tmpVec, t * 8);
  // Prevent camera from going below terrain
  const camTerrainY = getTerrainHeight(camera.position.x, camera.position.z) + 3;
  if (camera.position.y < camTerrainY) camera.position.y = camTerrainY;
  tmpVec2.set(player.position.x, player.position.y + 5, player.position.z);
  camera.lookAt(tmpVec2);

  // Move sun with player
  sunLight.position.copy(player.position).add(sunOffset);
  sunLight.target.position.copy(player.position);
  sunLight.target.updateMatrixWorld();
  sunOrb.position.copy(player.position).add(sunOffset.clone().normalize().multiplyScalar(8000));
  sunGlow.lookAt(camera.position);
}

function updateAutopilot(t) {
  if (!autopilot.active || autopilot.crashed) return;

  // Plane continues forward with gravity, gradually slowing
  autopilot.speed *= (1 - t * 0.3);
  flight.velocity.copy(autopilot.direction).multiplyScalar(autopilot.speed * 30);
  flight.velocity.y -= 20;
  flight.position.addScaledVector(flight.velocity, t);

  // Nose down gradually
  const pitchDown = new THREE.Quaternion().setFromAxisAngle(axisX, t * 0.3);
  flight.quaternion.multiply(pitchDown);
  flight.quaternion.normalize();

  // Update forward for exhaust
  forward.set(0, 0, -1).applyQuaternion(flight.quaternion);
  up.set(0, 1, 0).applyQuaternion(flight.quaternion);
  right.set(1, 0, 0).applyQuaternion(flight.quaternion);

  // Update airplane visual
  airplane.position.copy(flight.position);
  airplane.quaternion.copy(flight.quaternion);

  // Exhaust trail
  updateExhaust(t);

  // Terrain collision → plane crashes and explodes
  const terrH = getTerrainHeight(flight.position.x, flight.position.z);
  const groundH = Math.max(terrH, -40) + 5;
  if (flight.position.y < groundH) {
    autopilot.crashed = true;
    spawnExplosion(flight.position, 30);
    playExplosionSound();
    airplane.visible = false;
  }
}

function updateFlight(dt) {
  if (state !== "playing") return;

  const t = Math.min(dt, 0.05); // cap delta

  // ── Walking mode ──
  if (controlMode === "walking") {
    updateWalking(t);
    updateAutopilot(t);
    updateZombies(t);
    updateVillagers(t);
    if (state !== "playing") return;
    updateBullets(t);
    updateExplosions(t);
    // Score
    distanceTraveled += player.position.distanceTo(lastPosition);
    lastPosition.copy(player.position);
    score = targetsDestroyed * 200 + zombiesKilled * 500 + Math.floor(distanceTraveled * 0.05) + player.flowersCollected * 50 + player.moosePetted * 100 + Math.floor(player.maypoleScore);
    updateHUD();
    return;
  }

  // ── Flying mode ──
  // Input → control rates
  const pitchInput = (keys["KeyS"] || keys["ArrowDown"] ? 1 : 0) - (keys["KeyW"] || keys["ArrowUp"] ? 1 : 0);
  const rollInput = (keys["KeyA"] || keys["ArrowLeft"] ? 1 : 0) - (keys["KeyD"] || keys["ArrowRight"] ? 1 : 0);
  const yawInput = (keys["KeyQ"] ? 1 : 0) - (keys["KeyE"] ? 1 : 0);

  // Throttle
  if (keys["ShiftLeft"] || keys["ShiftRight"]) flight.throttle = Math.min(1, flight.throttle + t * 0.5);
  if (keys["ControlLeft"] || keys["ControlRight"]) flight.throttle = Math.max(0, flight.throttle - t * 0.5);

  flight.boost = !!keys["Space"];

  // Smooth control rates
  const sensitivity = 2.0;
  flight.pitch = THREE.MathUtils.lerp(flight.pitch, pitchInput * sensitivity, t * 4);
  flight.roll = THREE.MathUtils.lerp(flight.roll, rollInput * sensitivity * 1.5, t * 4);
  flight.yaw = THREE.MathUtils.lerp(flight.yaw, yawInput * sensitivity * 0.7, t * 4);

  // Apply rotations to quaternion
  tmpQuat.setFromAxisAngle(axisX, flight.pitch * t);
  flight.quaternion.multiply(tmpQuat);
  tmpQuat.setFromAxisAngle(axisY, flight.yaw * t);
  flight.quaternion.multiply(tmpQuat);
  tmpQuat.setFromAxisAngle(axisZ, flight.roll * t);
  flight.quaternion.multiply(tmpQuat);

  flight.quaternion.normalize();

  // Speed
  const targetSpeed = flight.throttle * flight.maxSpeed + flight.minSpeed;
  const boostMult = flight.boost ? 2.5 : 1;
  flight.speed = THREE.MathUtils.lerp(flight.speed, targetSpeed * boostMult, t * 2);

  // Forward direction
  forward.set(0, 0, -1).applyQuaternion(flight.quaternion);
  up.set(0, 1, 0).applyQuaternion(flight.quaternion);
  right.set(1, 0, 0).applyQuaternion(flight.quaternion);

  // Move
  flight.velocity.copy(forward).multiplyScalar(flight.speed * 30);

  // Slight gravity pull
  flight.velocity.y -= 3;

  // Lift based on speed and pitch
  const lift = Math.max(0, flight.speed / flight.maxSpeed) * 5;
  flight.velocity.y += lift;

  flight.position.addScaledVector(flight.velocity, t);

  // Terrain collision (waves affect water surface)
  const terrH = getTerrainHeight(flight.position.x, flight.position.z);
  const waveH = WATER_LEVEL + getWaveHeight(flight.position.x, flight.position.z, Date.now() * 0.001);
  const groundH = Math.max(terrH, waveH) + 5;

  if (flight.position.y < groundH) {
    crash();
    return;
  }

  // Update airplane
  airplane.position.copy(flight.position);
  airplane.quaternion.copy(flight.quaternion);

  // Pilot animation
  if (pilotCheerTimer > 0) {
    pilotCheerTimer -= t;
    // Wave arm enthusiastically
    airplane.pilotArmPivot.rotation.z = 0.5 + Math.sin(pilotCheerTimer * 14) * 0.8;
    airplane.pilotArmPivot.rotation.x = 0.3;
    // Bobbing head with excitement
    airplane.pilotHead.position.y = 2.05 + Math.sin(pilotCheerTimer * 10) * 0.08;
    airplane.pilotHead.rotation.z = Math.sin(pilotCheerTimer * 8) * 0.15;
  } else {
    // Resting pose: arm down, head still
    airplane.pilotArmPivot.rotation.z = 0;
    airplane.pilotArmPivot.rotation.x = 0;
    airplane.pilotHead.position.y = 2.05;
    airplane.pilotHead.rotation.z = 0;
  }

  // Camera: GTA-style orbital around plane
  // Compute orbit offset in world space from yaw/pitch angles
  const cosP = Math.cos(mouse.pitch);
  const camOffX = Math.sin(mouse.yaw) * cosP * CAM_DIST;
  const camOffY = Math.sin(mouse.pitch) * CAM_DIST;
  const camOffZ = Math.cos(mouse.yaw) * cosP * CAM_DIST;
  tmpVec.set(
    flight.position.x + camOffX,
    flight.position.y + camOffY,
    flight.position.z + camOffZ
  );
  camera.position.lerp(tmpVec, t * 8);
  camera.lookAt(flight.position);

  // Move sun with player
  sunLight.position.copy(flight.position).add(sunOffset);
  sunLight.target.position.copy(flight.position);
  sunLight.target.updateMatrixWorld();

  // Sun orb follows the light, always visible in the sky
  sunOrb.position.copy(flight.position).add(sunOffset.clone().normalize().multiplyScalar(8000));
  sunGlow.lookAt(camera.position);

  // Exhaust, machinegun, targets, zombies
  updateExhaust(t);
  updateZombies(t);
  updateVillagers(t);
  if (state !== "playing") return;
  updateBullets(t);
  updateExplosions(t);
  updateSounds();

  // Score from cumulative distance traveled (never decreases)
  distanceTraveled += flight.position.distanceTo(lastPosition);
  lastPosition.copy(flight.position);
  score = targetsDestroyed * 200 + zombiesKilled * 500 + Math.floor(distanceTraveled * 0.05) + player.flowersCollected * 50 + player.moosePetted * 100 + Math.floor(player.maypoleScore);

  // Update HUD
  updateHUD();
}

function crash() {
  state = "over";
  playCrashSound();
  stopContinuousSounds();
  if (controlMode === "walking") {
    spawnExplosion(player.position, 15);
  } else {
    spawnExplosion(flight.position, 20);
  }
  dom.finalScore.textContent = score;
  dom.crashScreen.classList.remove("hidden");
}

function updateHUD() {
  if (controlMode === "walking") {
    const alt = Math.max(0, Math.floor(player.position.y));
    dom.altVal.textContent = `${alt} m`;
    dom.altBar.style.width = `${Math.min(100, alt / 6)}%`;

    const spd = Math.floor(player.speed);
    dom.spdVal.textContent = `${spd} km/h`;
    dom.spdBar.style.width = `${Math.min(100, (player.speed / WALK_SPEED) * 50)}%`;

    // Check proximity to plane for prompt
    const dxPlane = player.position.x - flight.position.x;
    const dzPlane = player.position.z - flight.position.z;
    const distToPlane = Math.sqrt(dxPlane * dxPlane + dzPlane * dzPlane);
    const nearPlane = distToPlane < 30 && airplane.visible && !autopilot.crashed;

    dom.thrVal.textContent = player.swimming ? `SWIMMING` : nearPlane ? `[F] BOARD PLANE` : `ON FOOT`;
    dom.thrBar.style.width = `0%`;
  } else {
    const alt = Math.max(0, Math.floor(flight.position.y));
    const spd = Math.floor(flight.speed * 40);
    const thr = Math.floor(flight.throttle * 100);

    dom.altVal.textContent = `${alt} m`;
    dom.altBar.style.width = `${Math.min(100, alt / 6)}%`;

    dom.spdVal.textContent = `${spd} km/h`;
    dom.spdBar.style.width = `${Math.min(100, (flight.speed / (flight.maxSpeed * 2.5)) * 100)}%`;

    dom.thrVal.textContent = `${thr}%`;
    dom.thrBar.style.width = `${thr}%`;
  }

  dom.scoreDisplay.textContent = score;
  const aliveZombies = ZOMBIE_COUNT - zombiesKilled;
  dom.ringsLeft.textContent = `Targets: ${targetsDestroyed}/${targets.length}  |  Zombies: ${zombiesKilled} killed  |  Flowers: ${player.flowersCollected}  |  Moose: ${player.moosePetted}`;

  // Compass
  let heading;
  if (controlMode === "walking") {
    heading = player.yaw * (180 / Math.PI);
  } else {
    heading = Math.atan2(forward.x, -forward.z) * (180 / Math.PI);
  }
  const h = ((heading % 360) + 360) % 360;
  let dir = "N";
  if (h > 337.5 || h <= 22.5) dir = "N";
  else if (h > 22.5 && h <= 67.5) dir = "NE";
  else if (h > 67.5 && h <= 112.5) dir = "E";
  else if (h > 112.5 && h <= 157.5) dir = "SE";
  else if (h > 157.5 && h <= 202.5) dir = "S";
  else if (h > 202.5 && h <= 247.5) dir = "SW";
  else if (h > 247.5 && h <= 292.5) dir = "W";
  else if (h > 292.5 && h <= 337.5) dir = "NW";
  dom.compass.textContent = `${dir}  ${Math.floor(h)}°`;

  // Pull up warning (only in flight mode)
  if (controlMode === "flying") {
    const terrH = getTerrainHeight(flight.position.x, flight.position.z);
    if (flight.position.y - Math.max(terrH, -40) < 40 && flight.velocity.y < 0) {
      dom.warning.style.display = "block";
    } else {
      dom.warning.style.display = "none";
    }
  } else {
    dom.warning.style.display = "none";
  }
}

// ─── Render Loop ─────────────────────────────────────────────
let fpsFrames = 0, fpsTime = 0, fpsDisplay = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();

  fpsFrames++;
  fpsTime += dt;
  if (fpsTime >= 0.5) {
    fpsDisplay = Math.round(fpsFrames / fpsTime);
    dom.fps.textContent = fpsDisplay + " FPS";
    fpsFrames = 0;
    fpsTime = 0;
  }

  updateFlight(dt);

  // Animate water waves
  const waveTime = Date.now() * 0.001;
  animateWaves(waveTime);
  water.material.opacity = 0.65 + Math.sin(waveTime) * 0.08;

  // Bob boats on waves
  for (const b of boats) {
    const wh = getWaveHeight(b.baseX, b.baseZ, waveTime);
    b.group.position.y = WATER_LEVEL + wh + 0.5;
    b.group.rotation.x = Math.sin(waveTime * 1.2 + b.baseX * 0.01) * 0.08;
    b.group.rotation.z = Math.cos(waveTime * 0.9 + b.baseZ * 0.01) * 0.06;
  }

  // Animate aurora borealis - gentle swaying and pulsing
  const now = Date.now() * 0.001;
  for (let i = 0; i < auroraGroup.children.length; i++) {
    const curtain = auroraGroup.children[i];
    curtain.position.x += Math.sin(now * 0.3 + i) * 0.5;
    curtain.material.opacity = 0.06 + Math.sin(now * 0.5 + i * 1.7) * 0.04;
    curtain.rotation.y = Math.sin(now * 0.1 + i * 0.8) * 0.15;
  }

  renderer.render(scene, camera);

  // Screenshot flash overlay
  if (screenshotFlashTimer > 0) {
    screenshotFlashTimer -= dt;
    const alpha = Math.max(0, screenshotFlashTimer / 0.3) * 0.6;
    const ctx2d = renderer.domElement.getContext("2d", { willReadFrequently: false });
    if (!ctx2d) {
      // WebGL canvas — draw flash via DOM overlay
      let flash = document.getElementById("screenshot-flash");
      if (!flash) {
        flash = document.createElement("div");
        flash.id = "screenshot-flash";
        flash.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:50;background:white;transition:opacity 0.3s;";
        document.body.appendChild(flash);
      }
      flash.style.opacity = alpha;
    }
  }
}

// ─── UI ──────────────────────────────────────────────────────
document.getElementById("start-btn").addEventListener("click", () => {
  initAudio();
  dom.startScreen.classList.add("hidden");
  resetFlight();
  mouse.yaw = -0.54; mouse.pitch = 0.3; // face toward airport
  state = "playing";
  clock.start();
  renderer.domElement.requestPointerLock();
});

document.getElementById("restart-btn").addEventListener("click", () => {
  initAudio();
  dom.crashScreen.classList.add("hidden");
  resetFlight();
  mouse.yaw = -0.54; mouse.pitch = 0.3;
  state = "playing";
  clock.start();
  renderer.domElement.requestPointerLock();
});

// ─── Init ────────────────────────────────────────────────────
resetFlight();
animate();
