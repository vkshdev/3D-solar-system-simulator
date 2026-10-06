import * as THREE from "three";

export interface FermiBubblesOptions {
  scaleFactor?: number;
  heightKpc?: number;
  radiusKpc?: number;
}

export interface FermiBubblesInstance {
  group: THREE.Group;
  update: (elapsed: number, cameraPosition: THREE.Vector3) => void;
  setSpectralMode: (mode: number) => void;
}

const FERMI_BUBBLE_VERTEX_SHADER = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vWorldPosition;
  varying vec2 vUv;

  void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const FERMI_BUBBLE_FRAGMENT_SHADER = /* glsl */ `
  #ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
  #else
    precision mediump float;
  #endif

  uniform float uTime;
  uniform vec3 uCameraPosition;
  uniform float uIntensity;
  uniform int uSpectralMode;

  varying vec3 vNormal;
  varying vec3 vWorldPosition;
  varying vec2 vUv;

  void main() {
    vec3 viewDir = normalize(uCameraPosition - vWorldPosition);
    float fresnel = 1.0 - abs(dot(viewDir, vNormal));
    float edgeLimb = pow(fresnel, 2.2);

    float verticalMask = smoothstep(0.0, 0.25, vUv.y) * (1.0 - smoothstep(0.85, 1.0, vUv.y));
    float shimmer = 0.88 + 0.12 * sin(uTime * 1.8 + vWorldPosition.y * 0.05);

    vec3 coreColor = vec3(0.0, 0.75, 1.0);
    vec3 edgeColor = vec3(0.65, 0.15, 0.95);
    vec3 bubbleColor = mix(coreColor, edgeColor, edgeLimb);

    float alpha = edgeLimb * verticalMask * uIntensity * shimmer;

    gl_FragColor = vec4(bubbleColor * (edgeLimb * 1.6 + 0.4), clamp(alpha, 0.0, 0.85));
  }
`;

export function createFermiBubbles(options: FermiBubblesOptions = {}): FermiBubblesInstance {
  const group = new THREE.Group();
  group.name = "FermiBubbles";

  const scaleFactor = options.scaleFactor ?? 50.0;
  const lobeHeight = (options.heightKpc ?? 8.5) * scaleFactor;
  const lobeRadius = (options.radiusKpc ?? 4.0) * scaleFactor;

  const bubbleGeo = new THREE.SphereGeometry(1.0, 48, 48);
  bubbleGeo.scale(lobeRadius, lobeHeight * 0.5, lobeRadius);

  const bubbleMat = new THREE.ShaderMaterial({
    vertexShader: FERMI_BUBBLE_VERTEX_SHADER,
    fragmentShader: FERMI_BUBBLE_FRAGMENT_SHADER,
    uniforms: {
      uTime: { value: 0.0 },
      uCameraPosition: { value: new THREE.Vector3() },
      uIntensity: { value: 0.18 },
      uSpectralMode: { value: 0 }
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide
  });

  const northLobe = new THREE.Mesh(bubbleGeo, bubbleMat);
  northLobe.position.set(0, lobeHeight * 0.5, 0);
  group.add(northLobe);

  const southLobe = new THREE.Mesh(bubbleGeo, bubbleMat);
  southLobe.position.set(0, -lobeHeight * 0.5, 0);
  southLobe.rotation.z = Math.PI;
  group.add(southLobe);

  return {
    group,
    update: (elapsed: number, cameraPosition: THREE.Vector3) => {
      bubbleMat.uniforms.uTime.value = elapsed;
      bubbleMat.uniforms.uCameraPosition.value.copy(cameraPosition);
    },
    setSpectralMode: (mode: number) => {
      bubbleMat.uniforms.uSpectralMode.value = mode;
      if (mode === 2) {
        bubbleMat.uniforms.uIntensity.value = 0.85;
      } else if (mode === 1) {
        bubbleMat.uniforms.uIntensity.value = 0.04;
      } else {
        bubbleMat.uniforms.uIntensity.value = 0.18;
      }
    }
  };
}
