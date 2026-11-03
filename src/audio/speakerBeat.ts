import { isTauri } from '../storage';

type SpeakerInvoke = <T = void>(command: string) => Promise<T>;
type SpeakerRuntime = { available: () => boolean; invoke: SpeakerInvoke; retryMs: number };
const defaultRuntime: SpeakerRuntime = {
  available: isTauri,
  invoke: async <T>(command: string) => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<T>(command);
  },
  retryMs: 3000,
};

export class SpeakerBeat {
  private wanted = false;
  private running = false;
  private revision = 0;
  private timer: number | null = null;
  private retry: number | null = null;
  private previous = 0;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly beat: () => void, private readonly status: (text: string) => void,
    private readonly runtime: SpeakerRuntime = defaultRuntime) {}

  private scheduleRetry(revision: number) {
    if (!this.wanted || revision !== this.revision || this.retry !== null) return;
    this.retry = window.setTimeout(() => {
      this.retry = null;
      if (this.wanted && revision === this.revision) this.start();
    }, this.runtime.retryMs);
  }

  setActive(active: boolean) {
    if (this.wanted === active) return;
    this.wanted = active;
    if (!active) this.status('Analisis output berhenti.');
    if (this.retry !== null) window.clearTimeout(this.retry);
    this.retry = null;
    this.start();
  }

  private start() {
    const revision = ++this.revision;
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.queue = this.queue.then(async () => {
      if (!this.runtime.available()) {
        if (this.wanted) this.status('Analisis output hanya tersedia di aplikasi desktop Windows.');
        return;
      }
      const invoke = this.runtime.invoke;
      if (this.running) {
        await invoke('stop_speaker_beat');
        this.running = false;
      }
      if (!this.wanted || revision !== this.revision) return;
      try {
        await invoke('start_speaker_beat');
        this.running = true;
        if (!this.wanted || revision !== this.revision) {
          await invoke('stop_speaker_beat');
          this.running = false;
          return;
        }
        this.previous = await invoke<number>('speaker_beat_count');
        if (!this.wanted || revision !== this.revision) {
          await invoke('stop_speaker_beat');
          this.running = false;
          return;
        }
        this.status('Analisis output aktif. Suara aplikasi lain dapat memengaruhi gerakan.');
        let reading = false;
        this.timer = window.setInterval(() => {
          if (reading) return;
          reading = true;
          void invoke<number>('speaker_beat_count').then(count => {
            if (revision === this.revision && this.wanted) {
              if (count > this.previous) this.beat();
              this.previous = count;
            }
          }).catch(() => {
            if (revision === this.revision) {
              if (this.timer !== null) window.clearInterval(this.timer);
              this.timer = null;
              this.status('Analisis output terputus. Mencoba kembali.');
              this.scheduleRetry(revision);
            }
          }).finally(() => { reading = false; });
        }, 80);
      } catch {
        if (revision === this.revision) {
          this.status('Analisis output tidak tersedia. Mencoba kembali.');
          this.scheduleRetry(revision);
        }
      }
    }).catch(() => {
      if (revision === this.revision) {
        this.status('Analisis output tidak tersedia. Mencoba kembali.');
        this.scheduleRetry(revision);
      }
    });
  }
}
