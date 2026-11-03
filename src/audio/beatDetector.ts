/** Deteksi onset energi rendah, bukan estimasi BPM atau identitas lagu. */
export class BeatDetector {
  private baseline = 0;
  private previous = 0;
  private lastBeat = -Infinity;

  reset() {
    this.baseline = 0;
    this.previous = 0;
    this.lastBeat = -Infinity;
  }

  update(bins: Uint8Array, nowMs: number): boolean {
    if (!bins.length || !Number.isFinite(nowMs)) return false;
    let sum = 0;
    for (const value of bins) sum += value;
    const energy = sum / bins.length / 255;
    const reference = this.baseline;
    this.baseline = reference * 0.92 + energy * 0.08;
    const beat = energy > 0.12 && energy > reference * 1.35 + 0.025
      && energy - this.previous > 0.025 && nowMs - this.lastBeat >= 280;
    this.previous = energy;
    if (beat) this.lastBeat = nowMs;
    return beat;
  }
}
