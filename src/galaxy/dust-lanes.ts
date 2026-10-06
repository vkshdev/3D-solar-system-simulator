import * as THREE from "three";
import { SPIRAL_ARMS, type SpiralArmConfig, GALACTIC_CONSTANTS } from "./galaxy-math.ts";

export interface DustLanesOptions {
  scaleFactor?: number;
  cloudsPerArm?: number;
}

export interface DustLanesInstance {
  group: THREE.Group;
  update: (elapsed: number) => void;
  setSpectralMode: (mode: number) => void;
}

function createDustTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");

  if (ctx) {
    const gradient = ctx.createRadialGradient(128, 128, 10, 128, 128, 120);
    gradient.addColorStop(0, "rgba(8, 6, 12, 0.88)");
    gradient.addColorStop(0.35, "rgba(14, 10, 20, 0.65)");
    gradient.addColorStop(0.7, "rgba(22, 16, 28, 0.28)");
    gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 256, 256);

    for (let i = 0; i < 40; i += 1) {
      const x = 40 + Math.random() * 176;
      const y = 40 + Math.random() * 176;
      const radius = 10 + Math.random() * 35;
      ctx.beginPath();
      ctx.fillStyle = `rgba(5, 3, 8, ${0.12 + Math.random() * 0.25})`;
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createHiiNebulaTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");

  if (ctx) {
    const gradient = ctx.createRadialGradient(64, 64, 4, 64, 64, 60);
    gradient.addColorStop(0, "rgba(255, 110, 180, 0.95)");
    gradient.addColorStop(0.3, "rgba(235, 60, 140, 0.55)");
    gradient.addColorStop(0.65, "rgba(160, 30, 120, 0.2)");
    gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createInterstellarDustLanes(options: DustLanesOptions = {}): DustLanesInstance {
  const group = new THREE.Group();
  group.name = "InterstellarDustLanes";

  const scaleFactor = options.scaleFactor ?? 50.0;
  const cloudsPerArm = options.cloudsPerArm ?? 65;

  const dustTexture = createDustTexture();
  const hiiTexture = createHiiNebulaTexture();

  const dustMaterials: THREE.MeshBasicMaterial[] = [];
  const hiiMaterials: THREE.SpriteMaterial[] = [];

  const dustGeo = new THREE.PlaneGeometry(1, 1);

  SPIRAL_ARMS.forEach((arm: SpiralArmConfig) => {
    for (let i = 0; i < cloudsPerArm; i += 1) {
      const progress = i / cloudsPerArm;
      const rKpc = arm.rMin + progress * (arm.rMax - arm.rMin);

      const armOffset = -0.16;
      const theta = (Math.log(rKpc / arm.rMin) / Math.tan(arm.pitchAngle)) + arm.phase + armOffset;

      const r = rKpc * scaleFactor;
      const x = r * Math.cos(theta);
      const z = r * Math.sin(theta);
      const y = (Math.random() - 0.5) * 6.5;

      const solX = GALACTIC_CONSTANTS.SOLAR_POSITION.x * scaleFactor;
      const solZ = GALACTIC_CONSTANTS.SOLAR_POSITION.z * scaleFactor;
      if (Math.hypot(x - solX, z - solZ) < 55.0) {
        continue;
      }

      const dustMat = new THREE.MeshBasicMaterial({
        map: dustTexture,
        transparent: true,
        opacity: 0.68,
        depthWrite: false,
        side: THREE.DoubleSide
      });
      dustMaterials.push(dustMat);

      const card = new THREE.Mesh(dustGeo, dustMat);
      card.position.set(x, y, z);
      const cardScale = (18.0 + progress * 32.0) * (0.8 + Math.random() * 0.4);
      card.scale.set(cardScale * 1.6, cardScale, 1.0);
      card.rotation.x = Math.PI * 0.5;
      card.rotation.z = theta + Math.PI * 0.5;
      group.add(card);

      if (Math.random() < 0.28 && rKpc > 3.0 && rKpc < 12.0) {
        const hiiMat = new THREE.SpriteMaterial({
          map: hiiTexture,
          transparent: true,
          opacity: 0.45,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        });
        hiiMaterials.push(hiiMat);

        const hiiSprite = new THREE.Sprite(hiiMat);
        const hiiX = (r + (Math.random() - 0.5) * 8.0) * Math.cos(theta + 0.12);
        const hiiZ = (r + (Math.random() - 0.5) * 8.0) * Math.sin(theta + 0.12);
        hiiSprite.position.set(hiiX, y + (Math.random() - 0.5) * 3.0, hiiZ);
        const hiiSize = 8.0 + Math.random() * 12.0;
        hiiSprite.scale.set(hiiSize, hiiSize, 1.0);
        group.add(hiiSprite);
      }
    }
  });

  return {
    group,
    update: (elapsed: number) => {
      const pulse = 1.0 + Math.sin(elapsed * 1.4) * 0.08;
      hiiMaterials.forEach((mat) => {
        mat.opacity = 0.42 * pulse;
      });
    },
    setSpectralMode: (mode: number) => {
      if (mode === 1) {
        dustMaterials.forEach((mat) => {
          mat.opacity = 0.08;
        });
        hiiMaterials.forEach((mat) => {
          mat.opacity = 0.15;
        });
      } else if (mode === 2) {
        dustMaterials.forEach((mat) => {
          mat.opacity = 0.25;
          mat.color.setHex(0x1a2b4c);
        });
        hiiMaterials.forEach((mat) => {
          mat.opacity = 0.75;
        });
      } else {
        dustMaterials.forEach((mat) => {
          mat.opacity = 0.68;
          mat.color.setHex(0xffffff);
        });
        hiiMaterials.forEach((mat) => {
          mat.opacity = 0.45;
        });
      }
    }
  };
}
