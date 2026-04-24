import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import init, { GravitySimulation } from "../rust-physics/pkg/rust_physics.js";
import { inject } from "@vercel/analytics";
import { injectSpeedInsights } from "@vercel/speed-insights";

// Initialize Vercel Web Analytics
inject();

// Initialize Vercel Speed Insights
injectSpeedInsights();

const DISTANCE_SCALE = 1.18;
const QUALITY = { starCount: 3600, trailLength: 190, trailStep: 3, pixelRatio: 1.8 };
const GESTURE_WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const HAND_MODEL_URL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const refs = {
  canvas: document.querySelector("#scene"),
  gestureVideo: document.querySelector("#gesture-video")
};

const renderer = new THREE.WebGLRenderer({ canvas: refs.canvas, antialias: true, alpha: false });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, QUALITY.pixelRatio));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.22;
renderer.setClearColor("#010308");

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2("#03060d", 0.00085);

const camera = new THREE.PerspectiveCamera(44, window.innerWidth / window.innerHeight, 0.1, 2600);
camera.position.set(0, 40, 170);

const controls = new OrbitControls(camera, refs.canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.enablePan = false;
controls.minDistance = 16;
controls.maxDistance = 760;
controls.target.set(0, 0, 0);

const ambientLight = new THREE.AmbientLight("#80a4ff", 0.22);
const hemisphereLight = new THREE.HemisphereLight("#6e90ff", "#050a12", 0.42);
const sunLight = new THREE.PointLight("#ffd089", 4.1, 2200, 1.35);
scene.add(ambientLight, hemisphereLight, sunLight);

let simulation;
let metadata = [];
let bodyEntries = [];
let trailEntries = [];
let nebulaGroup;
let starGroup;
let cometEntries = [];
let gravityFieldGroup;
let orbitGuideGroup;
let moonGuide;
let trailFrameCounter = 0;

const gestureState = {
  stream: null,
  vision: null,
  handLandmarker: null,
  FilesetResolver: null,
  HandLandmarker: null,
  lastVideoTime: -1,
  lastPinchDistance: null,
  lastPalmToggleAt: 0,
  enabled: false
};

function hexColor(hex) {
  return new THREE.Color(hex);
}

function seededRandom(seed) {
  const x = Math.sin(seed * 127.1) * 43758.5453123;
  return x - Math.floor(x);
}

function createSurfaceCanvas(width = 1024, height = 512) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return { canvas, ctx: canvas.getContext("2d") };
}

function createRadialTexture(stops, width = 512, height = 512) {
  const { canvas, ctx } = createSurfaceCanvas(width, height);
  const gradient = ctx.createRadialGradient(width * 0.5, height * 0.5, 0, width * 0.5, height * 0.5, width * 0.5);
  stops.forEach((stop) => gradient.addColorStop(stop.offset, stop.color));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createSoftCloudTexture(primaryHex, secondaryHex, accentHex, width = 1024, height = 1024) {
  const { canvas, ctx } = createSurfaceCanvas(width, height);
  const primary = hexColor(primaryHex);
  const secondary = hexColor(secondaryHex);
  const accent = hexColor(accentHex);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < 22; i += 1) {
    const x = seededRandom(i + 11) * canvas.width;
    const y = seededRandom(i + 31) * canvas.height;
    const radius = 120 + seededRandom(i + 71) * 280;
    const color = primary.clone().lerp(secondary, seededRandom(i + 121)).lerp(accent, seededRandom(i + 191) * 0.2);
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `rgba(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)}, 0.22)`);
    gradient.addColorStop(0.42, `rgba(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)}, 0.1)`);
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createRockyTexture(baseHex, accentHex, craterHex, ridgeHex) {
  const { canvas, ctx } = createSurfaceCanvas();
  const base = hexColor(baseHex);
  const accent = hexColor(accentHex);
  const crater = hexColor(craterHex);
  const ridge = hexColor(ridgeHex);
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, `#${base.getHexString()}`);
  gradient.addColorStop(0.52, `#${accent.getHexString()}`);
  gradient.addColorStop(1, `#${base.clone().offsetHSL(0, -0.04, -0.1).getHexString()}`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < 340; i += 1) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    const radius = 4 + Math.random() * 32;
    const tone = Math.random() > 0.5 ? accent.clone().lerp(base, 0.4) : ridge.clone().lerp(base, 0.25);
    ctx.beginPath();
    ctx.fillStyle = `rgba(${Math.round(tone.r * 255)}, ${Math.round(tone.g * 255)}, ${Math.round(tone.b * 255)}, ${0.04 + Math.random() * 0.1})`;
    ctx.ellipse(x, y, radius * (0.5 + Math.random() * 0.8), radius * (0.35 + Math.random() * 0.65), Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  for (let i = 0; i < 130; i += 1) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    const radius = 3 + Math.random() * 18;
    ctx.beginPath();
    ctx.strokeStyle = `rgba(${Math.round(crater.r * 255)}, ${Math.round(crater.g * 255)}, ${Math.round(crater.b * 255)}, ${0.14 + Math.random() * 0.18})`;
    ctx.lineWidth = 0.8 + Math.random() * 2.2;
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function createEarthTexture() {
  const { canvas, ctx } = createSurfaceCanvas();
  const ocean = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  ocean.addColorStop(0, "#0d3d71");
  ocean.addColorStop(0.48, "#2378cf");
  ocean.addColorStop(1, "#0a213e");
  ctx.fillStyle = ocean;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < 72; i += 1) {
    ctx.beginPath();
    ctx.fillStyle = `rgba(${40 + Math.random() * 40}, ${95 + Math.random() * 80}, ${35 + Math.random() * 25}, ${0.34 + Math.random() * 0.26})`;
    ctx.ellipse(Math.random() * canvas.width, Math.random() * canvas.height, 24 + Math.random() * 90, 10 + Math.random() * 42, Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  for (let i = 0; i < 180; i += 1) {
    ctx.beginPath();
    ctx.fillStyle = `rgba(248, 248, 255, ${0.03 + Math.random() * 0.08})`;
    ctx.ellipse(Math.random() * canvas.width, Math.random() * canvas.height, 18 + Math.random() * 90, 8 + Math.random() * 34, Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function createGasTexture(baseHex, bandHexA, bandHexB, stormHex) {
  const { canvas, ctx } = createSurfaceCanvas();
  const base = hexColor(baseHex);
  const bandA = hexColor(bandHexA);
  const bandB = hexColor(bandHexB);
  const storm = hexColor(stormHex);
  ctx.fillStyle = `#${base.getHexString()}`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  let y = 0;
  while (y < canvas.height) {
    const bandHeight = 10 + Math.random() * 28;
    const mix = Math.random() > 0.5 ? bandA : bandB;
    ctx.fillStyle = `rgba(${Math.round(mix.r * 255)}, ${Math.round(mix.g * 255)}, ${Math.round(mix.b * 255)}, ${0.24 + Math.random() * 0.2})`;
    ctx.fillRect(0, y, canvas.width, bandHeight);
    y += bandHeight;
  }

  for (let i = 0; i < 180; i += 1) {
    const x = Math.random() * canvas.width;
    const yPos = Math.random() * canvas.height;
    const width = 32 + Math.random() * 180;
    const height = 6 + Math.random() * 24;
    ctx.beginPath();
    ctx.fillStyle = `rgba(${Math.round(storm.r * 255)}, ${Math.round(storm.g * 255)}, ${Math.round(storm.b * 255)}, ${0.04 + Math.random() * 0.12})`;
    ctx.ellipse(x, yPos, width, height, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function createVenusTexture() {
  const { canvas, ctx } = createSurfaceCanvas();
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, "#c89c63");
  gradient.addColorStop(0.45, "#e2c192");
  gradient.addColorStop(1, "#8f623f");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < 260; i += 1) {
    ctx.beginPath();
    ctx.fillStyle = `rgba(252, 232, 194, ${0.03 + Math.random() * 0.08})`;
    ctx.ellipse(Math.random() * canvas.width, Math.random() * canvas.height, 26 + Math.random() * 110, 12 + Math.random() * 44, Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}
function createSunTexture() {
  const { canvas, ctx } = createSurfaceCanvas();
  const radial = ctx.createRadialGradient(canvas.width * 0.5, canvas.height * 0.5, 8, canvas.width * 0.5, canvas.height * 0.5, canvas.width * 0.54);
  radial.addColorStop(0, "#fff4b3");
  radial.addColorStop(0.28, "#ffd15e");
  radial.addColorStop(0.62, "#ff8e2d");
  radial.addColorStop(0.9, "#cc4b11");
  radial.addColorStop(1, "#4f1205");
  ctx.fillStyle = radial;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < 340; i += 1) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    const rx = 14 + Math.random() * 56;
    const ry = 8 + Math.random() * 28;
    ctx.beginPath();
    ctx.fillStyle = `rgba(255, ${150 + Math.random() * 70}, ${20 + Math.random() * 40}, ${0.04 + Math.random() * 0.14})`;
    ctx.ellipse(x, y, rx, ry, Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  for (let i = 0; i < 80; i += 1) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    ctx.strokeStyle = `rgba(255, ${190 + Math.random() * 40}, 100, ${0.08 + Math.random() * 0.08})`;
    ctx.lineWidth = 2 + Math.random() * 3;
    ctx.beginPath();
    ctx.moveTo(x - 18, y - 8);
    ctx.bezierCurveTo(x + 12, y - 24, x + 28, y + 12, x + 46, y + 6);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function createRingTexture() {
  const { canvas, ctx } = createSurfaceCanvas(1024, 128);
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
  gradient.addColorStop(0, "rgba(210, 188, 145, 0.0)");
  gradient.addColorStop(0.12, "rgba(218, 194, 144, 0.38)");
  gradient.addColorStop(0.32, "rgba(243, 226, 182, 0.86)");
  gradient.addColorStop(0.54, "rgba(184, 159, 114, 0.42)");
  gradient.addColorStop(0.78, "rgba(246, 230, 188, 0.72)");
  gradient.addColorStop(1, "rgba(210, 188, 145, 0.0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let x = 0; x < canvas.width; x += 4) {
    ctx.fillStyle = `rgba(255, 255, 255, ${0.015 + Math.random() * 0.09})`;
    ctx.fillRect(x, 0, 1 + Math.random() * 2, canvas.height);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function getPlanetProfile(bodyMeta) {
  switch (bodyMeta.name) {
    case "Sun":
      return {
        map: createSunTexture(),
        roughness: 0.34,
        emissiveIntensity: 2.1,
        glowOpacity: 0.24,
        atmosphereOpacity: 0,
        haloTexture: createRadialTexture([
          { offset: 0, color: "rgba(255, 245, 180, 0.95)" },
          { offset: 0.24, color: "rgba(255, 196, 92, 0.45)" },
          { offset: 0.72, color: "rgba(255, 118, 22, 0.12)" },
          { offset: 1, color: "rgba(255, 118, 22, 0)" }
        ])
      };
    case "Mercury":
      return { map: createRockyTexture("#8e7f73", "#b19a89", "#4a3e38", "#78685f"), roughness: 0.98, emissiveIntensity: 0.02, glowOpacity: 0.02, atmosphereOpacity: 0 };
    case "Venus":
      return { map: createVenusTexture(), roughness: 0.94, emissiveIntensity: 0.03, glowOpacity: 0.03, atmosphereOpacity: 0.1, atmosphereColor: "#f4d8b0" };
    case "Earth":
      return { map: createEarthTexture(), roughness: 0.88, emissiveIntensity: 0.04, glowOpacity: 0.04, atmosphereOpacity: 0.12, atmosphereColor: "#90d9ff" };
    case "Moon":
      return { map: createRockyTexture("#d2d6dc", "#aeb3bb", "#6e7680", "#e7e9ee"), roughness: 1, emissiveIntensity: 0.01, glowOpacity: 0.015, atmosphereOpacity: 0 };
    case "Mars":
      return { map: createRockyTexture("#9f4f37", "#c97854", "#5a342a", "#d9a178"), roughness: 0.94, emissiveIntensity: 0.025, glowOpacity: 0.025, atmosphereOpacity: 0.035, atmosphereColor: "#ffb292" };
    case "Jupiter":
      return { map: createGasTexture("#b6926b", "#ead0af", "#8b6148", "#f4e7ca"), roughness: 0.78, emissiveIntensity: 0.03, glowOpacity: 0.03, atmosphereOpacity: 0.03, atmosphereColor: "#ffe3bc" };
    case "Saturn":
      return { map: createGasTexture("#cfbf8d", "#f0e1ad", "#9e835c", "#fff2d0"), roughness: 0.8, emissiveIntensity: 0.028, glowOpacity: 0.03, atmosphereOpacity: 0.03, atmosphereColor: "#fff0bf" };
    case "Uranus":
      return { map: createGasTexture("#7dc9d5", "#c1fbff", "#69a7b3", "#e0ffff"), roughness: 0.84, emissiveIntensity: 0.028, glowOpacity: 0.028, atmosphereOpacity: 0.07, atmosphereColor: "#bffcff" };
    case "Neptune":
      return { map: createGasTexture("#3e67c1", "#7aa2ff", "#264384", "#b7c9ff"), roughness: 0.84, emissiveIntensity: 0.03, glowOpacity: 0.03, atmosphereOpacity: 0.07, atmosphereColor: "#b0c5ff" };
    default:
      return { map: createRockyTexture(bodyMeta.color, bodyMeta.glow_color, "#43352f", "#8c7564"), roughness: 0.92, emissiveIntensity: 0.03, glowOpacity: 0.03, atmosphereOpacity: 0 };
  }
}

function createNebulaField() {
  nebulaGroup = new THREE.Group();
  const setups = [
    { pos: [-340, 170, -520], scale: [520, 320, 1], colors: ["#3f57c6", "#7f3ed1", "#d04bf0"] },
    { pos: [390, -140, -620], scale: [560, 340, 1], colors: ["#0f8fb6", "#4ae0d1", "#6c5cff"] },
    { pos: [-80, -230, -470], scale: [460, 270, 1], colors: ["#273f9f", "#4c9df2", "#ff884d"] },
    { pos: [120, 220, -700], scale: [640, 360, 1], colors: ["#6136be", "#d34f9f", "#f0a257"] }
  ];

  setups.forEach((setup, index) => {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: createSoftCloudTexture(setup.colors[0], setup.colors[1], setup.colors[2]),
        transparent: true,
        opacity: 0.34,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide
      })
    );
    mesh.position.set(...setup.pos);
    mesh.scale.set(...setup.scale);
    mesh.rotation.z = index * 0.23;
    nebulaGroup.add(mesh);
  });

  scene.add(nebulaGroup);
}

function createStarField() {
  starGroup = new THREE.Group();
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(QUALITY.starCount * 3);
  const colors = new Float32Array(QUALITY.starCount * 3);

  for (let i = 0; i < QUALITY.starCount; i += 1) {
    const radius = 220 + Math.random() * 760;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = radius * Math.cos(phi) * 0.76;
    positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta) - 180;
    const tint = new THREE.Color(i % 11 === 0 ? "#ffdca8" : i % 9 === 0 ? "#9cd8ff" : "#f8fbff");
    colors[i * 3] = tint.r;
    colors[i * 3 + 1] = tint.g;
    colors[i * 3 + 2] = tint.b;
  }

  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const points = new THREE.Points(geometry, new THREE.PointsMaterial({ size: 1.18, sizeAttenuation: true, transparent: true, opacity: 0.96, vertexColors: true, depthWrite: false }));
  starGroup.add(points);
  scene.add(starGroup);
}

function createGravityNet(size = 240, divisions = 28) {
  const group = new THREE.Group();
  const material = new THREE.LineBasicMaterial({ color: "#4da8ff", transparent: true, opacity: 0.18 });
  const depthAt = (x, z) => {
    const r = Math.sqrt(x * x + z * z);
    return -9 * Math.exp(-(r * r) / 2800) - 2.1 / (1 + r * 0.08);
  };
  const step = size / divisions;
  const half = size / 2;

  for (let i = 0; i <= divisions; i += 1) {
    const x = -half + i * step;
    const pointsX = [];
    const pointsZ = [];
    for (let j = 0; j <= divisions; j += 1) {
      const z = -half + j * step;
      pointsX.push(new THREE.Vector3(x, depthAt(x, z), z));
      pointsZ.push(new THREE.Vector3(z, depthAt(z, x), x));
    }
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pointsX), material.clone()));
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pointsZ), material.clone()));
  }

  const centerRing = new THREE.Mesh(
    new THREE.RingGeometry(9, 11.6, 80),
    new THREE.MeshBasicMaterial({ color: "#61c7ff", transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false })
  );
  centerRing.rotation.x = -Math.PI / 2;
  centerRing.position.y = 0.25;
  group.add(centerRing);
  return group;
}

function createOrbitPath(radius, color, inclination = 0, segments = 180) {
  const points = [];
  for (let i = 0; i <= segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const y = z * Math.sin(inclination) * 0.35;
    points.push(new THREE.Vector3(x, y, z * Math.cos(inclination * 0.4)));
  }
  return new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.24 }));
}
function createBodyVisual(bodyMeta, index) {
  const root = new THREE.Group();
  root.userData.bodyIndex = index;

  const profile = getPlanetProfile(bodyMeta);
  const material = new THREE.MeshStandardMaterial({
    map: profile.map,
    color: bodyMeta.color,
    emissive: hexColor(bodyMeta.glow_color),
    emissiveIntensity: profile.emissiveIntensity,
    roughness: profile.roughness,
    metalness: 0.01
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(bodyMeta.radius, 64, 64), material);
  root.add(mesh);

  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(bodyMeta.radius * (bodyMeta.is_sun ? 3.15 : 1.08), 34, 34),
    new THREE.MeshBasicMaterial({ color: bodyMeta.glow_color, transparent: true, opacity: profile.glowOpacity, depthWrite: false })
  );
  root.add(glow);

  let atmosphere = null;
  if (profile.atmosphereOpacity > 0) {
    atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(bodyMeta.radius * 1.1, 34, 34),
      new THREE.MeshBasicMaterial({ color: profile.atmosphereColor ?? bodyMeta.glow_color, transparent: true, opacity: profile.atmosphereOpacity, depthWrite: false })
    );
    root.add(atmosphere);
  }

  const extras = {};
  if (bodyMeta.is_sun) {
    const haloInner = new THREE.Sprite(new THREE.SpriteMaterial({ map: profile.haloTexture, color: "#fff0a8", transparent: true, opacity: 0.62, depthWrite: false, blending: THREE.AdditiveBlending }));
    haloInner.scale.setScalar(bodyMeta.radius * 6.2);
    const haloOuter = new THREE.Sprite(new THREE.SpriteMaterial({ map: profile.haloTexture, color: "#ff993f", transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending }));
    haloOuter.scale.setScalar(bodyMeta.radius * 10.5);
    const corona = new THREE.Mesh(
      new THREE.SphereGeometry(bodyMeta.radius * 1.22, 40, 40),
      new THREE.MeshBasicMaterial({ color: "#ffb056", transparent: true, opacity: 0.16, depthWrite: false })
    );
    root.add(corona, haloInner, haloOuter);
    Object.assign(extras, { haloInner, haloOuter, corona });
  }

  if (bodyMeta.name === "Saturn") {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(bodyMeta.radius * 1.7, bodyMeta.radius * 3.2, 160),
      new THREE.MeshBasicMaterial({ map: createRingTexture(), color: "#e1d6a8", transparent: true, opacity: 0.66, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.rotation.x = Math.PI / 2.62;
    root.add(ring);
    extras.ring = ring;
  }

  scene.add(root);
  return { metadata: bodyMeta, root, mesh, glow, material, atmosphere, ...extras };
}

function createTrail(bodyMeta) {
  const line = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: bodyMeta.trail_color, transparent: true, opacity: 0.12 })
  );
  scene.add(line);
  return { line, history: [], maxPoints: QUALITY.trailLength };
}

function createCometMaterial(innerColor, outerColor) {
  return new THREE.SpriteMaterial({
    map: createRadialTexture([
      { offset: 0, color: innerColor },
      { offset: 0.28, color: outerColor },
      { offset: 1, color: "rgba(255,255,255,0)" }
    ], 256, 256),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
}

const cometPosition = new THREE.Vector3();
const cometDirection = new THREE.Vector3();
const cometDrift = new THREE.Vector3();

function createComets() {
  cometEntries = [
    { head: ["rgba(245, 252, 255, 1)", "rgba(118, 202, 255, 0.5)"], tail: ["rgba(174, 229, 255, 0.45)", "rgba(92, 164, 255, 0.08)"], radiusX: 300, radiusY: 126, depth: -320, speed: 0.034, angle: 0.3 },
    { head: ["rgba(255, 246, 226, 1)", "rgba(255, 183, 112, 0.46)"], tail: ["rgba(255, 216, 166, 0.42)", "rgba(255, 166, 84, 0.08)"], radiusX: 420, radiusY: 154, depth: -430, speed: 0.024, angle: Math.PI }
  ].map((config) => {
    const head = new THREE.Sprite(createCometMaterial(config.head[0], config.head[1]));
    head.scale.set(6, 6, 1);

    const tailSprites = Array.from({ length: 16 }, (_, index) => {
      const sprite = new THREE.Sprite(createCometMaterial(config.tail[0], config.tail[1]));
      sprite.scale.set(18 - index * 0.75, 6.5 - index * 0.22, 1);
      sprite.material.opacity = 0.46 - index * 0.022;
      scene.add(sprite);
      return sprite;
    });

    scene.add(head);
    return { ...config, head, tailSprites, lastPosition: new THREE.Vector3(), initialized: false };
  });
}

function createGravityField(initialFlatPositions) {
  gravityFieldGroup = new THREE.Group();
  gravityFieldGroup.add(createGravityNet());

  orbitGuideGroup = new THREE.Group();
  const sun = new THREE.Vector3(initialFlatPositions[0], initialFlatPositions[1], initialFlatPositions[2]).multiplyScalar(DISTANCE_SCALE);

  metadata.forEach((bodyMeta, index) => {
    if (bodyMeta.is_sun || bodyMeta.name === "Moon") {
      return;
    }

    const offset = index * 3;
    const body = new THREE.Vector3(initialFlatPositions[offset], initialFlatPositions[offset + 1], initialFlatPositions[offset + 2]).multiplyScalar(DISTANCE_SCALE);
    const relative = body.sub(sun);
    const radius = Math.sqrt(relative.x * relative.x + relative.z * relative.z);
    const inclination = Math.atan2(relative.y, Math.max(radius, 0.001));
    orbitGuideGroup.add(createOrbitPath(radius, bodyMeta.trail_color, inclination));
  });

  gravityFieldGroup.add(orbitGuideGroup);
  scene.add(gravityFieldGroup);

  const earthIndex = metadata.findIndex((bodyMeta) => bodyMeta.name === "Earth");
  const moonIndex = metadata.findIndex((bodyMeta) => bodyMeta.name === "Moon");
  const earth = new THREE.Vector3(initialFlatPositions[earthIndex * 3], initialFlatPositions[earthIndex * 3 + 1], initialFlatPositions[earthIndex * 3 + 2]).multiplyScalar(DISTANCE_SCALE);
  const moon = new THREE.Vector3(initialFlatPositions[moonIndex * 3], initialFlatPositions[moonIndex * 3 + 1], initialFlatPositions[moonIndex * 3 + 2]).multiplyScalar(DISTANCE_SCALE);
  const moonRelative = moon.sub(earth);
  const moonRadius = Math.sqrt(moonRelative.x * moonRelative.x + moonRelative.z * moonRelative.z);
  const moonInclination = Math.atan2(moonRelative.y, Math.max(moonRadius, 0.001));
  moonGuide = createOrbitPath(moonRadius, "#e8edf6", moonInclination, 96);
}

function buildFocus() {
  controls.target.set(0, 0, 0);
  controls.update();
}

function updateBodyPositions(flatPositions) {
  for (let i = 0; i < bodyEntries.length; i += 1) {
    const offset = i * 3;
    bodyEntries[i].root.position.set(
      flatPositions[offset] * DISTANCE_SCALE,
      flatPositions[offset + 1] * DISTANCE_SCALE,
      flatPositions[offset + 2] * DISTANCE_SCALE
    );
  }

  sunLight.position.copy(bodyEntries[0].root.position);
  controls.target.copy(bodyEntries[0].root.position);

  if (gravityFieldGroup) {
    gravityFieldGroup.position.copy(bodyEntries[0].root.position);
  }

  if (moonGuide) {
    const earthEntry = bodyEntries.find((entry) => entry.metadata.name === "Earth");
    if (earthEntry && moonGuide.parent !== earthEntry.root) {
      earthEntry.root.add(moonGuide);
    }
  }
}

function updateTrails() {
  trailFrameCounter += 1;
  if (trailFrameCounter % QUALITY.trailStep !== 0) {
    return;
  }

  trailEntries.forEach((trail, index) => {
    const point = bodyEntries[index + 1].root.position.clone();
    trail.history.push(point);
    if (trail.history.length > trail.maxPoints) {
      trail.history.shift();
    }
    trail.line.geometry.setFromPoints(trail.history);
  });
}
function updatePlanetLooks(elapsed) {
  const spinMap = {
    Sun: 0.0027,
    Mercury: 0.0015,
    Venus: -0.00022,
    Earth: 0.0018,
    Moon: 0.00055,
    Mars: 0.00145,
    Jupiter: 0.0025,
    Saturn: 0.0022,
    Uranus: 0.0018,
    Neptune: 0.0019
  };

  bodyEntries.forEach((entry) => {
    entry.mesh.rotation.y += spinMap[entry.metadata.name] ?? 0.0012;

    if (entry.metadata.is_sun) {
      entry.material.emissiveIntensity = 1.95 + Math.sin(elapsed * 2.1) * 0.18;
      entry.glow.scale.setScalar(1 + 0.06 * Math.sin(elapsed * 1.55));
      if (entry.corona) {
        entry.corona.scale.setScalar(1 + 0.03 * Math.sin(elapsed * 1.4));
      }
      if (entry.haloInner) {
        entry.haloInner.material.rotation += 0.0016;
        entry.haloInner.scale.setScalar(entry.metadata.radius * (6.1 + Math.sin(elapsed * 1.2) * 0.25));
      }
      if (entry.haloOuter) {
        entry.haloOuter.material.rotation -= 0.0009;
        entry.haloOuter.scale.setScalar(entry.metadata.radius * (10.3 + Math.sin(elapsed * 0.9) * 0.35));
      }
    }
  });
}

function updateBackground(elapsed, delta) {
  if (starGroup) {
    starGroup.rotation.y += delta * 0.0015;
  }

  if (nebulaGroup) {
    nebulaGroup.children.forEach((mesh, index) => {
      mesh.rotation.z += delta * (0.003 + index * 0.0004);
      mesh.material.opacity = 0.26 + Math.sin(elapsed * (0.05 + index * 0.01)) * 0.05;
    });
  }

  cometEntries.forEach((comet, index) => {
    if (!comet?.head || !comet?.lastPosition || !Array.isArray(comet.tailSprites)) {
      return;
    }

    comet.angle += delta * (comet.speed ?? 0);
    cometPosition.set(
      Math.cos(comet.angle) * comet.radiusX,
      Math.sin(comet.angle * 1.15) * comet.radiusY + (index === 0 ? 110 : -120),
      comet.depth + Math.sin(comet.angle * 0.62) * 85
    );

    if (!comet.initialized) {
      comet.lastPosition.copy(cometPosition);
      comet.initialized = true;
    }

    cometDirection.copy(comet.lastPosition).sub(cometPosition);
    if (cometDirection.lengthSq() < 0.000001) {
      cometDirection.set(-1, 0, 0);
    } else {
      cometDirection.normalize();
    }

    comet.head.position.copy(cometPosition);

    comet.tailSprites.forEach((sprite, spriteIndex) => {
      if (!sprite) {
        return;
      }

      const distance = 7 + spriteIndex * 8.5;
      cometDrift.set(
        Math.sin(elapsed * 0.8 + spriteIndex) * 0.5,
        Math.cos(elapsed * 0.7 + spriteIndex * 0.3) * 0.3,
        0
      );
      sprite.position.copy(cometPosition).addScaledVector(cometDirection, distance).add(cometDrift);
      if (sprite.material) {
        sprite.material.opacity = Math.max(0, 0.35 - spriteIndex * 0.018);
      }
    });

    comet.lastPosition.copy(cometPosition);
  });
}

function resizeRenderer() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, QUALITY.pixelRatio));
}

function orbitCamera(deltaTheta, deltaPhi) {
  const offset = camera.position.clone().sub(controls.target);
  const spherical = new THREE.Spherical().setFromVector3(offset);
  spherical.theta -= deltaTheta;
  spherical.phi = THREE.MathUtils.clamp(spherical.phi - deltaPhi, 0.2, Math.PI - 0.2);
  offset.setFromSpherical(spherical);
  camera.position.copy(controls.target).add(offset);
  camera.lookAt(controls.target);
}

function zoomCamera(scaleFactor) {
  const offset = camera.position.clone().sub(controls.target);
  const nextLength = THREE.MathUtils.clamp(offset.length() * scaleFactor, controls.minDistance, controls.maxDistance);
  offset.setLength(nextLength);
  camera.position.copy(controls.target).add(offset);
}

function isOpenPalm(landmarks) {
  const wrist = landmarks[0];
  const thumb = landmarks[4];
  const fingertips = [landmarks[8], landmarks[12], landmarks[16], landmarks[20]];
  const avgDistance = fingertips.reduce((sum, point) => sum + Math.hypot(point.x - wrist.x, point.y - wrist.y), 0) / fingertips.length;
  const spread = Math.hypot(thumb.x - landmarks[20].x, thumb.y - landmarks[20].y);
  return avgDistance > 0.22 && spread > 0.22;
}

function updateGestureControls(now) {
  if (!gestureState.enabled || !gestureState.handLandmarker || refs.gestureVideo.readyState < 2) {
    return;
  }

  if (refs.gestureVideo.currentTime === gestureState.lastVideoTime) {
    return;
  }

  gestureState.lastVideoTime = refs.gestureVideo.currentTime;
  const result = gestureState.handLandmarker.detectForVideo(refs.gestureVideo, now);
  const landmarks = result.landmarks?.[0];

  if (!landmarks) {
    gestureState.lastPinchDistance = null;
    return;
  }

  const wrist = landmarks[0];
  const deltaX = THREE.MathUtils.clamp(wrist.x - 0.5, -0.32, 0.32);
  const deltaY = THREE.MathUtils.clamp(wrist.y - 0.5, -0.28, 0.28);

  if (Math.abs(deltaX) > 0.03 || Math.abs(deltaY) > 0.03) {
    orbitCamera(deltaX * 0.055, deltaY * 0.045);
  }

  const pinchDistance = Math.hypot(landmarks[4].x - landmarks[8].x, landmarks[4].y - landmarks[8].y);
  if (gestureState.lastPinchDistance !== null) {
    const pinchDelta = pinchDistance - gestureState.lastPinchDistance;
    if (Math.abs(pinchDelta) > 0.004) {
      zoomCamera(THREE.MathUtils.clamp(1 - pinchDelta * 4.2, 0.92, 1.08));
    }
  }
  gestureState.lastPinchDistance = pinchDistance;

  if (isOpenPalm(landmarks) && now - gestureState.lastPalmToggleAt > 1400) {
    gestureState.lastPalmToggleAt = now;
    simulation.set_paused(!simulation.is_paused());
  }
}

async function enableAutoGestureMode() {
  if (!navigator.mediaDevices?.getUserMedia) {
    return;
  }

  try {
    if (!gestureState.FilesetResolver || !gestureState.HandLandmarker) {
      const tasksVision = await import("@mediapipe/tasks-vision");
      gestureState.FilesetResolver = tasksVision.FilesetResolver;
      gestureState.HandLandmarker = tasksVision.HandLandmarker;
    }

    gestureState.vision = await gestureState.FilesetResolver.forVisionTasks(GESTURE_WASM_BASE);
    gestureState.handLandmarker = await gestureState.HandLandmarker.createFromOptions(gestureState.vision, {
      baseOptions: { modelAssetPath: HAND_MODEL_URL },
      runningMode: "VIDEO",
      numHands: 1
    });

    gestureState.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: "user" }
    });

    refs.gestureVideo.srcObject = gestureState.stream;
    await refs.gestureVideo.play();
    gestureState.enabled = true;
  } catch (error) {
    console.warn("Automatic camera access was not granted.", error);
  }
}

function wireEvents() {
  window.addEventListener("resize", resizeRenderer);
}

async function start() {
  await init();
  simulation = new GravitySimulation();
  metadata = simulation.get_body_metadata();
  const initialPositions = Array.from(simulation.get_positions());

  createNebulaField();
  createStarField();
  bodyEntries = metadata.map((bodyMeta, index) => createBodyVisual(bodyMeta, index));
  trailEntries = metadata.filter((bodyMeta) => !bodyMeta.is_sun).map((bodyMeta) => createTrail(bodyMeta));
  createGravityField(initialPositions);
  createComets();
  updateBodyPositions(initialPositions);
  buildFocus();
  wireEvents();
  await enableAutoGestureMode();

  const clock = new THREE.Clock();

  function frame(now) {
    const delta = Math.min(clock.getDelta(), 0.05);
    const elapsed = clock.elapsedTime;

    simulation.update(delta, 1);
    updateBodyPositions(simulation.get_positions());
    updateTrails();
    updatePlanetLooks(elapsed);
    updateBackground(elapsed, delta);
    updateGestureControls(now);
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

start().catch((error) => {
  console.error(error);
});

