export class ArtworkRetry {
  private identity = '';
  private inFlight = false;
  private ready = false;
  private attempts = 0;
  private nextAttemptAt = 0;
  private hadThumbnail = false;

  constructor(private now: () => number = Date.now) {}

  public begin(identity: string, hasThumbnail: boolean): boolean {
    if (identity !== this.identity) {
      this.reset();
      this.identity = identity;
    }
    const thumbnailArrived = hasThumbnail && !this.hadThumbnail;
    this.hadThumbnail = hasThumbnail;
    if (this.ready || this.inFlight || (!thumbnailArrived && this.now() < this.nextAttemptAt)) return false;
    this.inFlight = true;
    return true;
  }

  public finish(identity: string, success: boolean): void {
    if (identity !== this.identity) return;
    this.inFlight = false;
    this.ready = success;
    if (!success) {
      this.attempts++;
      this.nextAttemptAt = this.now() + Math.min(30_000, 1000 * 2 ** Math.min(this.attempts - 1, 5));
    }
  }

  public reset(): void {
    this.identity = '';
    this.inFlight = false;
    this.ready = false;
    this.attempts = 0;
    this.nextAttemptAt = 0;
    this.hadThumbnail = false;
  }
}
