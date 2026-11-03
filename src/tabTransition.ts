export class TabTransition<T extends string> {
  private desired: T;
  private running: Promise<void> | null = null;

  constructor(
    private current: T,
    private readonly apply: (target: T) => Promise<void>,
  ) {
    this.desired = current;
  }

  request(target: T): Promise<void> {
    this.desired = target;
    if (!this.running && this.current === target) return Promise.resolve();
    if (!this.running) {
      this.running = this.drain().finally(() => { this.running = null; });
    }
    return this.running;
  }

  private async drain(): Promise<void> {
    // Resize native harus selesai sebelum target terbaru diterapkan.
    while (this.current !== this.desired) {
      const target = this.desired;
      await this.apply(target);
      this.current = target;
    }
  }
}
