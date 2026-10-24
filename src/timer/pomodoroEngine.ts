import {
  PlanPhase,
  PomodoroPlan,
  PomodoroConfig,
  TimerStatus,
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
      const now = Date.now();
      const remaining = Math.max(
        0,
        Math.ceil((this.targetEndTime - now) / 1000)
      );
      this.targetEndTime = null;

      if (remaining <= 0) {
        this.handlePhaseEnd();
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
      this.handlePhaseEnd();
    }
  }

  private handlePhaseEnd() {
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
        this.status = 'running';
        this.targetEndTime = Date.now() + this.phaseRemainingSeconds * 1000;
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
