// Menolak hasil pembacaan volume lama setelah pengguna mengedit slider atau berganti sumber.
export class DeviceVolumeSync {
  private revision = 0;
  private reading = 0;
  private lastRead = -Infinity;
  private writing = 0;

  invalidate() { this.revision++; }
  beginWrite() { this.invalidate(); this.writing++; }
  endWrite() { this.writing--; }

  async refresh(
    read: () => Promise<number>,
    apply: (value: number) => void,
    failed: () => void,
    now: number,
    force = false,
  ) {
    if (!force && (this.reading || this.writing > 0 || now - this.lastRead < 1000)) return;
    const revision = this.revision;
    this.lastRead = now;
    this.reading++;
    try {
      const value = await read();
      if (revision === this.revision) apply(value);
    } catch {
      if (revision === this.revision) failed();
    } finally {
      this.reading--;
    }
  }
}
