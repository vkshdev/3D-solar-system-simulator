import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export type ScaleLevel = "HELIOCENTRIC_PLANETARY" | "INTERSTELLAR_TRANSITION" | "GALACTIC_MACRO";

export interface ScaleState {
  level: ScaleLevel;
  distanceToSun: number;
  distanceToGalacticCenter: number;
  transitionProgress: number;
  formattedDistance: string;
  formattedScaleUnit: string;
}

export interface FlightTarget {
  name: string;
  cameraPosition: THREE.Vector3;
  targetPosition: THREE.Vector3;
  description: string;
  preferredScale?: ScaleLevel;
}

export class ScaleController {
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private solarSystemGroup: THREE.Group;
  private solarAnchor: any;
  private onScaleUpdate?: (state: ScaleState) => void;

  private readonly HELIO_MAX_DIST = 420.0;
  private readonly GALACTIC_MIN_DIST = 950.0;

  private currentState: ScaleState;

  public isTransitioning = false;
  private transitionStartTime = 0;
  private transitionDuration = 2.4;
  private startCameraPos = new THREE.Vector3();
  private endCameraPos = new THREE.Vector3();
  private startTargetPos = new THREE.Vector3();
  private endTargetPos = new THREE.Vector3();
  private controlPoint = new THREE.Vector3();
  public currentTargetKey = "sol";

  constructor(
    camera: THREE.PerspectiveCamera,
    controls: OrbitControls,
    solarSystemGroup: THREE.Group,
    solarAnchor: any,
    onScaleUpdate?: (state: ScaleState) => void
  ) {
    this.camera = camera;
    this.controls = controls;
    this.solarSystemGroup = solarSystemGroup;
    this.solarAnchor = solarAnchor;
    this.onScaleUpdate = onScaleUpdate;

    this.currentState = {
      level: "HELIOCENTRIC_PLANETARY",
      distanceToSun: 175.0,
      distanceToGalacticCenter: 410.0,
      transitionProgress: 0.0,
      formattedDistance: "1.0 AU",
      formattedScaleUnit: "ASTRONOMICAL UNIT (AU)"
    };
  }

  public update(nowMs: number): ScaleState {
    if (this.isTransitioning) {
      this.stepCameraTransition(nowMs);
    }

    const sunWorldPos = this.solarSystemGroup.position;
    const distanceToSun = this.camera.position.distanceTo(sunWorldPos);
    const distanceToGalacticCenter = this.camera.position.length();

    const progress = THREE.MathUtils.clamp(
      (distanceToSun - this.HELIO_MAX_DIST) / (this.GALACTIC_MIN_DIST - this.HELIO_MAX_DIST),
      0.0,
      1.0
    );

    let level: ScaleLevel = "HELIOCENTRIC_PLANETARY";
    if (progress >= 1.0) {
      level = "GALACTIC_MACRO";
    } else if (progress > 0.0) {
      level = "INTERSTELLAR_TRANSITION";
    }

    const targetNear = THREE.MathUtils.lerp(0.1, 3.5, progress);
    const targetFar = THREE.MathUtils.lerp(4500.0, 14000.0, progress);

    if (Math.abs(this.camera.near - targetNear) > 0.05 || Math.abs(this.camera.far - targetFar) > 100.0) {
      this.camera.near = targetNear;
      this.camera.far = targetFar;
      this.camera.updateProjectionMatrix();
    }

    if (this.solarAnchor) {
      const beaconOpacity = Math.pow(progress, 1.5);
      this.solarAnchor.setVisible(progress > 0.05);
      if (this.solarAnchor.group) {
        this.solarAnchor.group.children.forEach((child: any) => {
          if (child.material && "opacity" in child.material) {
            child.material.opacity = child.userData.baseOpacity !== undefined
              ? child.userData.baseOpacity * beaconOpacity
              : child.material.opacity;
          }
        });
      }
    }

    let formattedDistance = "";
    let formattedScaleUnit = "";

    if (distanceToSun < 500) {
      const au = Math.max(0.1, distanceToSun * 0.45).toFixed(1);
      formattedDistance = `${au} AU (${(parseFloat(au) * 149.6).toFixed(0)}M KM)`;
      formattedScaleUnit = "SOLAR SYSTEM SCALE (AU)";
    } else if (distanceToSun < 1200) {
      const ly = ((distanceToSun - 500) * 0.08).toFixed(2);
      formattedDistance = `${ly} LIGHT-YEARS (LOCAL OORT CLOUD)`;
      formattedScaleUnit = "INTERSTELLAR NEIGHBORHOOD (LY)";
    } else {
      const kpc = (distanceToGalacticCenter / 50.0).toFixed(2);
      const ly = (parseFloat(kpc) * 3261.56).toLocaleString(undefined, { maximumFractionDigits: 0 });
      formattedDistance = `${kpc} KPC (${ly} LIGHT-YEARS)`;
      formattedScaleUnit = "GALACTIC DISK SCALE (KPC)";
    }

    this.currentState = {
      level,
      distanceToSun,
      distanceToGalacticCenter,
      transitionProgress: progress,
      formattedDistance,
      formattedScaleUnit
    };

    if (this.onScaleUpdate) {
      this.onScaleUpdate(this.currentState);
    }

    return this.currentState;
  }

  public flyTo(
    presetKey: string,
    flightTarget: FlightTarget,
    durationSeconds = 2.4
  ): void {
    this.isTransitioning = true;
    this.currentTargetKey = presetKey;
    this.transitionStartTime = performance.now();
    this.transitionDuration = durationSeconds;

    this.startCameraPos.copy(this.camera.position);
    this.endCameraPos.copy(flightTarget.cameraPosition);
    this.startTargetPos.copy(this.controls.target);
    this.endTargetPos.copy(flightTarget.targetPosition);

    const midPoint = new THREE.Vector3().addVectors(this.startCameraPos, this.endCameraPos).multiplyScalar(0.5);
    const travelDistance = this.startCameraPos.distanceTo(this.endCameraPos);

    const arcLift = Math.min(240.0, travelDistance * 0.3);
    this.controlPoint.copy(midPoint).add(new THREE.Vector3(0, arcLift, 0));
  }

  private stepCameraTransition(nowMs: number): void {
    const elapsed = (nowMs - this.transitionStartTime) / 1000.0;
    const rawT = THREE.MathUtils.clamp(elapsed / this.transitionDuration, 0.0, 1.0);

    const t = rawT * rawT * rawT * (rawT * (rawT * 6.0 - 15.0) + 10.0);

    const oneMinusT = 1.0 - t;
    const term0 = oneMinusT * oneMinusT;
    const term1 = 2.0 * oneMinusT * t;
    const term2 = t * t;

    this.camera.position.set(
      term0 * this.startCameraPos.x + term1 * this.controlPoint.x + term2 * this.endCameraPos.x,
      term0 * this.startCameraPos.y + term1 * this.controlPoint.y + term2 * this.endCameraPos.y,
      term0 * this.startCameraPos.z + term1 * this.controlPoint.z + term2 * this.endCameraPos.z
    );

    this.controls.target.lerpVectors(this.startTargetPos, this.endTargetPos, t);

    if (rawT >= 1.0) {
      this.isTransitioning = false;
    }
  }

  public getState(): ScaleState {
    return this.currentState;
  }
}
