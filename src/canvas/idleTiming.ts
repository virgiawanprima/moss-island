const IDLE_GAPS = [6200, 9100, 7400, 10800, 8300];
const FRAME_MS = 65;
const BLINK_MS = 7 * FRAME_MS;
const CYCLE_MS = IDLE_GAPS.reduce((total, gap) => total + gap + BLINK_MS, 0);

// Variasi jeda tetap stabil antar-frame; bentuk delapan frame asli tetap dipakai.
export function idleFrameAt(time: number): number {
  if (!Number.isFinite(time) || time <= 0) return 0;
  let phase = time % CYCLE_MS;
  for (const gap of IDLE_GAPS) {
    if (phase < gap) return 0;
    phase -= gap;
    if (phase < BLINK_MS) return 1 + Math.floor(phase / FRAME_MS);
    phase -= BLINK_MS;
  }
  return 0;
}
