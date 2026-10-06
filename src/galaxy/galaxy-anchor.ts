import * as THREE from "three";
import { GALACTIC_CONSTANTS, type GalactocentricCoord } from "./galaxy-math.ts";

export interface SolarAnchorInstance {
  group: THREE.Group;
  worldPosition: THREE.Vector3;
  kpcPosition: GalactocentricCoord;
  update: (elapsed: number) => void;
  setVisible: (visible: boolean) => void;
}

export interface GalacticViewPreset {
  name: string;
  cameraPosition: THREE.Vector3;
  targetPosition: THREE.Vector3;
  description: string;
}

export interface GalacticViewPresetsCollection {
  galaxyOverview: GalacticViewPreset;
  solSystem: GalacticViewPreset;
  sagittariusA: GalacticViewPreset;
}

export function createSolarAnchor(scaleFactor = 50.0): SolarAnchorInstance {
  const group = new THREE.Group();

  const solKpc = GALACTIC_CONSTANTS.SOLAR_POSITION;
  const solWorldPos = new THREE.Vector3(
    solKpc.x * scaleFactor,
    solKpc.y * scaleFactor,
    solKpc.z * scaleFactor
  );

  group.position.copy(solWorldPos);

  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, "rgba(255, 255, 255, 1.0)");
    gradient.addColorStop(0.25, "rgba(235, 238, 245, 0.70)");
    gradient.addColorStop(0.65, "rgba(180, 185, 200, 0.25)");
    gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
  }

  const beaconTexture = new THREE.CanvasTexture(canvas);
  beaconTexture.colorSpace = THREE.SRGBColorSpace;

  const beaconMaterial = new THREE.SpriteMaterial({
    map: beaconTexture,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  const beaconSprite = new THREE.Sprite(beaconMaterial);
  beaconSprite.scale.set(16, 16, 1);
  beaconSprite.userData.baseOpacity = 1.0;
  group.add(beaconSprite);

  const reticleRing = new THREE.Mesh(
    new THREE.RingGeometry(8, 8.4, 64),
    new THREE.MeshBasicMaterial({
      color: "#ffffff",
      transparent: true,
      opacity: 0.65,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    })
  );
  reticleRing.rotation.x = Math.PI / 2;
  reticleRing.userData.baseOpacity = 0.65;
  group.add(reticleRing);

  const outerDashedRing = new THREE.Mesh(
    new THREE.RingGeometry(13.5, 13.9, 64),
    new THREE.MeshBasicMaterial({
      color: "#a1a1aa",
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    })
  );
  outerDashedRing.rotation.x = Math.PI / 2;
  outerDashedRing.userData.baseOpacity = 0.35;
  group.add(outerDashedRing);

  const lineGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, -solWorldPos.y, 0),
    new THREE.Vector3(0, 0, 0)
  ]);
  const lineMaterial = new THREE.LineDashedMaterial({
    color: "#d4d4d8",
    dashSize: 0.5,
    gapSize: 0.3,
    transparent: true,
    opacity: 0.4
  });
  const altitudeLine = new THREE.Line(lineGeometry, lineMaterial);
  altitudeLine.computeLineDistances();
  altitudeLine.userData.baseOpacity = 0.4;
  group.add(altitudeLine);

  return {
    group,
    worldPosition: solWorldPos,
    kpcPosition: solKpc,
    update: (elapsed: number) => {
      const pulse = 1.0 + Math.sin(elapsed * 2.5) * 0.15;
      beaconSprite.scale.set(16 * pulse, 16 * pulse, 1);
      reticleRing.rotation.z += 0.008;
      outerDashedRing.rotation.z -= 0.005;
    },
    setVisible: (visible: boolean) => {
      group.visible = visible;
    }
  };
}

export function getGalacticViewPresets(scaleFactor = 50.0): GalacticViewPresetsCollection {
  const solPos = new THREE.Vector3(
    GALACTIC_CONSTANTS.SOLAR_POSITION.x * scaleFactor,
    GALACTIC_CONSTANTS.SOLAR_POSITION.y * scaleFactor,
    GALACTIC_CONSTANTS.SOLAR_POSITION.z * scaleFactor
  );

  return {
    galaxyOverview: {
      name: "Milky Way Overview",
      cameraPosition: new THREE.Vector3(0, 950, 850),
      targetPosition: new THREE.Vector3(0, 0, 0),
      description: "Full macroscopic perspective of the Milky Way disc and spiral arms."
    },
    solSystem: {
      name: "Solar System (Orion Spur)",
      cameraPosition: new THREE.Vector3(solPos.x, solPos.y + 45, solPos.z + 180),
      targetPosition: solPos.clone(),
      description: "Heliocentric coordinate frame at 8.2 kpc from Galactic Center."
    },
    sagittariusA: {
      name: "Sagittarius A* (Core)",
      cameraPosition: new THREE.Vector3(0, 35, 120),
      targetPosition: new THREE.Vector3(0, 0, 0),
      description: "Supermassive black hole at the center of the Milky Way."
    }
  };
}
