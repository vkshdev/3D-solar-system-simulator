import * as THREE from "three";
import {
  GALACTIC_CONSTANTS,
  SPIRAL_ARMS,
  sampleStellarType,
  calculateGalacticOrbitalVelocity,
  generateSpiralArmPoint,
  generateBulgePoint,
  type SpiralArmConfig
} from "./galaxy-math.ts";

export interface GalaxyOptions {
  starCount?: number;
  scaleFactor?: number;
}

export interface GalaxyStarsInstance {
  mesh: THREE.Points;
  material: THREE.ShaderMaterial;
  geometry: THREE.BufferGeometry;
  scaleFactor: number;
  update: (elapsed: number) => void;
  setSpectralMode: (mode: number) => void;
  setOpacity: (opacity: number) => void;
  setDrawCount: (count: number) => void;
}

const GALAXY_VERTEX_SHADER = /* glsl */ `
  attribute vec4 aStellarParams;
  attribute vec2 aOrbitalParams;

  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uSizeScale;
  uniform float uScaleFactor;

  varying vec4 vStellarParams;
  varying vec3 vWorldPosition;
  varying float vRadius;
  varying float vInfallFade;

  void main() {
    vStellarParams = aStellarParams;
    vRadius = aOrbitalParams.x;

    float omega = aOrbitalParams.y;
    float currentAngle = omega * uTime * 0.05;

    float cosAngle = cos(currentAngle);
    float sinAngle = sin(currentAngle);

    vec3 normalRotated = vec3(
      position.x * cosAngle - position.z * sinAngle,
      position.y,
      position.x * sinAngle + position.z * cosAngle
    );

    const float R_HORIZON = 0.064;
    const float R_CAPTURE = 0.95;
    float r0 = length(position.xz);

    float infallFade = 1.0;
    vec3 finalPosKpc = normalRotated;

    if (r0 < R_CAPTURE) {
      float seed = fract(sin(dot(position.xyz, vec3(12.9898, 78.233, 45.164))) * 43758.5453);
      float infallSpeed = 0.016;

      float normR = clamp((r0 - R_HORIZON) / (R_CAPTURE - R_HORIZON), 0.0, 1.0);
      float cycle = fract(normR - uTime * infallSpeed + seed);

      float inRadius = R_HORIZON + pow(cycle, 1.15) * (R_CAPTURE - R_HORIZON);

      float theta0 = atan(position.z, position.x);
      float frameDragging = 0.09 / max(inRadius, R_HORIZON);
      float spiralWinding = (1.0 - cycle) * 11.5 + frameDragging * 1.5;
      float infallAngle = theta0 + uTime * (0.035 + frameDragging * 0.08) + spiralWinding;

      float tidalSquash = smoothstep(R_HORIZON, R_CAPTURE * 0.7, inRadius);
      float inY = position.y * tidalSquash;

      vec3 infallingPos = vec3(
        inRadius * cos(infallAngle),
        inY,
        inRadius * sin(infallAngle)
      );

      float blendWeight = smoothstep(R_CAPTURE, R_CAPTURE * 0.15, r0);
      finalPosKpc = mix(normalRotated, infallingPos, blendWeight);

      infallFade = mix(1.0, smoothstep(0.0, 0.07, cycle) * smoothstep(1.0, 0.93, cycle), blendWeight);

      float tidalHeat = (1.0 - cycle) * blendWeight;
      vStellarParams.x = mix(aStellarParams.x, max(aStellarParams.x, 32000.0), tidalHeat * 0.85);
      vStellarParams.y = aStellarParams.y * (1.0 + tidalHeat * 2.2);
      vStellarParams.z = aStellarParams.z * (1.0 + tidalHeat * 0.6);
    }

    vInfallFade = infallFade;

    vec3 worldPos = finalPosKpc * uScaleFactor;
    vWorldPosition = worldPos;

    vec4 mvPosition = modelViewMatrix * vec4(worldPos, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    float viewDist = max(0.1, -mvPosition.z);
    float pointSize = (vStellarParams.z * uSizeScale * uPixelRatio * 380.0) / viewDist;
    gl_PointSize = clamp(pointSize, 1.0, 48.0);
  }
`;

const GALAXY_FRAGMENT_SHADER = /* glsl */ `
  #ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
  #else
    precision mediump float;
  #endif

  uniform float uOpacity;
  uniform int uSpectralMode;

  varying vec4 vStellarParams;
  varying vec3 vWorldPosition;
  varying float vRadius;
  varying float vInfallFade;

  vec3 blackbodyColor(float kelvin) {
    float t = clamp(kelvin, 2000.0, 45000.0) / 100.0;
    vec3 color;

    if (t <= 66.0) {
      color.r = 1.0;
    } else {
      color.r = clamp(pow((t - 60.0) / 100.0, -0.1332) * 1.29, 0.0, 1.0);
    }

    if (t <= 66.0) {
      color.g = clamp(99.47 * log(t) - 161.12, 0.0, 255.0) / 255.0;
    } else {
      color.g = clamp(288.12 * pow(t - 60.0, -0.0755), 0.0, 255.0) / 255.0;
    }

    if (t >= 66.0) {
      color.b = 1.0;
    } else if (t <= 19.0) {
      color.b = 0.0;
    } else {
      color.b = clamp(138.52 * log(t - 10.0) - 305.04, 0.0, 255.0) / 255.0;
    }

    return color;
  }

  void main() {
    vec2 coord = gl_PointCoord - vec2(0.5);
    float distSq = dot(coord, coord);
    if (distSq > 0.25) {
      discard;
    }

    float coreFalloff = exp(-24.0 * distSq);
    float haloFalloff = exp(-6.0 * sqrt(distSq));
    float alpha = (coreFalloff * 0.75 + haloFalloff * 0.25) * uOpacity * vInfallFade;

    float temperature = vStellarParams.x;
    float luminosity = vStellarParams.y;
    vec3 starColor = blackbodyColor(temperature);

    if (uSpectralMode == 1) {
      float irBoost = clamp(6000.0 / max(temperature, 1500.0), 0.5, 2.5);
      starColor = mix(vec3(0.9, 0.4, 0.1), vec3(1.0, 0.9, 0.7), smoothstep(2000.0, 8000.0, temperature)) * irBoost;
    } else if (uSpectralMode == 2) {
      float coreProximity = 1.0 - smoothstep(0.0, 6.0, vRadius);
      vec3 synchrotronColor = mix(vec3(0.0, 0.8, 1.0), vec3(0.9, 0.1, 0.8), coreProximity);
      starColor = mix(starColor * 0.4, synchrotronColor, 0.7 + coreProximity * 0.3);
    }

    float lumBoost = clamp(log2(luminosity + 1.0) * 0.35, 0.9, 2.2);
    vec3 finalRgb = starColor * lumBoost;

    gl_FragColor = vec4(finalRgb, alpha);
  }
`;

export function createMilkyWayStars(options: GalaxyOptions = {}): GalaxyStarsInstance {
  const starCount = options.starCount ?? 150000;
  const scaleFactor = options.scaleFactor ?? 50.0;

  const positions = new Float32Array(starCount * 3);
  const stellarParams = new Float32Array(starCount * 4);
  const orbitalParams = new Float32Array(starCount * 2);

  let index = 0;

  const bulgeCount = Math.floor(starCount * 0.3);
  for (let i = 0; i < bulgeCount; i += 1) {
    const pt = generateBulgePoint();
    positions[index * 3] = pt.x;
    positions[index * 3 + 1] = pt.y;
    positions[index * 3 + 2] = pt.z;

    const stellar = sampleStellarType();
    const bulgeTemp = 3600 + Math.random() * 2200;

    stellarParams[index * 4] = bulgeTemp;
    stellarParams[index * 4 + 1] = stellar.luminosity * 0.9;
    stellarParams[index * 4 + 2] = stellar.baseSize * 1.05;
    stellarParams[index * 4 + 3] = 0.0;

    orbitalParams[index * 2] = pt.radius;
    orbitalParams[index * 2 + 1] = calculateGalacticOrbitalVelocity(pt.radius);

    index += 1;
  }

  const armCount = Math.floor(starCount * 0.6);
  const totalArmWeight = SPIRAL_ARMS.reduce((sum, arm) => sum + arm.weight, 0);

  for (let i = 0; i < armCount; i += 1) {
    const roll = Math.random() * totalArmWeight;
    let accumulated = 0;
    let selectedArm: SpiralArmConfig = SPIRAL_ARMS[0];
    for (const arm of SPIRAL_ARMS) {
      accumulated += arm.weight;
      if (roll <= accumulated) {
        selectedArm = arm;
        break;
      }
    }

    const progress = Math.pow(Math.random(), 0.85);
    const pt = generateSpiralArmPoint(selectedArm, progress);

    positions[index * 3] = pt.x;
    positions[index * 3 + 1] = pt.y;
    positions[index * 3 + 2] = pt.z;

    const stellar = sampleStellarType();
    let temp = stellar.temperature;
    if (Math.random() < 0.08 && pt.radius > 3.0) {
      temp = 12000 + Math.random() * 25000;
    }

    stellarParams[index * 4] = temp;
    stellarParams[index * 4 + 1] = stellar.luminosity;
    stellarParams[index * 4 + 2] = stellar.baseSize;
    stellarParams[index * 4 + 3] = 1.0;

    orbitalParams[index * 2] = pt.radius;
    orbitalParams[index * 2 + 1] = calculateGalacticOrbitalVelocity(pt.radius);

    index += 1;
  }

  while (index < starCount) {
    const isHalo = Math.random() < 0.35;
    const r = isHalo
      ? 2.0 + Math.random() * (GALACTIC_CONSTANTS.GALAXY_RADIUS * 1.2)
      : 1.5 + Math.random() * GALACTIC_CONSTANTS.GALAXY_RADIUS;

    const theta = Math.random() * Math.PI * 2.0;
    const scaleHeight = isHalo ? 3.5 : GALACTIC_CONSTANTS.DISC_SCALE_HEIGHT_THICK;
    const y = (Math.random() + Math.random() - 1.0) * scaleHeight;

    const x = r * Math.cos(theta);
    const z = r * Math.sin(theta);

    positions[index * 3] = x;
    positions[index * 3 + 1] = y;
    positions[index * 3 + 2] = z;

    const stellar = sampleStellarType();
    stellarParams[index * 4] = stellar.temperature;
    stellarParams[index * 4 + 1] = stellar.luminosity * 0.7;
    stellarParams[index * 4 + 2] = stellar.baseSize * 0.85;
    stellarParams[index * 4 + 3] = isHalo ? 2.0 : 1.5;

    orbitalParams[index * 2] = r;
    orbitalParams[index * 2 + 1] = calculateGalacticOrbitalVelocity(r);

    index += 1;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aStellarParams", new THREE.BufferAttribute(stellarParams, 4));
  geometry.setAttribute("aOrbitalParams", new THREE.BufferAttribute(orbitalParams, 2));

  const material = new THREE.ShaderMaterial({
    vertexShader: GALAXY_VERTEX_SHADER,
    fragmentShader: GALAXY_FRAGMENT_SHADER,
    uniforms: {
      uTime: { value: 0.0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2.0) },
      uSizeScale: { value: 1.0 },
      uScaleFactor: { value: scaleFactor },
      uOpacity: { value: 1.0 },
      uSpectralMode: { value: 0 }
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;

  return {
    mesh: points,
    material,
    geometry,
    scaleFactor,
    update: (elapsed: number) => {
      material.uniforms.uTime.value = elapsed;
    },
    setSpectralMode: (mode: number) => {
      material.uniforms.uSpectralMode.value = mode;
    },
    setOpacity: (opacity: number) => {
      material.uniforms.uOpacity.value = opacity;
    },
    setDrawCount: (count: number) => {
      geometry.setDrawRange(0, Math.min(count, starCount));
    }
  };
}
