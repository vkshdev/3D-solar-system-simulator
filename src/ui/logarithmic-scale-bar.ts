export interface LogScaleBarOptions {
  containerElement: HTMLElement;
  minDistance?: number;
  maxDistance?: number;
}

export class LogarithmicScaleBar {
  private needleElement: HTMLElement | null;
  private readoutElement: HTMLElement | null;
  private minDistance: number;
  private maxDistance: number;
  private logMin: number;
  private logMax: number;

  constructor(options: LogScaleBarOptions) {
    this.needleElement = options.containerElement.querySelector(".scale-needle");
    this.readoutElement = options.containerElement.querySelector(".scale-readout-text");
    this.minDistance = options.minDistance ?? 12.0;
    this.maxDistance = options.maxDistance ?? 4000.0;
    this.logMin = Math.log10(this.minDistance);
    this.logMax = Math.log10(this.maxDistance);
  }

  public update(currentDistance: number, distanceToCenter: number): void {
    const clampedDist = Math.max(this.minDistance, Math.min(this.maxDistance, currentDistance));
    const logVal = Math.log10(clampedDist);
    const fraction = (logVal - this.logMin) / (this.logMax - this.logMin);
    const percentage = Math.max(0, Math.min(100, fraction * 100));

    if (this.needleElement) {
      this.needleElement.style.left = `${percentage.toFixed(1)}%`;
    }

    if (this.readoutElement) {
      let metric = "";
      if (currentDistance < 450) {
        const au = (currentDistance * 0.42).toFixed(1);
        const km = (parseFloat(au) * 149.6).toFixed(0);
        metric = `${au} AU (${km}M KM) - INNER SOLAR SYSTEM`;
      } else if (currentDistance < 1000) {
        const ly = ((currentDistance - 450) * 0.08).toFixed(2);
        metric = `${ly} LIGHT-YEARS - INTERSTELLAR OORT CLOUD`;
      } else {
        const kpc = (distanceToCenter / 50.0).toFixed(2);
        const ly = (parseFloat(kpc) * 3261.56).toLocaleString(undefined, { maximumFractionDigits: 0 });
        metric = `${kpc} KPC (${ly} LY) - GALACTIC DISK`;
      }
      this.readoutElement.textContent = `ALTITUDE: ${metric}`;
    }
  }
}
