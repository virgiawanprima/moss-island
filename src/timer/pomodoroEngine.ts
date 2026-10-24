import {
  PlanPhase,
  PomodoroPlan,
  PomodoroConfig,
  TimerStatus,
  TimerSnapshot,
} from '../types';
import { buildPomodoroPlan, DEFAULT_POMODORO_CONFIG } from './pomodoroPlan';

export interface PomodoroEngineCallbacks {
  onTick?: (
    remainingSeconds: number,
    phaseTotalSeconds: number,
    currentPhase: PlanPhase,
    totalProgressFraction: number
  ) => void;
  onPhaseComplete?: (
    completedPhase: PlanPhase,
    nextPhase: PlanPhase | null,
    isSkipped?: boolean
  ) => void;
  onPlanComplete?: (plan: PomodoroPlan) => void;
  onStatusChange?: (status: TimerStatus) => void;
}

export class PomodoroEngine {
  private config: PomodoroConfig;
  private plan: PomodoroPlan;
  private currentPhaseIndex: number = 0;
  private status: TimerStatus = 'idle';

  private phaseRemainingSeconds: number = 0;
  private phaseTotalSeconds: number = 0;
  private targetEndTime: number | null = null;
  private intervalId: number | null = null;

  private callbacks: PomodoroEngineCallbacks = {};

  constructor(
    config: PomodoroConfig = DEFAULT_POMODORO_CONFIG,
    callbacks: PomodoroEngineCallbacks = {}
  ) {
    this.config = { ...config };
    this.callbacks = { ...callbacks };
    this.plan = buildPomodoroPlan(
      this.config.totalDurationMin,
      this.config.focusDurationMin,
      this.config.breakDurationMin
    );
    this.initPhase(0);
  }

  public setCallbacks(callbacks: PomodoroEngineCallbacks) {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  public updateConfig(newConfig: PomodoroConfig) {
    this.config = { ...newConfig };
    if (this.status === 'idle' || this.status === 'completed') {
      this.rebuildPlan();
    }
  }

  public rebuildPlan() {
    this.stopInterval();
    this.plan = buildPomodoroPlan(
      this.config.totalDurationMin,
      this.config.focusDurationMin,
      this.config.breakDurationMin
    );
    this.currentPhaseIndex = 0;
    this.status = 'idle';
    this.initPhase(0);
    this.notifyStatusChange();
    this.notifyTick();
  }

  private initPhase(index: number) {
    if (index >= 0 && index < this.plan.phases.length) {
      this.currentPhaseIndex = index;
      const phase = this.plan.phases[index];
      this.phaseTotalSeconds = phase.durationMin * 60;
      this.phaseRemainingSeconds = this.phaseTotalSeconds;
      this.targetEndTime = null;
    }
  }

  public start() {
    if (this.status === 'running') return;

    if (this.status === 'completed') {
      this.rebuildPlan();
    }

    if (this.phaseRemainingSeconds <= 0) {
      this.handlePhaseEnd();
      if ((this.status as TimerStatus) === 'running' || (this.status as TimerStatus) === 'completed') {
        return;
      }
    }

    this.status = 'running';
    this.targetEndTime = Date.now() + this.phaseRemainingSeconds * 1000;
    this.notifyStatusChange();
    this.notifyTick();

    this.startInterval();
  }

  public pause() {
    if (this.status !== 'running') return;

    this.stopInterval();
    if (this.targetEndTime !== null) {
      const missedDeadline = this.targetEndTime;
      const now = Date.now();
      const remaining = Math.max(
        0,
        Math.ceil((missedDeadline - now) / 1000)
      );
      this.targetEndTime = null;

      if (remaining <= 0) {
        // Jeda terjadi tepat saat batas waktu: fase diselesaikan dari deadline lama
        this.handlePhaseEnd(missedDeadline);
        return;
      }

      this.phaseRemainingSeconds = remaining;
    }
    this.status = 'paused';
    this.notifyStatusChange();
    this.notifyTick();
  }

  public toggle(): TimerStatus {
    if (this.status === 'running') {
      this.pause();
    } else {
      this.start();
    }
    return this.status;
  }

  public reset() {
    this.stopInterval();
    this.currentPhaseIndex = 0;
    this.status = 'idle';
    this.initPhase(0);
    this.notifyStatusChange();
    this.notifyTick();
  }

  public skipCurrentPhase() {
    // Penjagaan status: rencana yang sudah selesai tidak boleh
    // memicu penyelesaian berulang
    if (this.status === 'completed') return;

    this.stopInterval();
    const completedPhase = this.getCurrentPhase();
    if (!completedPhase) return;

    const nextIndex = this.currentPhaseIndex + 1;
    if (nextIndex < this.plan.phases.length) {
      const nextPhase = this.plan.phases[nextIndex];
      this.initPhase(nextIndex);
      this.status = 'waiting_next';
      this.notifyStatusChange();
      this.notifyTick();
      if (this.callbacks.onPhaseComplete) {
        this.callbacks.onPhaseComplete(completedPhase, nextPhase, true);
      }
    } else {
      this.status = 'completed';
      this.phaseRemainingSeconds = 0;
      this.notifyStatusChange();
      this.notifyTick();
      if (this.callbacks.onPhaseComplete) {
        this.callbacks.onPhaseComplete(completedPhase, null, true);
      }
      if (this.callbacks.onPlanComplete) {
        this.callbacks.onPlanComplete(this.plan);
      }
    }
  }

  private startInterval() {
    this.stopInterval();
    this.intervalId = window.setInterval(() => {
      this.tick();
    }, 200);
  }

  private stopInterval() {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private tick() {
    if (this.status !== 'running' || this.targetEndTime === null) return;

    const now = Date.now();
    const remaining = Math.max(
      0,
      Math.ceil((this.targetEndTime - now) / 1000)
    );

    if (remaining !== this.phaseRemainingSeconds) {
      this.phaseRemainingSeconds = remaining;
      this.notifyTick();
    }

    if (remaining <= 0) {
      // Deadline lama diteruskan agar fase yang terlewat (mis. laptop tidur)
      // diproses sesuai waktu sebenarnya, bukan diulang dari sekarang
      this.handlePhaseEnd(this.targetEndTime);
    }
  }

  /**
   * Kebijakan waktu saat fase berakhir terlambat (laptop tidur / proses tertahan):
   * waktu tetap dihitung. Fase berikutnya dijadwalkan dari deadline fase
   * sebelumnya, dan fase yang sudah terlewat penuh diselesaikan berantai dengan
   * event yang benar. Bila fase berikutnya tidak di-autostart, mesin menunggu
   * aksi pengguna (waiting_next) dan waktu yang terlewat tidak dihitung.
   */
  private handlePhaseEnd(previousDeadline: number | null = null) {
    this.stopInterval();
    this.phaseRemainingSeconds = 0;
    this.targetEndTime = null;

    const completedPhase = this.getCurrentPhase();
    if (!completedPhase) return;

    const nextIndex = this.currentPhaseIndex + 1;
    const hasNext = nextIndex < this.plan.phases.length;

    if (hasNext) {
      const nextPhase = this.plan.phases[nextIndex];
      this.initPhase(nextIndex);

      if (this.callbacks.onPhaseComplete) {
        this.callbacks.onPhaseComplete(completedPhase, nextPhase, false);
      }

      // Periksa preferensi autostart independen
      let shouldAutostart = false;
      if (nextPhase.type === 'break' && this.config.autostartBreak) {
        shouldAutostart = true;
      } else if (nextPhase.type === 'focus' && this.config.autostartNextFocus) {
        shouldAutostart = true;
      }

      if (shouldAutostart) {
        const scheduledStart = previousDeadline !== null ? previousDeadline : Date.now();
        const elapsedMs = Math.max(0, Date.now() - scheduledStart);

        if (elapsedMs >= this.phaseTotalSeconds * 1000) {
          // Fase berikutnya juga sudah terlewat penuh: selesaikan berantai
          this.status = 'running';
          this.targetEndTime = scheduledStart + this.phaseTotalSeconds * 1000;
          this.handlePhaseEnd(this.targetEndTime);
          return;
        }

        this.status = 'running';
        this.targetEndTime = scheduledStart + this.phaseRemainingSeconds * 1000;
        // Sisa waktu dihitung ulang dari deadline (bukan dari durasi penuh fase)
        // agar keterlambatan sejak deadline terhitung pada tampilan
        this.phaseRemainingSeconds = Math.max(
          0,
          Math.ceil((this.targetEndTime - Date.now()) / 1000)
        );
        this.notifyStatusChange();
        this.notifyTick();
        this.startInterval();
      } else {
        this.status = 'waiting_next';
        this.notifyStatusChange();
        this.notifyTick();
      }
    } else {
      // Seluruh sesi dalam rencana telah selesai
      this.status = 'completed';
      this.notifyStatusChange();
      this.notifyTick();

      if (this.callbacks.onPhaseComplete) {
        this.callbacks.onPhaseComplete(completedPhase, null, false);
      }
      if (this.callbacks.onPlanComplete) {
        this.callbacks.onPlanComplete(this.plan);
      }
    }
  }

  public notifyTick() {
    const phase = this.getCurrentPhase();
    if (!phase) return;

    const totalProgressFraction = this.getTotalProgressFraction();
    if (this.callbacks.onTick) {
      this.callbacks.onTick(
        this.phaseRemainingSeconds,
        this.phaseTotalSeconds,
        phase,
        totalProgressFraction
      );
    }
  }

  private notifyStatusChange() {
    if (this.callbacks.onStatusChange) {
      this.callbacks.onStatusChange(this.status);
    }
  }

  public getStatus(): TimerStatus {
    return this.status;
  }

  public getPlan(): PomodoroPlan {
    return this.plan;
  }

  public getConfig(): PomodoroConfig {
    return { ...this.config };
  }

  public getCurrentPhase(): PlanPhase | null {
    if (
      this.currentPhaseIndex >= 0 &&
      this.currentPhaseIndex < this.plan.phases.length
    ) {
      return this.plan.phases[this.currentPhaseIndex];
    }
    return null;
  }

  public getCurrentPhaseIndex(): number {
    return this.currentPhaseIndex;
  }

  public getPhaseRemainingSeconds(): number {
    return this.phaseRemainingSeconds;
  }

  public getPhaseTotalSeconds(): number {
    return this.phaseTotalSeconds;
  }

  public getFormattedTime(): string {
    const mins = Math.floor(this.phaseRemainingSeconds / 60);
    const secs = this.phaseRemainingSeconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  public getPhaseProgressFraction(): number {
    if (this.phaseTotalSeconds <= 0) return 0;
    return Math.max(
      0,
      Math.min(1, 1 - this.phaseRemainingSeconds / this.phaseTotalSeconds)
    );
  }

  // ==========================================================================
  // SNAPSHOT UNTUK PEMULIHAN SESI (aplikasi ditutup / crash / restart komputer)
  // ==========================================================================
  public getSnapshot(): TimerSnapshot | null {
    if (this.status !== 'running' && this.status !== 'paused') return null;
    if (this.phaseRemainingSeconds <= 0) return null;

    const remaining =
      this.status === 'running' && this.targetEndTime !== null
        ? Math.max(0, Math.ceil((this.targetEndTime - Date.now()) / 1000))
        : this.phaseRemainingSeconds;
    if (remaining <= 0) return null;

    return {
      phaseIndex: this.currentPhaseIndex,
      status: this.status,
      phaseRemainingSeconds: remaining,
      targetEndTime: this.targetEndTime,
      savedAt: Date.now(),
      totalDurationMin: this.config.totalDurationMin,
      focusDurationMin: this.config.focusDurationMin,
      breakDurationMin: this.config.breakDurationMin,
    };
  }

  /**
   * Memulihkan mesin dari snapshot. Kebijakan waktu konsisten dengan kebijakan
   * tidur: fase berjalan dilanjutkan dari deadline tersimpan; bila deadline
   * sudah terlewat, fase yang terlewat diselesaikan berantai.
   * Mengembalikan false (tanpa mengubah state) bila snapshot tidak cocok
   * dengan rencana aktif.
   */
  public restoreFromSnapshot(snapshot: TimerSnapshot): boolean {
    if (!snapshot || typeof snapshot !== 'object') return false;
    if (snapshot.status !== 'running' && snapshot.status !== 'paused') return false;
    if (
      !Number.isInteger(snapshot.phaseIndex) ||
      snapshot.phaseIndex < 0 ||
      snapshot.phaseIndex >= this.plan.phases.length
    ) {
      return false;
    }
    if (
      snapshot.totalDurationMin !== this.config.totalDurationMin ||
      snapshot.focusDurationMin !== this.config.focusDurationMin ||
      snapshot.breakDurationMin !== this.config.breakDurationMin
    ) {
      return false;
    }

    const phase = this.plan.phases[snapshot.phaseIndex];
    const maxRemaining = phase.durationMin * 60;
    const storedRemaining =
      typeof snapshot.phaseRemainingSeconds === 'number' && snapshot.phaseRemainingSeconds > 0
        ? Math.min(Math.floor(snapshot.phaseRemainingSeconds), maxRemaining)
        : 0;

    this.stopInterval();
    this.currentPhaseIndex = snapshot.phaseIndex;
    this.phaseTotalSeconds = maxRemaining;
    this.phaseRemainingSeconds = storedRemaining;

    if (snapshot.status === 'paused' && storedRemaining > 0) {
      this.status = 'paused';
      this.targetEndTime = null;
      this.notifyStatusChange();
      this.notifyTick();
      return true;
    }

    this.status = 'running';
    // Kebijakan konsisten dengan tidur: deadline tersimpan dipercaya. Bila
    // sudah terlewat saat aplikasi tertutup, fase yang terlewat diselesaikan
    // berantai (waktu tetap dihitung selama aplikasi tidak berjalan).
    this.targetEndTime =
      snapshot.targetEndTime !== null && snapshot.targetEndTime > 0
        ? snapshot.targetEndTime
        : Date.now() + storedRemaining * 1000;

    const remainingNow = Math.ceil((this.targetEndTime - Date.now()) / 1000);
    if (remainingNow > 0) {
      this.phaseRemainingSeconds = remainingNow;
      this.notifyStatusChange();
      this.notifyTick();
      this.startInterval();
      return true;
    }

    // Deadline sudah terlewat: proses fase yang terlewat secara berantai
    this.handlePhaseEnd(this.targetEndTime);
    return true;
  }

  public getTotalProgressFraction(): number {
    const totalPlanSeconds = this.plan.totalDurationMin * 60;
    if (totalPlanSeconds <= 0) return 0;

    let elapsedSeconds = 0;
    for (let i = 0; i < this.currentPhaseIndex; i++) {
      elapsedSeconds += this.plan.phases[i].durationMin * 60;
    }
    elapsedSeconds += Math.max(
      0,
      this.phaseTotalSeconds - this.phaseRemainingSeconds
    );

    return Math.max(0, Math.min(1, elapsedSeconds / totalPlanSeconds));
  }
}
