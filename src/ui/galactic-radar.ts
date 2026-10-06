import * as THREE from "three";
import { SPIRAL_ARMS, GALACTIC_CONSTANTS, type SpiralArmConfig } from "../galaxy/galaxy-math.ts";

export interface GalacticRadarOptions {
  canvas: HTMLCanvasElement;
  scaleFactor?: number;
  onRadarClick?: (galacticCoords: { x: number; z: number }) => void;
}

export class GalacticRadar {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private size: number;
  private scaleFactor: number;
  private maxRadiusKpc = 18.0;

  constructor(options: GalacticRadarOptions) {
    this.canvas = options.canvas;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Could not acquire 2D rendering context for galactic radar");
    }
    this.ctx = ctx;
    this.scaleFactor = options.scaleFactor ?? 50.0;
    this.size = this.canvas.width;

    if (options.onRadarClick) {
      this.canvas.addEventListener("click", (e) => {
        const rect = this.canvas.getBoundingClientRect();
        const clientX = e.clientX - rect.left;
        const clientY = e.clientY - rect.top;
        const cx = this.canvas.width * 0.5;
        const cy = this.canvas.height * 0.5;

        const pxPerKpc = (this.canvas.width * 0.44) / this.maxRadiusKpc;
        const xKpc = (clientX - cx) / pxPerKpc;
        const zKpc = (clientY - cy) / pxPerKpc;

        options.onRadarClick?.({ x: xKpc * this.scaleFactor, z: zKpc * this.scaleFactor });
      });
    }
  }

  public render(camera: THREE.Camera, controlsTarget: THREE.Vector3, elapsed: number): void {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const cx = w * 0.5;
    const cy = h * 0.5;
    const radarRadius = w * 0.44;
    const pxPerKpc = radarRadius / this.maxRadiusKpc;

    ctx.clearRect(0, 0, w, h);

    ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
    ctx.lineWidth = 1;

    [4.0, 8.2, 12.0, 16.0].forEach((rKpc) => {
      const rPx = rKpc * pxPerKpc;
      ctx.beginPath();
      ctx.arc(cx, cy, rPx, 0, Math.PI * 2);
      ctx.stroke();

      if (rKpc === 8.2) {
        ctx.save();
        ctx.strokeStyle = "rgba(255, 255, 255, 0.40)";
        ctx.setLineDash([2, 4]);
        ctx.beginPath();
        ctx.arc(cx, cy, rPx, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    });

    ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
    ctx.beginPath();
    ctx.moveTo(cx, 0); ctx.lineTo(cx, h);
    ctx.moveTo(0, cy); ctx.lineTo(w, cy);
    ctx.stroke();

    ctx.strokeStyle = "rgba(255, 255, 255, 0.26)";
    ctx.lineWidth = 1.2;

    SPIRAL_ARMS.forEach((arm: SpiralArmConfig) => {
      ctx.beginPath();
      const steps = 32;
      for (let i = 0; i <= steps; i += 1) {
        const progress = i / steps;
        const rKpc = arm.rMin + progress * (arm.rMax - arm.rMin);
        const theta = (Math.log(rKpc / arm.rMin) / Math.tan(arm.pitchAngle)) + arm.phase;
        const xPx = cx + (rKpc * Math.cos(theta)) * pxPerKpc;
        const yPx = cy + (rKpc * Math.sin(theta)) * pxPerKpc;

        if (i === 0) {
          ctx.moveTo(xPx, yPx);
        } else {
          ctx.lineTo(xPx, yPx);
        }
      }
      ctx.stroke();
    });

    ctx.fillStyle = "rgba(255, 255, 255, 0.10)";
    ctx.beginPath();
    ctx.ellipse(cx, cy, 3.4 * pxPerKpc, 1.4 * pxPerKpc, 0.4712, 0, Math.PI * 2);
    ctx.fill();

    const corePulse = 1.0 + Math.sin(elapsed * 3.0) * 0.2;
    ctx.fillStyle = "#d4d4d8";
    ctx.beginPath();
    ctx.arc(cx, cy, 3 * corePulse, 0, Math.PI * 2);
    ctx.fill();

    const solKpc = GALACTIC_CONSTANTS.SOLAR_POSITION;
    const solPxX = cx + solKpc.x * pxPerKpc;
    const solPxY = cy + solKpc.z * pxPerKpc;

    const solPulse = 1.0 + Math.sin(elapsed * 2.5) * 0.25;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(solPxX, solPxY, 3.5 * solPulse, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "rgba(255, 255, 255, 0.65)";
    ctx.beginPath();
    ctx.arc(solPxX, solPxY, 6.0 * solPulse, 0, Math.PI * 2);
    ctx.stroke();

    const camKpcX = camera.position.x / this.scaleFactor;
    const camKpcZ = camera.position.z / this.scaleFactor;
    const camPxX = cx + camKpcX * pxPerKpc;
    const camPxY = cy + camKpcZ * pxPerKpc;

    const viewVector = new THREE.Vector3();
    camera.getWorldDirection(viewVector);
    const viewAngle = Math.atan2(viewVector.z, viewVector.x);

    ctx.save();
    ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
    ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
    ctx.lineWidth = 1;

    const fovHalf = 0.38;
    const fovLength = 22.0;

    ctx.beginPath();
    ctx.moveTo(camPxX, camPxY);
    ctx.lineTo(
      camPxX + Math.cos(viewAngle - fovHalf) * fovLength,
      camPxY + Math.sin(viewAngle - fovHalf) * fovLength
    );
    ctx.arc(camPxX, camPxY, fovLength, viewAngle - fovHalf, viewAngle + fovHalf);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(camPxX, camPxY, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
