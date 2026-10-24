import { PlanPhase, PomodoroPlan, PomodoroConfig } from '../types';

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
      const dur = Math.min(remaining, breakDur);
      if (dur <= 0) break;
      const isShortened = dur < breakDur;
      phases.push({
        id: phases.length + 1,
        type: 'break',
        durationMin: dur,
        isShortened,
        label: `Istirahat ${breakCount}${isShortened ? ' (disesuaikan)' : ''}`,
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

export const DEFAULT_POMODORO_CONFIG: PomodoroConfig = {
  totalDurationMin: 240, // 4 jam
  focusDurationMin: 30,  // 30 menit
  breakDurationMin: 10,  // 10 menit
  autostartBreak: true,
  autostartNextFocus: true,
  soundEnabled: true,
  volume: 0.8,
  alwaysOnTop: true,
  targetDailySessions: 6,
  dailyWaterTargetMl: 2000,
  hydrationReminderIntervalMin: 45,
  seasonMode: 'cycle',
};
