import type { LyricsLinesUpdate } from './lyricsService';

export class LyricsView {
  private animation: Animation | null = null;

  constructor(private render: (update: LyricsLinesUpdate) => void) {}

  update(update: LyricsLinesUpdate) {
    const track = document.querySelector<HTMLElement>('#lyrics-track');
    const viewport = document.querySelector<HTMLElement>('#lyrics-viewport');
    const next = document.querySelector<HTMLElement>('#music-card-line2');
    const current = document.querySelector<HTMLElement>('#music-card-highlight');
    const canSlide = update.transitionType === 'step' && !update.isInstrumental
      && current?.innerText === update.line1 && next?.innerText === update.highlight;
    // Ukur posisi visual sebelum mengganti isi; tinggi baris boleh berubah saat teks membungkus.
    const oldTop = next?.getBoundingClientRect().top;
    this.animation?.cancel();
    this.animation = null;
    this.render(update);
    if (!track || !viewport) return;
    if (viewport.closest('.is-local-music')) {
      viewport.scrollTop = 0;
      return;
    }
    if (viewport.closest('.is-plain-lyrics')) return;
    const active = track.querySelector<HTMLElement>('.row-active');
    if (!active) return;
    viewport.scrollTop = Math.max(0, active.offsetTop - Math.max(0, (viewport.clientHeight - active.offsetHeight) / 2));
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || update.isPlaying === false) return;

    if (canSlide && oldTop !== undefined && current) {
      const distance = oldTop - current.getBoundingClientRect().top;
      this.animation = track.animate([
        { transform: `translateY(${distance}px)` },
        { transform: 'translateY(0)' },
      ], { duration: 220, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
    } else if (update.transitionType === 'jump') {
      this.animation = track.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: 160 });
    }
  }
}
