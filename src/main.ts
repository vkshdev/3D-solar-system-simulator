import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import init, { GravitySimulation } from "../rust-physics/pkg/rust_physics.js";
import {
  createMilkyWayStars,
  createSolarAnchor,
  createInterstellarDustLanes,
  createFermiBubbles,
  getGalacticViewPresets,
  GALACTIC_CONSTANTS
} from "./galaxy/index.ts";
import { createSagittariusACore } from "./shaders/index.ts";
import { ScaleController } from "./camera/index.ts";
import { GalacticRadar, LogarithmicScaleBar, TargetInspector } from "./ui/index.ts";
import { PerformanceManager } from "./performance/index.ts";

export interface BodyMetadata {
  name: string;
  radius: number;
  color: string;
  trail_color: string;
  glow_color: string;
  parent_index?: number | null;
  is_sun: boolean;
}

export interface BodyVisualEntry {
  metadata: BodyMetadata;
  root: THREE.Group;
  mesh: THREE.Mesh;
  glow: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  atmosphere?: THREE.Mesh | null;
  ring?: THREE.Mesh;
}

export interface TrailEntry {
  body: BodyVisualEntry;
  line: THREE.Line;
  history: THREE.Vector3[];
  maxPoints: number;
}

export interface CometEntry {
  head: THREE.Sprite;
  tailSprites: THREE.Sprite[];
  radiusX: number;
  radiusY: number;
  depth: number;
  speed: number;
  angle: number;
  lastPosition: THREE.Vector3;
  initialized: boolean;
}

export interface PlanetProfile {
  map: THREE.CanvasTexture;
  roughness: number;
  emissiveIntensity: number;
  glowOpacity: number;
  atmosphereOpacity: number;
  atmosphereColor?: string;
  haloTexture?: THREE.CanvasTexture;
}

const DISTANCE_SCALE = 1.18;
const GALAXY_SCALE = 50.0;
const QUALITY = { starCount: 3600, trailLength: 190, trailStep: 3, pixelRatio: 1.8 };

const perfManager = new PerformanceManager();

const refs = {
  canvas: document.querySelector("#scene") as HTMLCanvasElement
};

const renderer = new THREE.WebGLRenderer({
  canvas: refs.canvas,
  antialias: true,
  alpha: false,
  logarithmicDepthBuffer: true
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, perfManager.getConfig().maxPixelRatio));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.22;
renderer.setClearColor("#010308");

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2("#03060d", 0.00015);

const solarGalacticPos = new THREE.Vector3(
  GALACTIC_CONSTANTS.SOLAR_POSITION.x * GALAXY_SCALE,
  GALACTIC_CONSTANTS.SOLAR_POSITION.y * GALAXY_SCALE,
  GALACTIC_CONSTANTS.SOLAR_POSITION.z * GALAXY_SCALE
);

const solarSystemGroup = new THREE.Group();
solarSystemGroup.position.copy(solarGalacticPos);
scene.add(solarSystemGroup);

const camera = new THREE.PerspectiveCamera(44, window.innerWidth / window.innerHeight, 0.1, 9500);
camera.position.copy(solarGalacticPos).add(new THREE.Vector3(0, 40, 170));

const controls = new OrbitControls(camera, refs.canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.enablePan = true;
controls.minDistance = 12;
controls.maxDistance = 4200;
controls.target.copy(solarGalacticPos);

const ambientLight = new THREE.AmbientLight("#80a4ff", 0.22);
const hemisphereLight = new THREE.HemisphereLight("#6e90ff", "#050a12", 0.42);
const sunLight = new THREE.PointLight("#fff5e4", 4.1, 2200, 1.35);
scene.add(ambientLight, hemisphereLight);
solarSystemGroup.add(sunLight);

let simulation: GravitySimulation;
let metadata: BodyMetadata[] = [];
let bodyEntries: BodyVisualEntry[] = [];
let trailEntries: TrailEntry[] = [];
let nebulaGroup: THREE.Group | undefined;
let starGroup: THREE.Group | undefined;
let cometEntries: CometEntry[] = [];
let gravityFieldGroup: THREE.Group | undefined;
let orbitGuideGroup: THREE.Group | undefined;
let moonGuide: THREE.LineLoop | undefined;
let moonOrbitRadius = 3.3;
let moonOrbitInclination = 0.16;
let trailFrameCounter = 0;
let milkyWay: ReturnType<typeof createMilkyWayStars> | null = null;
let solarAnchor: ReturnType<typeof createSolarAnchor> | null = null;
let scaleController: ScaleController | null = null;
let sagittariusA: ReturnType<typeof createSagittariusACore> | null = null;
let dustLanes: ReturnType<typeof createInterstellarDustLanes> | null = null;
let fermiBubbles: ReturnType<typeof createFermiBubbles> | null = null;
let galacticRadar: GalacticRadar | null = null;
let logScaleBar: LogarithmicScaleBar | null = null;
let targetInspector: TargetInspector | null = null;


function hexColor(hex: string): THREE.Color {
  return new THREE.Color(hex);
}

function seededRandom(seed: number): number {
  const x = Math.sin(seed * 127.1) * 43758.5453123;
  return x - Math.floor(x);
}

function createSurfaceCanvas(width = 1024, height = 512): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not acquire 2D canvas context");
  return { canvas, ctx };
}

function createRadialTexture(stops: Array<{ offset: number; color: string }>, width = 512, height = 512): THREE.CanvasTexture {
  const { canvas, ctx } = createSurfaceCanvas(width, height);
  const gradient = ctx.createRadialGradient(width * 0.5, height * 0.5, 0, width * 0.5, height * 0.5, width * 0.5);
  stops.forEach((stop) => gradient.addColorStop(stop.offset, stop.color));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createSoftCloudTexture(primaryHex: string, secondaryHex: string, accentHex: string, width = 1024, height = 1024): THREE.CanvasTexture {
  const { canvas, ctx } = createSurfaceCanvas(width, height);
  const primary = hexColor(primaryHex);
  const secondary = hexColor(secondaryHex);
  const accent = hexColor(accentHex);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < 6; i += 1) {
    const x = seededRandom(i + 11) * canvas.width;
    const y = seededRandom(i + 31) * canvas.height;
    const radius = 70 + seededRandom(i + 71) * 140;
    const color = primary.clone().lerp(secondary, seededRandom(i + 121)).lerp(accent, seededRandom(i + 191) * 0.2);
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `rgba(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)}, 0.06)`);
    gradient.addColorStop(0.45, `rgba(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)}, 0.02)`);
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

function createRockyTexture(baseHex: string, accentHex: string, craterHex: string, ridgeHex: string): THREE.CanvasTexture {
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

function createEarthTexture(): THREE.CanvasTexture {
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

function createGasTexture(baseHex: string, bandHexA: string, bandHexB: string, stormHex: string): THREE.CanvasTexture {
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

function createVenusTexture(): THREE.CanvasTexture {
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

function createSunTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = createSurfaceCanvas();

  const baseGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  baseGrad.addColorStop(0, "#4a2408");
  baseGrad.addColorStop(0.18, "#7d3f12");
  baseGrad.addColorStop(0.38, "#c88228");
  baseGrad.addColorStop(0.5, "#f7bc48");
  baseGrad.addColorStop(0.62, "#c88228");
  baseGrad.addColorStop(0.82, "#7d3f12");
  baseGrad.addColorStop(1, "#4a2408");
  ctx.fillStyle = baseGrad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < 480; i += 1) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    const rx = 10 + Math.random() * 42;
    const ry = 6 + Math.random() * 24;
    const roll = Math.random();

    ctx.beginPath();
    if (roll > 0.65) {
      ctx.fillStyle = `rgba(255, 248, 224, ${0.2 + Math.random() * 0.2})`;
    } else if (roll > 0.3) {
      ctx.fillStyle = `rgba(242, 172, 60, ${0.16 + Math.random() * 0.18})`;
    } else {
      ctx.fillStyle = `rgba(95, 42, 10, ${0.22 + Math.random() * 0.22})`;
    }
    ctx.ellipse(x, y, rx, ry, Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  for (let i = 0; i < 140; i += 1) {
    const x = Math.random() * canvas.width;
    const y = (0.2 + Math.random() * 0.6) * canvas.height;
    const rx = 18 + Math.random() * 65;
    const ry = 4 + Math.random() * 14;
    ctx.beginPath();
    ctx.fillStyle = `rgba(255, 252, 238, ${0.18 + Math.random() * 0.2})`;
    ctx.ellipse(x, y, rx, ry, (Math.random() - 0.5) * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }

  const spotCount = 14;
  for (let s = 0; s < spotCount; s += 1) {
    const cx = (s / spotCount) * canvas.width + (Math.random() - 0.5) * 60;
    const cy = (0.32 + (s % 2 === 0 ? 0.12 : 0.28) + (Math.random() - 0.5) * 0.1) * canvas.height;
    const size = 12 + Math.random() * 22;

    ctx.beginPath();
    ctx.fillStyle = "rgba(115, 52, 14, 0.76)";
    ctx.ellipse(cx, cy, size, size * 0.65, Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.fillStyle = "rgba(42, 16, 4, 0.94)";
    ctx.ellipse(cx, cy, size * 0.45, size * 0.32, Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.strokeStyle = "rgba(255, 240, 190, 0.4)";
    ctx.lineWidth = 1.6;
    ctx.ellipse(cx, cy, size * 1.15, size * 0.78, Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.stroke();
  }

  for (let i = 0; i < 90; i += 1) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    ctx.strokeStyle = `rgba(255, ${225 + Math.random() * 25}, ${160 + Math.random() * 50}, ${0.12 + Math.random() * 0.14})`;
    ctx.lineWidth = 1.5 + Math.random() * 2.5;
    ctx.beginPath();
    ctx.moveTo(x - 22, y - 8);
    ctx.bezierCurveTo(x + 10, y - 22, x + 30, y + 14, x + 50, y + 4);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function createRingTexture(): THREE.CanvasTexture {
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

function getPlanetProfile(bodyMeta: BodyMetadata): PlanetProfile {
  switch (bodyMeta.name) {
    case "Sun":
      return {
        map: createSunTexture(),
        roughness: 0.42,
        emissiveIntensity: 0.32,
        glowOpacity: 0.06,
        atmosphereOpacity: 0
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

function createNebulaField(): void {
  nebulaGroup = new THREE.Group();
  const setups: Array<{ pos: [number, number, number]; scale: [number, number, number]; colors: [string, string, string] }> = [
    { pos: [-180, 110, -950], scale: [320, 190, 1], colors: ["#24357a", "#4a247d", "#6e298d"] },
    { pos: [210, -90, -1100], scale: [360, 210, 1], colors: ["#094d66", "#23857d", "#362d85"] }
  ];

  setups.forEach((setup, index) => {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: createSoftCloudTexture(setup.colors[0], setup.colors[1], setup.colors[2]),
        transparent: true,
        opacity: 0.09,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide
      })
    );
    mesh.position.set(...setup.pos);
    mesh.scale.set(...setup.scale);
    mesh.rotation.z = index * 0.23;
    nebulaGroup!.add(mesh);
  });

  solarSystemGroup.add(nebulaGroup);
}

function createStarField(): void {
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
  solarSystemGroup.add(starGroup);
}

function createGravityNet(size = 240, divisions = 28): THREE.Group {
  const group = new THREE.Group();
  const material = new THREE.LineBasicMaterial({ color: "#4da8ff", transparent: true, opacity: 0.18 });
  const depthAt = (x: number, z: number) => {
    const r = Math.sqrt(x * x + z * z);
    return -9 * Math.exp(-(r * r) / 2800) - 2.1 / (1 + r * 0.08);
  };
  const step = size / divisions;
  const half = size / 2;

  for (let i = 0; i <= divisions; i += 1) {
    const x = -half + i * step;
    const pointsX: THREE.Vector3[] = [];
    const pointsZ: THREE.Vector3[] = [];
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

function createOrbitPath(radius: number, color: string | THREE.Color, inclination = 0, segments = 180): THREE.LineLoop {
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const y = z * Math.sin(inclination) * 0.35;
    points.push(new THREE.Vector3(x, y, z * Math.cos(inclination * 0.4)));
  }
  return new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.24 }));
}

function getMoonOffset(radius: number, inclination: number, angle: number): THREE.Vector3 {
  const x = Math.cos(angle) * radius;
  const z = Math.sin(angle) * radius;
  const y = z * Math.sin(inclination) * 0.35;
  return new THREE.Vector3(x, y, z * Math.cos(inclination * 0.4));
}

function createBodyVisual(bodyMeta: BodyMetadata, index: number): BodyVisualEntry {
  const root = new THREE.Group();
  root.userData.bodyIndex = index;

  const profile = getPlanetProfile(bodyMeta);
  const isSun = bodyMeta.is_sun || bodyMeta.name === "Sun";
  const bodyColor = isSun ? "#ffffff" : bodyMeta.color;
  const emissiveColor = isSun ? "#d48b28" : bodyMeta.glow_color;
  const glowColor = isSun ? "#b86f1e" : bodyMeta.glow_color;

  const material = new THREE.MeshStandardMaterial({
    map: profile.map,
    color: hexColor(bodyColor),
    emissive: hexColor(emissiveColor),
    emissiveIntensity: profile.emissiveIntensity,
    emissiveMap: isSun ? profile.map : null,
    roughness: profile.roughness,
    metalness: 0.01
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(bodyMeta.radius, 64, 64), material);
  root.add(mesh);

  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(bodyMeta.radius * 1.08, 34, 34),
    new THREE.MeshBasicMaterial({ color: hexColor(glowColor), transparent: true, opacity: profile.glowOpacity, depthWrite: false })
  );
  root.add(glow);

  let atmosphere: THREE.Mesh | null = null;
  if (profile.atmosphereOpacity > 0) {
    atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(bodyMeta.radius * 1.1, 34, 34),
      new THREE.MeshBasicMaterial({ color: profile.atmosphereColor ?? bodyMeta.glow_color, transparent: true, opacity: profile.atmosphereOpacity, depthWrite: false })
    );
    root.add(atmosphere);
  }

  let ring: THREE.Mesh | undefined;

  if (bodyMeta.name === "Saturn") {
    ring = new THREE.Mesh(
      new THREE.RingGeometry(bodyMeta.radius * 1.7, bodyMeta.radius * 3.2, 160),
      new THREE.MeshBasicMaterial({ map: createRingTexture(), color: "#e1d6a8", transparent: true, opacity: 0.66, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.rotation.x = Math.PI / 2.62;
    root.add(ring);
  }

  solarSystemGroup.add(root);
  return { metadata: bodyMeta, root, mesh, glow, material, atmosphere, ring };
}

function createTrail(bodyEntry: BodyVisualEntry): TrailEntry {
  const line = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: bodyEntry.metadata.trail_color, transparent: true, opacity: 0.12 })
  );
  solarSystemGroup.add(line);
  return { body: bodyEntry, line, history: [], maxPoints: QUALITY.trailLength };
}

function createCometMaterial(innerColor: string, outerColor: string): THREE.SpriteMaterial {
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

function createComets(): void {
  const configs = [
    { head: ["rgba(245, 252, 255, 1)", "rgba(118, 202, 255, 0.5)"], tail: ["rgba(174, 229, 255, 0.45)", "rgba(92, 164, 255, 0.08)"], radiusX: 300, radiusY: 126, depth: -320, speed: 0.034, angle: 0.3 },
    { head: ["rgba(255, 246, 226, 1)", "rgba(255, 183, 112, 0.46)"], tail: ["rgba(255, 216, 166, 0.42)", "rgba(255, 166, 84, 0.08)"], radiusX: 420, radiusY: 154, depth: -430, speed: 0.024, angle: Math.PI }
  ];

  cometEntries = configs.map((config) => {
    const head = new THREE.Sprite(createCometMaterial(config.head[0], config.head[1]));
    head.scale.set(6, 6, 1);

    const tailSprites = Array.from({ length: 16 }, (_, index) => {
      const sprite = new THREE.Sprite(createCometMaterial(config.tail[0], config.tail[1]));
      sprite.scale.set(18 - index * 0.75, 6.5 - index * 0.22, 1);
      (sprite.material as THREE.SpriteMaterial).opacity = 0.46 - index * 0.022;
      solarSystemGroup.add(sprite);
      return sprite;
    });

    solarSystemGroup.add(head);
    return { ...config, head, tailSprites, lastPosition: new THREE.Vector3(), initialized: false };
  });
}

function createGravityField(initialFlatPositions: number[]): void {
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
    orbitGuideGroup!.add(createOrbitPath(radius, bodyMeta.trail_color, inclination));
  });

  gravityFieldGroup.add(orbitGuideGroup);
  solarSystemGroup.add(gravityFieldGroup);

  const earthIndex = metadata.findIndex((bodyMeta) => bodyMeta.name === "Earth");
  const moonIndex = metadata.findIndex((bodyMeta) => bodyMeta.name === "Moon");
  if (earthIndex >= 0 && moonIndex >= 0) {
    const earth = new THREE.Vector3(initialFlatPositions[earthIndex * 3], initialFlatPositions[earthIndex * 3 + 1], initialFlatPositions[earthIndex * 3 + 2]).multiplyScalar(DISTANCE_SCALE);
    const moon = new THREE.Vector3(initialFlatPositions[moonIndex * 3], initialFlatPositions[moonIndex * 3 + 1], initialFlatPositions[moonIndex * 3 + 2]).multiplyScalar(DISTANCE_SCALE);
    const moonRelative = moon.sub(earth);
    moonOrbitRadius = Math.sqrt(moonRelative.x * moonRelative.x + moonRelative.z * moonRelative.z);
    moonOrbitInclination = Math.atan2(moonRelative.y, Math.max(moonOrbitRadius, 0.001));
  }
  moonGuide = createOrbitPath(moonOrbitRadius, "#e8edf6", moonOrbitInclination, 96);
}

function buildFocus(): void {
  controls.target.copy(solarSystemGroup.position);
  controls.update();
}

function updateBodyPositions(flatPositions: ArrayLike<number>, elapsed = 0): void {
  const earthEntry = bodyEntries.find((entry) => entry.metadata.name === "Earth");
  const moonEntry = bodyEntries.find((entry) => entry.metadata.name === "Moon");

  for (let i = 0; i < bodyEntries.length; i += 1) {
    if (bodyEntries[i].metadata.name === "Moon") {
      continue;
    }
    const offset = i * 3;
    bodyEntries[i].root.position.set(
      flatPositions[offset] * DISTANCE_SCALE,
      flatPositions[offset + 1] * DISTANCE_SCALE,
      flatPositions[offset + 2] * DISTANCE_SCALE
    );
  }

  if (earthEntry && moonEntry) {
    const moonAngle = 0.4 + elapsed * 2.2;
    moonEntry.root.position.copy(earthEntry.root.position).add(getMoonOffset(moonOrbitRadius, moonOrbitInclination, moonAngle));
  }

  sunLight.position.copy(bodyEntries[0].root.position);
  if (scaleController && !scaleController.isTransitioning && scaleController.currentTargetKey === "sol") {
    controls.target.copy(solarSystemGroup.position).add(bodyEntries[0].root.position);
  }

  if (gravityFieldGroup) {
    gravityFieldGroup.position.copy(bodyEntries[0].root.position);
  }

  if (moonGuide && earthEntry && moonGuide.parent !== earthEntry.root) {
    earthEntry.root.add(moonGuide);
  }
}

function updateTrails(): void {
  trailFrameCounter += 1;
  if (trailFrameCounter % QUALITY.trailStep !== 0) {
    return;
  }

  trailEntries.forEach((trail) => {
    const point = trail.body.root.position.clone();
    trail.history.push(point);
    if (trail.history.length > trail.maxPoints) {
      trail.history.shift();
    }
    trail.line.geometry.setFromPoints(trail.history);
  });
}

function updatePlanetLooks(elapsed: number): void {
  const spinMap: Record<string, number> = {
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
      entry.material.emissiveIntensity = 0.32 + Math.sin(elapsed * 2.1) * 0.04;
      entry.glow.scale.setScalar(1 + 0.02 * Math.sin(elapsed * 1.55));
    }
  });
}

function updateBackground(elapsed: number, delta: number): void {
  if (starGroup) {
    starGroup.rotation.y += delta * 0.0015;
  }

  if (nebulaGroup) {
    nebulaGroup.children.forEach((mesh, index) => {
      mesh.rotation.z += delta * (0.0015 + index * 0.0002);
      const mat = (mesh as THREE.Mesh).material as THREE.MeshBasicMaterial;
      if (mat) {
        mat.opacity = 0.07 + Math.sin(elapsed * (0.03 + index * 0.01)) * 0.015;
      }
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
        (sprite.material as THREE.SpriteMaterial).opacity = Math.max(0, 0.35 - spriteIndex * 0.018);
      }
    });

    comet.lastPosition.copy(cometPosition);
  });
}

function resizeRenderer(): void {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, perfManager.getConfig().maxPixelRatio));
}


function triggerViewTransition(targetKey: "sol" | "galaxy" | "sgrA"): void {
  const presets = getGalacticViewPresets(GALAXY_SCALE);
  let preset;
  if (targetKey === "sol") preset = presets.solSystem;
  else if (targetKey === "galaxy") preset = presets.galaxyOverview;
  else if (targetKey === "sgrA") preset = presets.sagittariusA;
  if (!preset) return;

  if (scaleController) {
    scaleController.flyTo(targetKey, preset, 2.4);
  }
  if (targetInspector) {
    targetInspector.setTarget(targetKey);
  }
  updateHUDViewIndicator(targetKey);
}

function setSpectralMode(mode: 0 | 1 | 2): void {
  if (milkyWay) milkyWay.setSpectralMode(mode);
  if (sagittariusA) sagittariusA.setSpectralMode(mode);
  if (dustLanes) dustLanes.setSpectralMode(mode);
  if (fermiBubbles) fermiBubbles.setSpectralMode(mode);

  const specBtns = [
    document.querySelector("#btn-spec-vis"),
    document.querySelector("#btn-spec-ir"),
    document.querySelector("#btn-spec-radio")
  ];
  specBtns.forEach((btn, index) => {
    btn?.classList.toggle("active", index === mode);
  });
}

function updateHUDViewIndicator(targetKey: string): void {
  const btnSol = document.querySelector("#btn-view-sol");
  const btnGalaxy = document.querySelector("#btn-view-galaxy");
  const btnSgrA = document.querySelector("#btn-view-sgra");
  const sectorText = document.querySelector("#hud-sector");

  btnSol?.classList.toggle("active", targetKey === "sol");
  btnGalaxy?.classList.toggle("active", targetKey === "galaxy");
  btnSgrA?.classList.toggle("active", targetKey === "sgrA");

  if (sectorText) {
    if (targetKey === "sol") {
      sectorText.textContent = "SOL SYSTEM";
    } else if (targetKey === "galaxy") {
      sectorText.textContent = "MILKY WAY";
    } else if (targetKey === "sgrA") {
      sectorText.textContent = "SAGITTARIUS A*";
    }
  }
}

function initHUD(): void {
  const btnSol = document.querySelector("#btn-view-sol");
  const btnGalaxy = document.querySelector("#btn-view-galaxy");
  const btnSgrA = document.querySelector("#btn-view-sgra");
  const btnSpecVis = document.querySelector("#btn-spec-vis");
  const btnSpecIr = document.querySelector("#btn-spec-ir");
  const btnSpecRadio = document.querySelector("#btn-spec-radio");

  btnSol?.addEventListener("click", () => triggerViewTransition("sol"));
  btnGalaxy?.addEventListener("click", () => triggerViewTransition("galaxy"));
  btnSgrA?.addEventListener("click", () => triggerViewTransition("sgrA"));

  btnSpecVis?.addEventListener("click", () => setSpectralMode(0));
  btnSpecIr?.addEventListener("click", () => setSpectralMode(1));
  btnSpecRadio?.addEventListener("click", () => setSpectralMode(2));
}

function wireEvents(): void {
  window.addEventListener("resize", resizeRenderer);
  window.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "1") triggerViewTransition("sol");
    if (e.key === "2") triggerViewTransition("galaxy");
    if (e.key === "3") triggerViewTransition("sgrA");
    if (e.key === "v" || e.key === "V") setSpectralMode(0);
    if (e.key === "i" || e.key === "I") setSpectralMode(1);
    if (e.key === "r" || e.key === "R") setSpectralMode(2);
    if (e.key === "p" || e.key === "P") {
      const current = perfManager.getTier();
      const nextTier = current === "HIGH" ? "MEDIUM" : current === "MEDIUM" ? "LOW" : "HIGH";
      perfManager.setTier(nextTier);
    }
  });
}

async function start(): Promise<void> {
  await init();
  simulation = new GravitySimulation();
  metadata = simulation.get_body_metadata() as BodyMetadata[];
  const initialPositions = Array.from(simulation.get_positions());

  const perfConfig = perfManager.getConfig();

  milkyWay = createMilkyWayStars({ starCount: perfConfig.starCount, scaleFactor: GALAXY_SCALE });
  scene.add(milkyWay.mesh);

  perfManager.onTierChange = (_tier, config) => {
    if (milkyWay) {
      milkyWay.setDrawCount(config.starCount);
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, config.maxPixelRatio));
  };

  solarAnchor = createSolarAnchor(GALAXY_SCALE);
  scene.add(solarAnchor.group);

  sagittariusA = createSagittariusACore({ radius: 3.2, diskInnerRadius: 7.5, diskOuterRadius: 28.0 });
  scene.add(sagittariusA.group);

  dustLanes = createInterstellarDustLanes({ scaleFactor: GALAXY_SCALE });
  scene.add(dustLanes.group);

  fermiBubbles = createFermiBubbles({ scaleFactor: GALAXY_SCALE });
  scene.add(fermiBubbles.group);

  createNebulaField();
  createStarField();
  bodyEntries = metadata.map((bodyMeta, index) => createBodyVisual(bodyMeta, index));
  trailEntries = bodyEntries
    .filter((entry) => !entry.metadata.is_sun && entry.metadata.name !== "Moon")
    .map((entry) => createTrail(entry));
  createGravityField(initialPositions);
  createComets();
  updateBodyPositions(initialPositions);
  buildFocus();

  scaleController = new ScaleController(
    camera,
    controls,
    solarSystemGroup,
    solarAnchor,
    (scaleState) => {
      const scaleText = document.querySelector("#hud-scale");
      if (scaleText) {
        scaleText.textContent = `SCALE: ${scaleState.formattedScaleUnit} | DIST: ${scaleState.formattedDistance}`;
      }
    }
  );

  const radarCanvas = document.querySelector("#galactic-radar-canvas") as HTMLCanvasElement | null;
  if (radarCanvas) {
    galacticRadar = new GalacticRadar({
      canvas: radarCanvas,
      scaleFactor: GALAXY_SCALE,
      onRadarClick: (coords: { x: number; z: number }) => {
        controls.target.set(coords.x, 0, coords.z);
      }
    });
  }

  const scaleBarContainer = document.querySelector(".log-scale-bar-container") as HTMLElement | null;
  if (scaleBarContainer) {
    logScaleBar = new LogarithmicScaleBar({ containerElement: scaleBarContainer });
  }

  const inspectorCard = document.querySelector(".target-inspector-card") as HTMLElement | null;
  if (inspectorCard) {
    targetInspector = new TargetInspector(inspectorCard);
    targetInspector.setTarget("sol");
  }

  wireEvents();
  initHUD();

  const clock = new THREE.Clock();
  let perfFrameCounter = 0;

  function frame(now: number): void {
    const delta = Math.min(clock.getDelta(), 0.05);
    const elapsed = clock.elapsedTime;

    let isMacro = false;
    if (scaleController) {
      const scaleState = scaleController.update(now);
      isMacro = scaleState.level === "GALACTIC_MACRO";
    }

    solarSystemGroup.visible = !isMacro;

    simulation.update(delta, 1);
    if (!isMacro) {
      updateBodyPositions(simulation.get_positions(), elapsed);
      updateTrails();
      updatePlanetLooks(elapsed);
      updateBackground(elapsed, delta);
    }

    if (milkyWay) milkyWay.update(elapsed);
    if (solarAnchor) solarAnchor.update(elapsed);
    if (sagittariusA) sagittariusA.update(elapsed, camera.position);
    if (dustLanes) dustLanes.update(elapsed);
    if (fermiBubbles) fermiBubbles.update(elapsed, camera.position);
    if (galacticRadar) galacticRadar.render(camera, controls.target, elapsed);
    if (logScaleBar) {
      const distSun = camera.position.distanceTo(solarSystemGroup.position);
      const distCenter = camera.position.length();
      logScaleBar.update(distSun, distCenter);
    }
    controls.update();
    renderer.render(scene, camera);

    const metrics = perfManager.recordFrame(renderer.info);
    if (perfFrameCounter++ % 15 === 0) {
      const perfElement = document.querySelector("#hud-perf");
      if (perfElement) {
        perfElement.textContent = `TIER: ${metrics.tier}`;
      }
    }

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

start().catch((error) => {
  console.error(error);
});
