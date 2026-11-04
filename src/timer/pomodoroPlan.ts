import { PlanPhase, PomodoroPlan, PomodoroConfig } from '../types';

export const LONG_BREAK_MINUTES = 15;
export const FOCUS_SESSIONS_PER_SET = 4;

export function validatePomodoroInput(
  totalDurationMin: number,
  focusDurationMin: number,
  breakDurationMin: number
): { isValid: boolean; errorMessage?: string } {
  if (
    typeof totalDurationMin !== 'number' ||
    typeof focusDurationMin !== 'number' ||
    typeof breakDurationMin !== 'number' ||
    Number.isNaN(totalDurationMin) ||
    Number.isNaN(focusDurationMin) ||
    Number.isNaN(breakDurationMin)
  ) {
    return { isValid: false, errorMessage: 'Durasi harus berupa angka yang valid.' };
  }

  // Durasi harus bilangan bulat positif (menit)
  if (
    !Number.isInteger(totalDurationMin) ||
    !Number.isInteger(focusDurationMin) ||
    !Number.isInteger(breakDurationMin)
  ) {
    return { isValid: false, errorMessage: 'Durasi harus berupa bilangan bulat dalam menit.' };
  }

  if (totalDurationMin < 1 || focusDurationMin < 1 || breakDurationMin < 1) {
    return { isValid: false, errorMessage: 'Durasi minimal adalah 1 menit.' };
  }

  if (totalDurationMin > 1440) {
    return { isValid: false, errorMessage: 'Total durasi maksimal adalah 24 jam (1440 menit).' };
  }

  if (focusDurationMin > 180) {
    return { isValid: false, errorMessage: 'Durasi fokus maksimal adalah 180 menit.' };
  }

  if (breakDurationMin > 60) {
    return { isValid: false, errorMessage: 'Durasi istirahat maksimal adalah 60 menit.' };
  }

  return { isValid: true };
}

export function buildPomodoroPlan(
  totalDurationMin: number,
  focusDurationMin: number,
  breakDurationMin: number
): PomodoroPlan {
  const validation = validatePomodoroInput(totalDurationMin, focusDurationMin, breakDurationMin);
  if (!validation.isValid) {
    throw new Error(validation.errorMessage || 'Input perencanaan waktu tidak valid.');
  }

  const total = Math.round(totalDurationMin);
  const focus = Math.round(focusDurationMin);
  const breakDur = Math.round(breakDurationMin);

  const phases: PlanPhase[] = [];
  let remaining = total;
  let nextType: 'focus' | 'break' = 'focus';
  let focusCount = 1;
  let breakCount = 1;

  while (remaining > 0) {
    if (nextType === 'focus') {
      const dur = Math.min(remaining, focus);
      if (dur <= 0) break;
      const isShortened = dur < focus;
      phases.push({
        id: phases.length + 1,
        type: 'focus',
        durationMin: dur,
        isShortened,
        label: `Fokus ${focusCount}${isShortened ? ' (disesuaikan)' : ''}`,
      });
      remaining -= dur;
      focusCount++;
      nextType = 'break';
    } else {
      const isLongBreak = (focusCount - 1) % FOCUS_SESSIONS_PER_SET === 0;
      const plannedDuration = isLongBreak ? LONG_BREAK_MINUTES : breakDur;
      const dur = Math.min(remaining, plannedDuration);
      if (dur <= 0) break;
      const isShortened = dur < plannedDuration;
      phases.push({
        id: phases.length + 1,
        type: 'break',
        breakKind: isLongBreak ? 'long' : 'short',
        durationMin: dur,
        isShortened,
        label: `Istirahat${isLongBreak ? ' panjang' : ''} ${breakCount}${isShortened ? ' (disesuaikan)' : ''}`,
      });
      remaining -= dur;
      breakCount++;
      nextType = 'focus';
    }
  }

  const totalFocusMin = phases
    .filter((p) => p.type === 'focus')
    .reduce((sum, p) => sum + p.durationMin, 0);

  const totalBreakMin = phases
    .filter((p) => p.type === 'break')
    .reduce((sum, p) => sum + p.durationMin, 0);

  const focusSessionCount = phases.filter((p) => p.type === 'focus').length;

  return {
    totalDurationMin: total,
    focusDurationMin: focus,
    breakDurationMin: breakDur,
    totalFocusMin,
    totalBreakMin,
    focusSessionCount,
    phases,
  };
}

export function buildFocusTargetPlan(focusTargetMin: number): PomodoroPlan {
  const validation = validatePomodoroInput(focusTargetMin, 25, 5);
  if (!validation.isValid) throw new Error(validation.errorMessage);
  const phases: PlanPhase[] = [];
  let remaining = focusTargetMin;
  let session = 0;
  let totalBreakMin = 0;
  while (remaining > 0) {
    const durationMin = Math.min(25, remaining);
    session++;
    phases.push({ id: phases.length + 1, type: 'focus', durationMin,
      isShortened: durationMin < 25, label: `Fokus ${session}${durationMin < 25 ? ' (disesuaikan)' : ''}` });
    remaining -= durationMin;
    const long = session % FOCUS_SESSIONS_PER_SET === 0 && durationMin === 25;
    if (remaining > 0 || long) {
      const rest = long ? LONG_BREAK_MINUTES : 5;
      phases.push({ id: phases.length + 1, type: 'break', breakKind: long ? 'long' : 'short',
        durationMin: rest, isShortened: false, label: `Istirahat${long ? ' panjang' : ''} ${session}` });
      totalBreakMin += rest;
    }
  }
  return { totalDurationMin: focusTargetMin + totalBreakMin, totalFocusMin: focusTargetMin,
    totalBreakMin, focusSessionCount: session, focusDurationMin: 25, breakDurationMin: 5, phases };
}

export const DEFAULT_POMODORO_CONFIG: PomodoroConfig = {
  hoverEnabled: false,
  momoIntensity: 'expressive',
  totalDurationMin: 240,
  focusDurationMin: 25,
  breakDurationMin: 5,
  autostartBreak: true,
  autostartNextFocus: true,
  soundEnabled: true,
  volume: 0.8,
  alwaysOnTop: true,
  targetDailySessions: 6,
  seasonMode: 'cycle',
};

export function getFirstPhasePreview(plan: PomodoroPlan): string {
  const first = plan.phases[0];
  if (!first) return '';
  const label = first.type === 'focus' ? 'Fokus' : 'Istirahat';
  return `Putaran 1 · ${label} ${first.durationMin} menit · Menit 0–${first.durationMin}`;
}

export function getNextPhaseLabel(plan: PomodoroPlan, index: number, config: PomodoroConfig): string {
  const next = plan.phases[index + 1];
  if (!next) return 'Sesi terakhir · Rencana selesai setelah fase ini.';
  const label = next.type === 'focus' ? 'Fokus' : next.breakKind === 'long' ? 'Istirahat panjang' : 'Istirahat';
  const automatic = next.type === 'focus' ? config.autostartNextFocus : config.autostartBreak;
  return `Berikutnya: ${label} ${next.durationMin} menit · ${automatic ? 'otomatis' : 'mulai manual'}`;
}
