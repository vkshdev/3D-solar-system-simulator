export interface TargetTelemetryData {
  name: string;
  catalog: string;
  coordinates: string;
  distance: string;
  spectralType: string;
  mass: string;
  region: string;
}

export const TARGET_DATABASE: Record<string, TargetTelemetryData> = {
  sol: {
    name: "Sun / Sol System",
    catalog: "IAU 134340 / Sol",
    coordinates: "[0.00, +0.02, 8.20] kpc",
    distance: "26,740 LY (8.20 kpc to Sgr A*)",
    spectralType: "G2V Main Sequence Yellow Dwarf",
    mass: "1.00 M☉ (1.989e30 kg)",
    region: "Orion-Cygnus Spur (Local Arm)"
  },
  galaxy: {
    name: "Milky Way Galaxy",
    catalog: "Milky Way (SBbc Barred Spiral)",
    coordinates: "[0.00, 0.00, 0.00] kpc",
    distance: "Macroscopic Frustum",
    spectralType: "Barred Spiral Ensemble (OBAFGKM)",
    mass: "1.15e12 M☉ (Baryonic + Dark Halo)",
    region: "Local Group Virial Domain"
  },
  sgrA: {
    name: "Sagittarius A*",
    catalog: "Galactic Center Radio Core",
    coordinates: "[0.00, 0.00, 0.00] kpc",
    distance: "0.00 kpc (Galactic Origin)",
    spectralType: "Supermassive Black Hole / Lensed RIAF",
    mass: "4.154e6 M☉ (Schwarzschild Metric)",
    region: "Galactic Nucleus / Central Bulge"
  }
};

export class TargetInspector {
  private cardElement: HTMLElement;
  private nameEl: HTMLElement | null;
  private catalogEl: HTMLElement | null;
  private coordEl: HTMLElement | null;
  private distEl: HTMLElement | null;
  private specEl: HTMLElement | null;
  private massEl: HTMLElement | null;
  private regionEl: HTMLElement | null;

  constructor(cardElement: HTMLElement) {
    this.cardElement = cardElement;
    this.nameEl = cardElement.querySelector("#inspector-name");
    this.catalogEl = cardElement.querySelector("#inspector-catalog");
    this.coordEl = cardElement.querySelector("#inspector-coord");
    this.distEl = cardElement.querySelector("#inspector-dist");
    this.specEl = cardElement.querySelector("#inspector-spec");
    this.massEl = cardElement.querySelector("#inspector-mass");
    this.regionEl = cardElement.querySelector("#inspector-region");
  }

  public setTarget(targetKey: string): void {
    const data = TARGET_DATABASE[targetKey] ?? TARGET_DATABASE.sol;
    if (this.nameEl) this.nameEl.textContent = data.name;
    if (this.catalogEl) this.catalogEl.textContent = data.catalog;
    if (this.coordEl) this.coordEl.textContent = data.coordinates;
    if (this.distEl) this.distEl.textContent = data.distance;
    if (this.specEl) this.specEl.textContent = data.spectralType;
    if (this.massEl) this.massEl.textContent = data.mass;
    if (this.regionEl) this.regionEl.textContent = data.region;
  }
}
