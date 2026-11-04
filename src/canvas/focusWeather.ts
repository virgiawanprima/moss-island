import type { IslandSeason } from '../types';

export const SEASON_WEATHER = {
  spring: { gap: [120, 240], duration: [18, 30], strength: 0.5, dryingSeconds: 65 },
  summer: { gap: [300, 540], duration: [8, 16], strength: 0.35, dryingSeconds: 30 },
  autumn: { gap: [90, 180], duration: [28, 45], strength: 0.7, dryingSeconds: 95 },
  winter: { gap: [0, 0], duration: [0, 0], strength: 0, dryingSeconds: 1 },
} as const;

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
  private season: IslandSeason = 'spring';

  constructor(private random: () => number = Math.random) {
    this.untilRain = this.nextGap();
  }

  private nextGap(): number {
    const [low, high] = SEASON_WEATHER[this.season].gap;
    return low + this.random() * (high - low);
  }

  setSeason(season: IslandSeason) {
    if (season === this.season) return;
    this.season = season;
    this.remaining = 0;
    this.untilRain = this.nextGap();
    if (season === 'winter') this.intensity = this.wetness = 0;
  }

  step(seconds: number, enabled: boolean, season: IslandSeason): boolean {
    this.setSeason(season);
    if (!enabled) return false;
    const dt = Number.isFinite(seconds) ? Math.min(0.25, Math.max(0, seconds)) : 0;
    if (dt === 0) return false;
    const profile = SEASON_WEATHER[season];
    let started = false;
    if (season === 'winter') {
      this.intensity = this.wetness = 0;
      return false;
    } else if (this.remaining > 0) {
      this.remaining = Math.max(0, this.remaining - dt);
      if (this.remaining === 0) this.untilRain = this.nextGap();
    } else {
      this.untilRain -= dt;
      if (this.untilRain <= 0) {
        const [low, high] = profile.duration;
        this.remaining = low + this.random() * (high - low);
        started = true;
      }
    }
    const raining = this.remaining > 0;
    this.intensity = raining
      ? Math.min(profile.strength, this.intensity + dt * profile.strength / 4)
      : Math.max(0, this.intensity - dt / 6);
    this.wetness = Math.max(0, Math.min(1, this.wetness + (raining ? this.intensity * dt / 14 : -dt / profile.dryingSeconds)));
    return started;
  }
}
