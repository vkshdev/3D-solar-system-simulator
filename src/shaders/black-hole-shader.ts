import * as THREE from "three";

export interface BlackHoleOptions {
  radius?: number;
  diskInnerRadius?: number;
  diskOuterRadius?: number;
  scaleFactor?: number;
}

export interface BlackHoleInstance {
  group: THREE.Group;
  update: (elapsed: number, cameraPosition: THREE.Vector3) => void;
  setSpectralMode: (mode: number) => void;
}

const ACCRETION_DISK_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldPosition;
  varying vec3 vLocalPosition;

  void main() {
    vUv = uv;
    vLocalPosition = position;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const ACCRETION_DISK_FRAGMENT_SHADER = /* glsl */ `
  #ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
  #else
    precision mediump float;
  #endif

  uniform float uTime;
  uniform vec3 uCameraPosition;
  uniform float uHorizonRadius;
  uniform float uIscoRadius;
  uniform float uOuterRadius;
  uniform int uSpectralMode;

  varying vec2 vUv;
  varying vec3 vWorldPosition;
  varying vec3 vLocalPosition;

  vec3 permute(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
  float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod(i, 289.0);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
    m = m * m;
    m = m * m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
    vec3 g;
    g.x = a0.x * x0.x + h.x * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }

  void main() {
    float r = length(vLocalPosition.xz);
    if (r < uHorizonRadius || r > uOuterRadius) {
      discard;
    }

    float radialNorm = clamp((r - uIscoRadius) / (uOuterRadius - uIscoRadius), 0.0, 1.0);

    float omega = 24.0 * pow(max(r, 0.1), -1.5);
    float angle = atan(vLocalPosition.z, vLocalPosition.x);
    float rotatedAngle = angle + omega * uTime * 0.12;

    vec2 noiseCoord = vec2(r * 0.45, rotatedAngle * 2.8);
    float n1 = snoise(noiseCoord) * 0.5 + 0.5;
    float n2 = snoise(noiseCoord * 2.2 + vec2(uTime * 0.15, 0.0)) * 0.5 + 0.5;
    float plasmaTurbulence = mix(n1, n2, 0.45);

    float beta = clamp(sqrt(uHorizonRadius / (2.0 * max(r, uHorizonRadius))), 0.0, 0.65);

    vec3 tangentDir = normalize(vec3(-sin(angle), 0.0, cos(angle)));
    vec3 viewDir = normalize(uCameraPosition - vWorldPosition);

    float cosThetaV = dot(tangentDir, viewDir);
    float gamma = 1.0 / sqrt(max(0.001, 1.0 - beta * beta));
    float delta = 1.0 / max(0.01, (gamma * (1.0 - beta * cosThetaV)));
    float dopplerBoost = clamp(pow(delta, 3.5), 0.15, 6.5);

    float tempProfile = pow(max(0.01, 1.0 - sqrt(uIscoRadius / max(r, uIscoRadius))), 0.25) * pow(r / uIscoRadius, -0.75);
    tempProfile = clamp(tempProfile, 0.0, 1.0);

    vec3 blueshiftColor = vec3(0.75, 0.92, 1.0);
    vec3 neutralColor   = vec3(1.0, 0.78, 0.38);
    vec3 redshiftColor  = vec3(0.95, 0.28, 0.08);

    vec3 plasmaColor;
    if (cosThetaV > 0.0) {
      plasmaColor = mix(neutralColor, blueshiftColor, smoothstep(0.0, 0.8, cosThetaV * beta));
    } else {
      plasmaColor = mix(neutralColor, redshiftColor, smoothstep(0.0, 0.8, -cosThetaV * beta));
    }

    if (uSpectralMode == 1) {
      plasmaColor = mix(vec3(1.0, 0.45, 0.1), vec3(0.9, 0.85, 0.6), tempProfile);
    } else if (uSpectralMode == 2) {
      plasmaColor = mix(vec3(0.0, 0.85, 1.0), vec3(0.85, 0.1, 0.95), cosThetaV * 0.5 + 0.5);
    }

    float innerCutoff = smoothstep(uHorizonRadius, uIscoRadius, r);
    float outerCutoff = 1.0 - smoothstep(uOuterRadius * 0.7, uOuterRadius, r);
    float radialMask = innerCutoff * outerCutoff;

    float alpha = radialMask * (plasmaTurbulence * 0.65 + 0.35) * clamp(dopplerBoost * 0.75, 0.2, 1.0);

    vec3 finalRgb = plasmaColor * (dopplerBoost * 1.45 + tempProfile * 0.8) * (0.8 + plasmaTurbulence * 0.4);

    gl_FragColor = vec4(finalRgb, clamp(alpha, 0.0, 0.95));
  }
`;

/**
 * GLSL Vertex Shader for Gravitational Lensing Halo (Photon Ring)
 */
const PHOTON_RING_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * GLSL Fragment Shader for Gravitational Lensing Halo (Photon Sphere)
 */
const PHOTON_RING_FRAGMENT_SHADER = /* glsl */ `
  #ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
  #else
    precision mediump float;
  #endif

  uniform float uTime;
  uniform float uHorizonRadius;
  uniform int uSpectralMode;
  varying vec2 vUv;

  void main() {
    vec2 coord = vUv - vec2(0.5);
    float dist = length(coord) * 2.0;

    float ringPeak = 0.52;
    float ringThickness = 0.038;
    float ringIntensity = exp(-pow((dist - ringPeak) / ringThickness, 2.0));

    float outerGlow = exp(-max(0.0, dist - ringPeak) * 6.5) * 0.35;

    if (dist < ringPeak - 0.03) {
      discard;
    }

    vec3 ringColor = vec3(1.0, 0.85, 0.55);
    if (uSpectralMode == 1) {
      ringColor = vec3(1.0, 0.5, 0.15);
    } else if (uSpectralMode == 2) {
      ringColor = vec3(0.2, 0.9, 1.0);
    }

    float alpha = clamp(ringIntensity * 0.95 + outerGlow, 0.0, 1.0);
    gl_FragColor = vec4(ringColor * (ringIntensity * 2.2 + outerGlow * 0.8), alpha);
  }
`;

const S_CLUSTER_VERTEX_SHADER = /* glsl */ `
  attribute vec4 aOrbitalData;
  attribute vec4 aStarData;

  uniform float uTime;
  uniform vec3 uCameraPosition;
  uniform float uHorizonRadius;
  uniform float uOuterRadius;
  uniform float uPixelRatio;

  varying vec3 vColor;
  varying float vAlpha;

  vec3 blackbodyColor(float kelvin) {
    float t = clamp(kelvin, 2000.0, 45000.0) / 100.0;
    vec3 color;
    if (t <= 66.0) {
      color.r = 1.0;
      color.g = clamp(99.47 * log(t) - 161.12, 0.0, 255.0) / 255.0;
      color.b = t <= 19.0 ? 0.0 : clamp(138.52 * log(t - 10.0) - 305.04, 0.0, 255.0) / 255.0;
    } else {
      color.r = clamp(pow((t - 60.0) / 100.0, -0.1332) * 1.29, 0.0, 1.0);
      color.g = clamp(288.12 * pow(t - 60.0, -0.0755), 0.0, 255.0) / 255.0;
      color.b = 1.0;
    }
    return color;
  }

  void main() {
    float phaseSeed = aStarData.x;
    float baseSize = aStarData.y;
    float tempKelvin = aStarData.z;
    float fallSpeed = aStarData.w;

    float baseRadius = aOrbitalData.x;
    float inc = aOrbitalData.y;
    float nodeAngle = aOrbitalData.z;
    float ecc = aOrbitalData.w;

    float cycle = fract(phaseSeed - uTime * fallSpeed);

    float r = uHorizonRadius * 1.04 + pow(cycle, 1.2) * (baseRadius - uHorizonRadius * 1.04);

    float omega = 0.35 / pow(max(r / uHorizonRadius, 1.0), 1.25);
    float spiralWinding = (1.0 - cycle) * 14.0 + (uHorizonRadius / r) * 2.8;
    float theta = nodeAngle + uTime * omega + spiralWinding;

    float rOrb = r * (1.0 - ecc * ecc) / (1.0 + ecc * cos(theta * 1.4));

    vec3 orbitPos = vec3(
      rOrb * cos(theta),
      (rOrb * sin(theta)) * sin(inc) * 0.45,
      (rOrb * sin(theta)) * cos(inc)
    );

    vec4 worldPos = modelMatrix * vec4(orbitPos, 1.0);
    vec4 mvPosition = viewMatrix * worldPos;
    gl_Position = projectionMatrix * mvPosition;

    vAlpha = smoothstep(0.0, 0.08, cycle) * smoothstep(1.0, 0.92, cycle);

    float proximity = 1.0 - clamp((r - uHorizonRadius) / (uOuterRadius * 1.5), 0.0, 1.0);
    float finalTemp = mix(tempKelvin, 40000.0, proximity * 0.9);
    vec3 col = blackbodyColor(finalTemp);

    vec3 orbitVelocity = vec3(-sin(theta), 0.0, cos(theta));
    vec3 toCam = normalize(uCameraPosition - worldPos.xyz);
    float dopplerCos = dot(orbitVelocity, toCam);
    float dopplerBoost = clamp(1.0 + dopplerCos * 0.45 * proximity, 0.5, 1.8);

    vColor = col * (1.2 + proximity * 1.8) * dopplerBoost;

    float viewDist = max(0.1, -mvPosition.z);
    float ptSize = (baseSize * (1.0 + proximity * 0.8) * uPixelRatio * 280.0) / viewDist;
    gl_PointSize = clamp(ptSize, 1.5, 36.0);
  }
`;

const S_CLUSTER_FRAGMENT_SHADER = /* glsl */ `
  #ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
  #else
    precision mediump float;
  #endif

  uniform int uSpectralMode;

  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec2 coord = gl_PointCoord - vec2(0.5);
    float distSq = dot(coord, coord);
    if (distSq > 0.25) {
      discard;
    }

    float coreFalloff = exp(-28.0 * distSq);
    float haloFalloff = exp(-7.0 * sqrt(distSq));
    float intensity = (coreFalloff * 0.85 + haloFalloff * 0.35);

    vec3 finalColor = vColor;
    if (uSpectralMode == 1) {
      finalColor = mix(vec3(1.0, 0.5, 0.1), vec3(1.0, 0.9, 0.6), coreFalloff);
    } else if (uSpectralMode == 2) {
      finalColor = mix(vec3(0.0, 0.9, 1.0), vec3(0.8, 0.2, 1.0), coreFalloff);
    }

    gl_FragColor = vec4(finalColor * intensity, vAlpha * intensity);
  }
`;

function createSCluster(
  horizonRadius: number,
  outerRadius: number
): { points: THREE.Points; material: THREE.ShaderMaterial } {
  const count = 1200;
  const orbitalData = new Float32Array(count * 4);
  const starData = new Float32Array(count * 4);

  for (let i = 0; i < count; i += 1) {
    const rBase = horizonRadius * 1.15 + Math.pow(Math.random(), 1.4) * (outerRadius * 2.2 - horizonRadius * 1.15);
    const inc = (Math.random() - 0.5) * (Math.random() < 0.6 ? 0.45 : Math.PI * 0.9);
    const node = Math.random() * Math.PI * 2.0;
    const ecc = 0.05 + Math.random() * 0.55;

    orbitalData[i * 4] = rBase;
    orbitalData[i * 4 + 1] = inc;
    orbitalData[i * 4 + 2] = node;
    orbitalData[i * 4 + 3] = ecc;

    const phase = Math.random();
    const size = 1.2 + Math.random() * 1.6;
    const temp = 12000 + Math.random() * 26000;
    const speed = 0.012 + Math.random() * 0.010;

    starData[i * 4] = phase;
    starData[i * 4 + 1] = size;
    starData[i * 4 + 2] = temp;
    starData[i * 4 + 3] = speed;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute("aOrbitalData", new THREE.BufferAttribute(orbitalData, 4));
  geometry.setAttribute("aStarData", new THREE.BufferAttribute(starData, 4));

  const material = new THREE.ShaderMaterial({
    vertexShader: S_CLUSTER_VERTEX_SHADER,
    fragmentShader: S_CLUSTER_FRAGMENT_SHADER,
    uniforms: {
      uTime: { value: 0.0 },
      uCameraPosition: { value: new THREE.Vector3() },
      uHorizonRadius: { value: horizonRadius },
      uOuterRadius: { value: outerRadius },
      uPixelRatio: { value: Math.min(typeof window !== "undefined" ? window.devicePixelRatio : 1, 2.0) },
      uSpectralMode: { value: 0 }
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;

  return { points, material };
}

export function createSagittariusACore(options: BlackHoleOptions = {}): BlackHoleInstance {
  const group = new THREE.Group();
  group.name = "SagittariusACore";

  const horizonRadius = options.radius ?? 3.2;
  const iscoRadius = options.diskInnerRadius ?? 7.5;
  const outerRadius = options.diskOuterRadius ?? 28.0;

  const horizonGeo = new THREE.SphereGeometry(horizonRadius * 0.98, 48, 48);
  const horizonMat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    depthWrite: true
  });
  const horizonMesh = new THREE.Mesh(horizonGeo, horizonMat);
  group.add(horizonMesh);

  const photonRingGeo = new THREE.PlaneGeometry(horizonRadius * 7.5, horizonRadius * 7.5);
  const photonRingMat = new THREE.ShaderMaterial({
    vertexShader: PHOTON_RING_VERTEX_SHADER,
    fragmentShader: PHOTON_RING_FRAGMENT_SHADER,
    uniforms: {
      uTime: { value: 0.0 },
      uHorizonRadius: { value: horizonRadius },
      uSpectralMode: { value: 0 }
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide
  });
  const photonRingMesh = new THREE.Mesh(photonRingGeo, photonRingMat);
  group.add(photonRingMesh);

  const diskGeo = new THREE.RingGeometry(horizonRadius * 1.05, outerRadius, 160, 48);
  const diskMat = new THREE.ShaderMaterial({
    vertexShader: ACCRETION_DISK_VERTEX_SHADER,
    fragmentShader: ACCRETION_DISK_FRAGMENT_SHADER,
    uniforms: {
      uTime: { value: 0.0 },
      uCameraPosition: { value: new THREE.Vector3() },
      uHorizonRadius: { value: horizonRadius },
      uIscoRadius: { value: iscoRadius },
      uOuterRadius: { value: outerRadius },
      uSpectralMode: { value: 0 }
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide
  });

  const diskMesh = new THREE.Mesh(diskGeo, diskMat);
  diskMesh.rotation.x = Math.PI * 0.5 - 0.22;
  diskMesh.rotation.z = 0.35;
  group.add(diskMesh);

  const lensedDiskGeo = new THREE.RingGeometry(horizonRadius * 1.02, iscoRadius * 1.45, 128, 24);
  const lensedDiskMat = new THREE.ShaderMaterial({
    vertexShader: ACCRETION_DISK_VERTEX_SHADER,
    fragmentShader: ACCRETION_DISK_FRAGMENT_SHADER,
    uniforms: {
      uTime: { value: 0.0 },
      uCameraPosition: { value: new THREE.Vector3() },
      uHorizonRadius: { value: horizonRadius },
      uIscoRadius: { value: iscoRadius },
      uOuterRadius: { value: iscoRadius * 1.45 },
      uSpectralMode: { value: 0 }
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide
  });

  const upperLensedMesh = new THREE.Mesh(lensedDiskGeo, lensedDiskMat);
  upperLensedMesh.rotation.x = Math.PI * 0.15;
  group.add(upperLensedMesh);

  const sCluster = createSCluster(horizonRadius, outerRadius);
  group.add(sCluster.points);

  return {
    group,
    update: (elapsed: number, cameraPosition: THREE.Vector3) => {
      photonRingMesh.quaternion.copy(
        new THREE.Quaternion().setFromRotationMatrix(
          new THREE.Matrix4().lookAt(cameraPosition, group.position, new THREE.Vector3(0, 1, 0))
        )
      );

      diskMat.uniforms.uTime.value = elapsed;
      diskMat.uniforms.uCameraPosition.value.copy(cameraPosition);

      lensedDiskMat.uniforms.uTime.value = elapsed;
      lensedDiskMat.uniforms.uCameraPosition.value.copy(cameraPosition);

      photonRingMat.uniforms.uTime.value = elapsed;

      sCluster.material.uniforms.uTime.value = elapsed;
      sCluster.material.uniforms.uCameraPosition.value.copy(cameraPosition);
    },
    setSpectralMode: (mode: number) => {
      diskMat.uniforms.uSpectralMode.value = mode;
      lensedDiskMat.uniforms.uSpectralMode.value = mode;
      photonRingMat.uniforms.uSpectralMode.value = mode;
      sCluster.material.uniforms.uSpectralMode.value = mode;
    }
  };
}
