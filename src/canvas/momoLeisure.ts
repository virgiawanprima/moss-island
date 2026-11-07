export type LeisureAction = 'dance' | 'run' | 'sleep' | 'sing' | 'relax' | 'eat';

export class MomoLeisure {
  public action: LeisureAction | null = null;
  private wait: number;
  private remaining = 0;
  private choices: LeisureAction[] = [];

  constructor(private random: () => number = Math.random) {
    this.wait = 10 + random() * 10;
  }

  step(seconds: number, enabled: boolean): void {
    if (!enabled) return;
    const dt = Math.min(0.25, Math.max(0, seconds));
    if (this.action) {
      this.remaining -= dt;
      if (this.remaining <= 0) {
        this.action = null;
        this.wait = 16 + this.random() * 16;
      }
      return;
    }
    this.wait -= dt;
    if (this.wait > 0) return;
    if (!this.choices.length) {
      this.choices = ['dance', 'run', 'sleep', 'sing', 'relax', 'eat'];
      for (let i = this.choices.length - 1; i > 0; i--) {
        const j = Math.floor(this.random() * (i + 1));
        [this.choices[i], this.choices[j]] = [this.choices[j], this.choices[i]];
      }
    }
    this.action = this.choices.pop()!;
    this.remaining = this.action === 'sleep' ? 10 + this.random() * 6 : 5 + this.random() * 4;
  }

  stop() {
    this.action = null;
    this.wait = 16 + this.random() * 16;
  }
}
