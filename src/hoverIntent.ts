import type { IslandState } from './types';

export class HoverIntent {
  private enteredAt: number | null = null;
  private leftAt: number | null = null;

  public update(inside: boolean, enabled: boolean, blocked: boolean, state: IslandState, now: number): 'expand' | 'collapse' | null {
    if (!enabled || blocked || state === 'hidden') {
      this.reset();
      return null;
    }
    if (inside) {
      this.leftAt = null;
      if (state === 'compact') {
        this.enteredAt ??= now;
        if (now - this.enteredAt >= 150) { this.reset(); return 'expand'; }
      } else this.enteredAt = null;
    } else {
      this.enteredAt = null;
      if (state === 'expanded') {
        this.leftAt ??= now;
        if (now - this.leftAt >= 400) { this.reset(); return 'collapse'; }
      } else this.leftAt = null;
    }
    return null;
  }

  public reset(): void { this.enteredAt = null; this.leftAt = null; }
}
