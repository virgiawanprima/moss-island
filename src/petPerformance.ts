export type PetAction = 'idle' | 'dance' | 'wave' | 'celebrate';
export class PetPerformance {
  private clock = 0;
  private due = 8;
  private until = 0;
  private started = 0;
  private turn = 0;
  private action: PetAction = 'idle';
  constructor(private random: () => number = Math.random) { this.due = 8 + random() * 8; }
  step(seconds: number, input: { visible: boolean; music: boolean; walking: boolean; blocked: boolean; reduced: boolean }) {
    const dt = Number.isFinite(seconds) ? Math.max(0, Math.min(.25, seconds)) : 0;
    if (!input.visible || !input.music || input.reduced || input.blocked) {
      this.action = 'idle'; this.until = 0; this.due = this.clock + 8 + this.random() * 8;
      return { action: this.action, frame: 0 };
    }
    this.clock += dt;
    if (input.walking) {
      this.action = 'idle'; this.until = 0; this.due = Math.max(this.due, this.clock + 2);
    } else if (this.action !== 'idle' && this.clock >= this.until) {
      this.action = 'idle'; this.due = this.clock + 16 + this.random() * 14;
    } else if (this.action === 'idle' && this.clock >= this.due) {
      const actions: PetAction[] = ['dance', 'wave', 'dance', 'celebrate'];
      this.action = actions[this.turn++ % actions.length]; this.started = this.clock;
      this.until = this.clock + 2 + this.random();
    }
    return { action: this.action, frame: this.action === 'idle' ? 0 : Math.floor((this.clock - this.started) * 8) % 8 };
  }
}
