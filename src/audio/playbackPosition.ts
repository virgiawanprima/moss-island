export function advancePlayback(position: number, elapsed: number, correction: number, rate: number = 1) {
  const adjustment = Math.max(-elapsed * 0.25, Math.min(elapsed * 0.25, correction));
  return { position: position + elapsed * rate + adjustment, correction: correction - adjustment };
}

export function reconcilePlayback(position: number, reported: number, playing: boolean) {
  const difference = reported - position;
  // Seek besar diterapkan langsung; jitter browser dikoreksi lewat laju ticker.
  return !playing || Math.abs(difference) > 2
    ? { position: reported, correction: 0 }
    : { position, correction: difference };
}
