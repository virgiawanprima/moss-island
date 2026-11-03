import type { PomodoroConfig } from './types';
import { validatePomodoroInput } from './timer/pomodoroPlan';

export function parseSettingsDuration(values: { hours: string; minutes: string; focus?: string; rest?: string }) {
  const fields = [
    ['hours', 'Jam', 0, 24], ['minutes', 'Menit', 0, 59],
  ] as const;
  for (const [field, label, min, max] of fields) {
    const value = values[field].trim();
    const number = Number(value);
    if (!value || !Number.isInteger(number) || number < min || number > max) {
      return { valid: false as const, field, message: `${label} harus bilangan bulat ${min}–${max}.` };
    }
  }
  const total = Number(values.hours) * 60 + Number(values.minutes);
  const focus = 25;
  const rest = 5;
  const validation = validatePomodoroInput(total, focus, rest);
  if (!validation.isValid) return { valid: false as const, field: 'hours' as const, message: validation.errorMessage! };
  return { valid: true as const, total, focus, rest };
}

export function hasScheduleChanged(previous: PomodoroConfig, next: PomodoroConfig): boolean {
  return previous.focusTargetMin !== next.focusTargetMin
    || previous.totalDurationMin !== next.totalDurationMin
    || previous.focusDurationMin !== next.focusDurationMin
    || previous.breakDurationMin !== next.breakDurationMin;
}
