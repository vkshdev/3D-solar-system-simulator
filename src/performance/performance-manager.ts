import type * as THREE from "three";

export type PerformanceTier = "HIGH" | "MEDIUM" | "LOW";

export interface PerformanceConfig {
  starCount: number;
  maxPixelRatio: number;
  shadows: boolean;
  bloomQuality: number;
}

export const PERFORMANCE_TIERS: Record<PerformanceTier, PerformanceConfig> = {
  HIGH: {
    starCount: 150000,
    maxPixelRatio: 1.8,
    shadows: true,
    bloomQuality: 1.0
  },
  MEDIUM: {
    starCount: 80000,
    maxPixelRatio: 1.4,
    shadows: false,
    bloomQuality: 0.75
  },
  LOW: {
    starCount: 40000,
    maxPixelRatio: 1.0,
    shadows: false,
    bloomQuality: 0.5
  }
};

export interface DiagnosticMetrics {
  fps: number;
  frameTimeMs: number;
  drawCalls: number;
  triangles: number;
  tier: PerformanceTier;
}

export class PerformanceManager {
  private currentTier: PerformanceTier = "HIGH";
  private frameTimes: number[] = [];
  private lastTime = performance.now();
  private maxHistory = 60;
  private autoDegradeEnabled = true;
  public onTierChange?: (tier: PerformanceTier, config: PerformanceConfig) => void;

  constructor() {
    this.currentTier = this.detectHardwareTier();
  }

  private detectHardwareTier(): PerformanceTier {
    if (typeof window === "undefined" || typeof navigator === "undefined") {
      return "HIGH";
    }

    const isMobile = /Android|iPhone|iPad|iPod|Windows Phone/i.test(navigator.userAgent);
    const cores = navigator.hardwareConcurrency ?? 4;
    const deviceMemory = (navigator as any).deviceMemory ?? 4;

    if (isMobile || cores <= 4 || deviceMemory < 4) {
      return "MEDIUM";
    }

    if (cores <= 2 || deviceMemory < 2) {
      return "LOW";
    }

    return "HIGH";
  }

  public recordFrame(rendererInfo?: THREE.WebGLInfo): DiagnosticMetrics {
    const now = performance.now();
    const delta = now - this.lastTime;
    this.lastTime = now;

    this.frameTimes.push(delta);
    if (this.frameTimes.length > this.maxHistory) {
      this.frameTimes.shift();
    }

    const avgDelta = this.frameTimes.reduce((sum, d) => sum + d, 0) / this.frameTimes.length;
    const fps = Math.round(1000 / Math.max(1, avgDelta));

    if (this.autoDegradeEnabled && this.frameTimes.length >= 60 && avgDelta > 25.0) {
      let changed = false;
      if (this.currentTier === "HIGH") {
        this.currentTier = "MEDIUM";
        this.frameTimes = [];
        changed = true;
      } else if (this.currentTier === "MEDIUM") {
        this.currentTier = "LOW";
        this.frameTimes = [];
        changed = true;
      }

      if (changed && this.onTierChange) {
        this.onTierChange(this.currentTier, this.getConfig());
      }
    }

    return {
      fps,
      frameTimeMs: parseFloat(avgDelta.toFixed(1)),
      drawCalls: rendererInfo?.render?.calls ?? 0,
      triangles: rendererInfo?.render?.triangles ?? 0,
      tier: this.currentTier
    };
  }

  public getTier(): PerformanceTier {
    return this.currentTier;
  }

  public getConfig(): PerformanceConfig {
    return PERFORMANCE_TIERS[this.currentTier];
  }

  public setTier(tier: PerformanceTier): void {
    const oldTier = this.currentTier;
    this.currentTier = tier;
    this.autoDegradeEnabled = false;
    if (oldTier !== tier && this.onTierChange) {
      this.onTierChange(this.currentTier, this.getConfig());
    }
  }
}
