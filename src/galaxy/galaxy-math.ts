export interface GalactocentricCoord {
  x: number;
  y: number;
  z: number;
}

export interface HeliocentricCoord {
  x: number;
  y: number;
  z: number;
}

export interface StellarClass {
  type: "O" | "B" | "A" | "F" | "G" | "K" | "M";
  minTemp: number;
  maxTemp: number;
  weight: number;
  baseSize: number;
  color: [number, number, number];
}

export interface SampledStar {
  type: string;
  temperature: number;
  luminosity: number;
  baseSize: number;
  color: [number, number, number];
}

export interface SpiralArmConfig {
  name: string;
  phase: number;
  pitchAngle: number;
  rMin: number;
  rMax: number;
  weight: number;
}

export interface GeneratedGalacticPoint {
  x: number;
  y: number;
  z: number;
  radius: number;
  baseTheta: number;
}

export const GALACTIC_CONSTANTS = {
  KPC_TO_LY: 3261.563777,
  SOLAR_POSITION: { x: 0.0, y: 0.02, z: 8.2 } as const,
  GALAXY_RADIUS: 16.5,
  BULGE_RADIUS: 1.8,
  BAR_LENGTH: 3.4,
  BAR_ANGLE: 0.4712,
  DISC_SCALE_HEIGHT_THIN: 0.3,
  DISC_SCALE_HEIGHT_THICK: 0.9,
  FLAT_ROTATION_SPEED: 0.22,
  CORE_ROTATION_RADIUS: 0.8
};

export const STELLAR_SPECTRUM_CLASSES: readonly StellarClass[] = [
  { type: "O", minTemp: 30000, maxTemp: 45000, weight: 0.0001, baseSize: 2.8, color: [0.55, 0.7, 1.0] },
  { type: "B", minTemp: 10000, maxTemp: 30000, weight: 0.003, baseSize: 2.2, color: [0.65, 0.8, 1.0] },
  { type: "A", minTemp: 7500, maxTemp: 10000, weight: 0.015, baseSize: 1.8, color: [0.85, 0.92, 1.0] },
  { type: "F", minTemp: 6000, maxTemp: 7500, weight: 0.04, baseSize: 1.5, color: [0.98, 0.98, 0.95] },
  { type: "G", minTemp: 5200, maxTemp: 6000, weight: 0.08, baseSize: 1.4, color: [1.0, 0.96, 0.78] },
  { type: "K", minTemp: 3700, maxTemp: 5200, weight: 0.16, baseSize: 1.2, color: [1.0, 0.72, 0.42] },
  { type: "M", minTemp: 2400, maxTemp: 3700, weight: 0.7019, baseSize: 0.95, color: [1.0, 0.44, 0.22] }
];

export const SPIRAL_ARMS: readonly SpiralArmConfig[] = [
  { name: "Perseus Arm", phase: 0.0, pitchAngle: 0.23, rMin: 2.2, rMax: 15.5, weight: 1.0 },
  { name: "Scutum-Centaurus Arm", phase: Math.PI * 0.5, pitchAngle: 0.22, rMin: 2.0, rMax: 15.0, weight: 1.0 },
  { name: "Sagittarius-Carina Arm", phase: Math.PI, pitchAngle: 0.21, rMin: 2.4, rMax: 14.5, weight: 0.85 },
  { name: "Outer-Norma Arm", phase: Math.PI * 1.5, pitchAngle: 0.22, rMin: 1.8, rMax: 16.0, weight: 0.85 },
  { name: "Orion-Cygnus Spur", phase: Math.PI * 0.92, pitchAngle: 0.19, rMin: 7.2, rMax: 9.8, weight: 0.45 }
];

export function sampleStellarType(rng: () => number = Math.random): SampledStar {
  const roll = rng();
  let cumulative = 0;
  for (let i = 0; i < STELLAR_SPECTRUM_CLASSES.length; i += 1) {
    cumulative += STELLAR_SPECTRUM_CLASSES[i].weight;
    if (roll <= cumulative || i === STELLAR_SPECTRUM_CLASSES.length - 1) {
      const cls = STELLAR_SPECTRUM_CLASSES[i];
      const temp = cls.minTemp + rng() * (cls.maxTemp - cls.minTemp);
      const luminosity = Math.pow(temp / 5778, 3.5) * (0.8 + rng() * 0.4);
      return {
        type: cls.type,
        temperature: temp,
        luminosity: Math.min(luminosity, 120.0),
        baseSize: cls.baseSize * (0.8 + rng() * 0.4),
        color: cls.color
      };
    }
  }
  const fallback = STELLAR_SPECTRUM_CLASSES[STELLAR_SPECTRUM_CLASSES.length - 1];
  return {
    type: fallback.type,
    temperature: 3000,
    luminosity: 0.5,
    baseSize: fallback.baseSize,
    color: fallback.color
  };
}

export function calculateGalacticOrbitalVelocity(r: number): number {
  if (r <= 0.001) return 0;
  const rCore = GALACTIC_CONSTANTS.CORE_ROTATION_RADIUS;
  const v = GALACTIC_CONSTANTS.FLAT_ROTATION_SPEED * (r / Math.sqrt(r * r + rCore * rCore));
  return v / r;
}

export function generateSpiralArmPoint(
  arm: SpiralArmConfig,
  progress: number,
  rng: () => number = Math.random
): GeneratedGalacticPoint {
  const r = arm.rMin + progress * (arm.rMax - arm.rMin);
  const theta = (Math.log(r / arm.rMin) / Math.tan(arm.pitchAngle)) + arm.phase;

  const radialDispersion = 0.35 + progress * 0.65;
  const verticalDispersion = GALACTIC_CONSTANTS.DISC_SCALE_HEIGHT_THIN * (0.4 + progress * 0.8);

  const angleJitter = (rng() - 0.5) * (radialDispersion / r);
  const rJitter = (rng() - 0.5) * radialDispersion;
  const finalR = Math.max(0.1, r + rJitter);
  const finalTheta = theta + angleJitter;

  const zJitter = (rng() + rng() - 1.0) * verticalDispersion;

  const x = finalR * Math.cos(finalTheta);
  const z = finalR * Math.sin(finalTheta);
  const y = zJitter;

  return { x, y, z, radius: finalR, baseTheta: finalTheta };
}

export function generateBulgePoint(rng: () => number = Math.random): GeneratedGalacticPoint {
  const isBar = rng() < 0.6;
  const u = rng();
  const v = rng();
  const theta = u * 2.0 * Math.PI;
  const phi = Math.acos(2.0 * v - 1.0);

  let rMax = GALACTIC_CONSTANTS.BULGE_RADIUS;
  let a = 1.0;
  let b = 0.6;
  let c = 0.45;

  if (isBar) {
    rMax = GALACTIC_CONSTANTS.BAR_LENGTH;
    a = 1.0;
    b = 0.35;
    c = 0.28;
  }

  const r = Math.pow(rng(), 1.6) * rMax;
  let x = r * Math.sin(phi) * Math.cos(theta) * a;
  let z = r * Math.sin(phi) * Math.sin(theta) * b;
  let y = r * Math.cos(phi) * c;

  if (isBar) {
    const angle = GALACTIC_CONSTANTS.BAR_ANGLE;
    const rx = x * Math.cos(angle) - z * Math.sin(angle);
    const rz = x * Math.sin(angle) + z * Math.cos(angle);
    x = rx;
    z = rz;
  }

  const radius = Math.sqrt(x * x + z * z);
  return { x, y, z, radius, baseTheta: Math.atan2(z, x) };
}

export function galactocentricToHeliocentric(coords: GalactocentricCoord): HeliocentricCoord {
  return {
    x: coords.x - GALACTIC_CONSTANTS.SOLAR_POSITION.x,
    y: coords.y - GALACTIC_CONSTANTS.SOLAR_POSITION.y,
    z: coords.z - GALACTIC_CONSTANTS.SOLAR_POSITION.z
  };
}

export function heliocentricToGalactocentric(coords: HeliocentricCoord): GalactocentricCoord {
  return {
    x: coords.x + GALACTIC_CONSTANTS.SOLAR_POSITION.x,
    y: coords.y + GALACTIC_CONSTANTS.SOLAR_POSITION.y,
    z: coords.z + GALACTIC_CONSTANTS.SOLAR_POSITION.z
  };
}
