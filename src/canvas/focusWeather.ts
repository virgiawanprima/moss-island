export interface Puddle {
  r: number;
  c: number;
  radius: number;
  depth: number;
}

export function createPuddles(occupied: Array<{ r: number; c: number }>, random = Math.random): Puddle[] {
  const candidates: Array<{ r: number; c: number }> = [];
  for (let r = 1; r <= 4; r++) {
    for (let c = 1; c <= 4; c++) {
      if (!occupied.some(tile => tile.r === r && tile.c === c)) candidates.push({ r, c });
    }
  }
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  return candidates.slice(0, 2 + Math.floor(random() * 3)).map(tile => ({
    r: tile.r + (random() - 0.5) * 0.25,
    c: tile.c + (random() - 0.5) * 0.25,
    radius: 6 + random() * 5,
    depth: 2.5 + random() * 1.5,
  }));
}

export class FocusWeather {
  private untilRain: number;
  private remaining = 0;
  public intensity = 0;
  public wetness = 0;

  constructor(private random: () => number = Math.random) {
    this.untilRain = 24 + random() * 24;
  }

  step(seconds: number, enabled: boolean, allowRain: boolean): boolean {
    if (!enabled) return false;
    const dt = Math.min(0.25, Math.max(0, seconds));
    let started = false;
    if (!allowRain) {
      this.remaining = 0;
    } else if (this.remaining > 0) {
      this.remaining = Math.max(0, this.remaining - dt);
      if (this.remaining === 0) this.untilRain = 90 + this.random() * 70;
    } else {
      this.untilRain -= dt;
      if (this.untilRain <= 0) {
        this.remaining = 14 + this.random() * 8;
        started = true;
      }
    }
    const raining = this.remaining > 0;
    this.intensity = Math.max(0, Math.min(1, this.intensity + (raining ? dt / 2 : -dt / 3)));
    this.wetness = Math.max(0, Math.min(1, this.wetness + (raining ? dt / 14 : -dt / 55)));
    return started;
  }
}
