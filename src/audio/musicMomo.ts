export type MomoPlayback = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'disconnected';
export type MomoIntensity = 'calm' | 'expressive';
export type MomoPose = 'rest' | 'start' | 'nod' | 'sway' | 'tap' | 'step' | 'shoulder'
  | 'adjust' | 'stumble' | 'change' | 'settle' | 'listen' | 'finish' | 'wave' | 'shy' | 'proud';
export interface MomoFrame {
  playback: MomoPlayback;
  pose: MomoPose;
  eyes: 'open' | 'closed' | 'look';
  smile: boolean;
  active: boolean;
  reduced: boolean;
  intensity: MomoIntensity;
}
export interface MomoClock {
  later(callback: () => void, delay: number): number;
  cancel(id: number): void;
}

export class MusicMomo {
  private frame: MomoFrame = { playback: 'idle', pose: 'rest', eyes: 'open', smile: false,
    active: false, reduced: false, intensity: 'expressive' };
  private key = '';
  private generation = 0;
  private timers = new Set<number>();
  private disposed = false;
  private interaction = 0;
  private dance = 0;
  private pendingChange = false;

  constructor(
    private readonly render: (frame: Readonly<MomoFrame>) => void,
    private readonly clock: MomoClock = { later: (cb, ms) => window.setTimeout(cb, ms), cancel: (id) => window.clearTimeout(id) },
    private readonly random: () => number = Math.random,
  ) {}

  setPlayback(playback: MomoPlayback, key: string) {
    if (this.disposed || (playback === this.frame.playback && key === this.key)) return;
    const previous = this.frame.playback;
    const changed = !!this.key && key !== this.key;
    if (changed) this.pendingChange = previous === 'playing';
    if (playback !== 'playing' && playback !== 'loading') this.pendingChange = false;
    this.key = key;
    this.frame.playback = playback;
    const pose: MomoPose = playback === 'playing' ? this.pendingChange ? 'change' : previous === 'playing' ? 'nod' : 'start'
      : playback === 'loading' ? 'listen' : playback === 'ended' ? 'finish'
      : playback === 'paused' ? 'settle' : 'rest';
    this.restart(pose);
    if (playback === 'playing') this.pendingChange = false;
  }

  configure(active: boolean, reduced: boolean, intensity: MomoIntensity) {
    if (this.disposed || (active === this.frame.active && reduced === this.frame.reduced && intensity === this.frame.intensity)) return;
    this.frame.active = active;
    this.frame.reduced = reduced;
    this.frame.intensity = intensity;
    this.restart(this.basePose());
  }

  interact() {
    if (!this.frame.active || this.disposed) return;
    // Reaksi klik tidak mengganti status playback, dan tidak memotong adegan selesai.
    if (this.frame.pose === 'finish') return;
    const poses = ['wave', 'shy', 'proud'] as const;
    this.restart(poses[this.interaction++ % poses.length]);
  }

  dispose() {
    this.disposed = true;
    this.clear();
    this.frame.active = false;
    this.emit();
  }

  private clear() {
    this.generation++;
    for (const timer of this.timers) this.clock.cancel(timer);
    this.timers.clear();
  }

  private later(delay: number, action: () => void) {
    const generation = this.generation;
    const id = this.clock.later(() => {
      this.timers.delete(id);
      if (!this.disposed && this.frame.active && generation === this.generation) action();
    }, delay);
    this.timers.add(id);
  }

  private basePose(): MomoPose {
    return this.frame.playback === 'playing' ? 'nod' : this.frame.playback === 'loading' ? 'listen' : 'rest';
  }

  private restart(pose: MomoPose) {
    this.clear();
    this.frame.pose = this.frame.active ? pose : this.basePose();
    this.frame.eyes = 'open';
    this.frame.smile = this.frame.playback === 'ended' || ['start', 'finish', 'wave', 'shy', 'proud'].includes(pose);
    this.emit();
    if (!this.frame.active) return;
    this.blinkLater();
    if (['start', 'change', 'settle', 'finish', 'wave', 'shy', 'proud'].includes(pose)) {
      const duration = this.frame.reduced ? 180 : pose === 'finish' ? 2600 : pose === 'settle' ? 260 : 1300;
      this.later(duration, () => {
        this.frame.pose = this.basePose();
        this.frame.smile = this.frame.playback === 'ended';
        this.emit();
        this.activityLater();
      });
    } else this.activityLater();
  }

  private blinkLater() {
    this.later(2600 + this.random() * 4300, () => {
      this.frame.eyes = 'closed';
      this.emit();
      this.later(110, () => { this.frame.eyes = 'open'; this.emit(); this.blinkLater(); });
    });
  }

  private activityLater() {
    const playing = this.frame.playback === 'playing';
    const delay = playing ? 3200 + this.random() * 3700 : 9000 + this.random() * 7000;
    this.later(delay, () => {
      if (!playing || this.frame.reduced) {
        this.frame.eyes = 'look';
        this.emit();
        this.later(650, () => { this.frame.eyes = 'open'; this.emit(); this.activityLater(); });
        return;
      }
      const roll = this.random();
      const rare = this.frame.intensity === 'expressive' ? 0.07 : 0;
      const dances: MomoPose[] = this.frame.intensity === 'expressive'
        ? ['nod', 'tap', 'sway', 'shoulder', 'nod', 'step'] : ['nod', 'tap', 'sway', 'nod'];
      this.frame.pose = roll < rare ? 'stumble' : roll < rare + 0.1 ? 'adjust'
        : dances[(this.dance++ + Math.floor(this.random() * dances.length)) % dances.length]!;
      this.frame.smile = false;
      this.emit();
      if (this.frame.pose === 'stumble') {
        this.later(1000, () => { this.frame.smile = true; this.emit(); });
      }
      this.later(this.frame.pose === 'stumble' ? 1600 : 2100, () => {
        this.frame.pose = 'rest';
        this.frame.smile = false;
        this.emit();
        this.activityLater();
      });
    });
  }

  private emit() { this.render({ ...this.frame }); }
}
