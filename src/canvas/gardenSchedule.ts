export class GardenSchedule {
  public active = false;
  private wait: number;

  constructor(private random: () => number = Math.random) {
    this.wait = 60 + random() * 120;
  }

  start() { this.active = true; }
  finish() { this.active = false; this.wait = 60 + this.random() * 120; }

  step(seconds: number, enabled: boolean): boolean {
    if (!enabled || this.active) return false;
    this.wait -= Math.min(0.25, Math.max(0, seconds));
    if (this.wait > 0) return false;
    this.active = true;
    return true;
  }
}
