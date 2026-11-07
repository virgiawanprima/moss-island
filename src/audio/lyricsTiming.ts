export class LyricsTiming {
  private offsets: Record<string, number> = {};
  private readonly storageKey = 'moss_lyrics_offsets_v1';

  constructor() {
    try {
      const stored = JSON.parse(localStorage.getItem(this.storageKey) || '{}');
      if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
        for (const [key, value] of Object.entries(stored).slice(-100)) {
          if (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 10) this.offsets[key] = value;
        }
      }
    } catch { /* Pengaturan waktu tidak boleh menghalangi pemutaran. */ }
  }

  public get(key: string, fallback = 0): number { return this.offsets[key] ?? fallback; }

  public set(key: string, value: number): boolean {
    if (!Number.isFinite(value)) return false;
    const next = { ...this.offsets };
    delete next[key];
    next[key] = Math.round(Math.max(-10, Math.min(10, value)) * 2) / 2;
    const bounded = Object.fromEntries(Object.entries(next).slice(-100));
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(bounded));
      this.offsets = bounded;
      return true;
    } catch { return false; }
  }
}
