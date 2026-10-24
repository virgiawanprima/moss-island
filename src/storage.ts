import {
  PomodoroConfig,
  IslandProgress,
  StoredAppState,
} from './types';
import { DEFAULT_POMODORO_CONFIG } from './timer/pomodoroPlan';
export { DEFAULT_POMODORO_CONFIG };

const STORAGE_KEY_APP_STATE = 'moss_island_state_v2';

export function isTauri(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window || '__TAURI_METADATA__' in window)
  );
}

export function getTodayDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function isYesterday(dateStr: string): boolean {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const year = yesterday.getFullYear();
  const month = String(yesterday.getMonth() + 1).padStart(2, '0');
  const day = String(yesterday.getDate()).padStart(2, '0');
  return dateStr === `${year}-${month}-${day}`;
}

export function getDefaultAppState(): StoredAppState {
  const today = getTodayDateString();
  return {
    version: 2,
    config: { ...DEFAULT_POMODORO_CONFIG },
    progress: {
      growthStage: 0,
      hydrationGlasses: 0,
      completedSessionsToday: 0,
      currentStreakDays: 1,
      trees: [],
      currentSeason: 'spring',
      seasonCycleCount: 0,
    },
    waterMl: 0,
    lastActiveDate: today,
    nextHydrationReminderTimestamp: Date.now() + 45 * 60 * 1000,
  };
}

export function sanitizePomodoroConfig(rawConfig: unknown): PomodoroConfig {
  const base = { ...DEFAULT_POMODORO_CONFIG };
  if (!rawConfig || typeof rawConfig !== 'object') {
    return base;
  }

  const raw = rawConfig as Record<string, unknown>;

  const total =
    typeof raw.totalDurationMin === 'number' &&
    Number.isInteger(raw.totalDurationMin) &&
    raw.totalDurationMin >= 1 &&
    raw.totalDurationMin <= 1440
      ? raw.totalDurationMin
      : base.totalDurationMin;

  const focus =
    typeof raw.focusDurationMin === 'number' &&
    Number.isInteger(raw.focusDurationMin) &&
    raw.focusDurationMin >= 1 &&
    raw.focusDurationMin <= 180
      ? raw.focusDurationMin
      : base.focusDurationMin;

  const brk =
    typeof raw.breakDurationMin === 'number' &&
    Number.isInteger(raw.breakDurationMin) &&
    raw.breakDurationMin >= 1 &&
    raw.breakDurationMin <= 60
      ? raw.breakDurationMin
      : base.breakDurationMin;

  const waterTarget =
    typeof raw.dailyWaterTargetMl === 'number' &&
    Number.isInteger(raw.dailyWaterTargetMl) &&
    raw.dailyWaterTargetMl >= 100 &&
    raw.dailyWaterTargetMl <= 10000
      ? raw.dailyWaterTargetMl
      : base.dailyWaterTargetMl;

  const waterInterval =
    typeof raw.hydrationReminderIntervalMin === 'number' &&
    Number.isInteger(raw.hydrationReminderIntervalMin) &&
    raw.hydrationReminderIntervalMin >= 1 &&
    raw.hydrationReminderIntervalMin <= 360
      ? raw.hydrationReminderIntervalMin
      : base.hydrationReminderIntervalMin;

  const autostartBreak =
    typeof raw.autostartBreak === 'boolean' ? raw.autostartBreak : base.autostartBreak;

  const autostartNextFocus =
    typeof raw.autostartNextFocus === 'boolean' ? raw.autostartNextFocus : base.autostartNextFocus;

  const soundEnabled =
    typeof raw.soundEnabled === 'boolean' ? raw.soundEnabled : base.soundEnabled;

  const volume =
    typeof raw.volume === 'number' &&
    !Number.isNaN(raw.volume) &&
    raw.volume >= 0 &&
    raw.volume <= 1
      ? raw.volume
      : base.volume;

  const alwaysOnTop =
    typeof raw.alwaysOnTop === 'boolean' ? raw.alwaysOnTop : base.alwaysOnTop;

  const targetDailySessions =
    typeof raw.targetDailySessions === 'number' &&
    Number.isInteger(raw.targetDailySessions) &&
    raw.targetDailySessions >= 1
      ? raw.targetDailySessions
      : base.targetDailySessions;

  const seasonMode =
    raw.seasonMode === 'cycle' || raw.seasonMode === 'manual'
      ? raw.seasonMode
      : base.seasonMode;

  return {
    totalDurationMin: total,
    focusDurationMin: focus,
    breakDurationMin: brk,
    autostartBreak,
    autostartNextFocus,
    soundEnabled,
    volume,
    alwaysOnTop,
    targetDailySessions,
    dailyWaterTargetMl: waterTarget,
    hydrationReminderIntervalMin: waterInterval,
    seasonMode,
  };
}

export function loadAppState(): StoredAppState {
  const defaultState = getDefaultAppState();
  const today = getTodayDateString();

  try {
    const raw = localStorage.getItem(STORAGE_KEY_APP_STATE);
    if (!raw) {
      saveAppState(defaultState);
      return defaultState;
    }

    const parsed = JSON.parse(raw);

    // Penanganan pemulihan jika struktur data rusak
    if (!parsed || typeof parsed !== 'object') {
      saveAppState(defaultState);
      return defaultState;
    }

    const config: PomodoroConfig = sanitizePomodoroConfig(parsed.config);

    const savedProgress = parsed.progress && typeof parsed.progress === 'object' ? parsed.progress : {};
    const savedTrees = Array.isArray(savedProgress.trees) ? savedProgress.trees : [];

    const currentSeason =
      savedProgress.currentSeason === 'spring' ||
      savedProgress.currentSeason === 'summer' ||
      savedProgress.currentSeason === 'autumn' ||
      savedProgress.currentSeason === 'winter'
        ? savedProgress.currentSeason
        : 'spring';

    const seasonCycleCount =
      typeof savedProgress.seasonCycleCount === 'number' &&
      Number.isInteger(savedProgress.seasonCycleCount) &&
      savedProgress.seasonCycleCount >= 0
        ? savedProgress.seasonCycleCount % 6
        : 0;

    let progress: IslandProgress = {
      growthStage: typeof savedProgress.growthStage === 'number' ? savedProgress.growthStage : 0,
      hydrationGlasses: typeof savedProgress.hydrationGlasses === 'number' ? savedProgress.hydrationGlasses : 0,
      completedSessionsToday: typeof savedProgress.completedSessionsToday === 'number' ? savedProgress.completedSessionsToday : 0,
      currentStreakDays: typeof savedProgress.currentStreakDays === 'number' ? savedProgress.currentStreakDays : 1,
      trees: savedTrees,
      currentSeason,
      seasonCycleCount,
    };

    let waterMl = typeof parsed.waterMl === 'number' ? parsed.waterMl : progress.hydrationGlasses * 250;
    const lastActiveDate = typeof parsed.lastActiveDate === 'string' ? parsed.lastActiveDate : today;

    // Pemeriksaan pergantian hari: reset hitungan harian tetapi pertahankan pohon dan hitungan musim
    if (lastActiveDate === today) {
      // Hari yang sama, lanjutkan progres
    } else if (isYesterday(lastActiveDate)) {
      // Hari baru berturutan: lanjutkan streak, reset hitungan harian tetapi pertahankan pohon dan musim
      progress = {
        growthStage: progress.growthStage,
        hydrationGlasses: 0,
        completedSessionsToday: 0,
        currentStreakDays: progress.currentStreakDays + 1,
        trees: savedTrees,
        currentSeason,
        seasonCycleCount,
      };
      waterMl = 0;
    } else {
      // Terlewat lebih dari satu hari: reset streak menjadi 1, pertahankan pohon dan musim
      progress = {
        growthStage: 0,
        hydrationGlasses: 0,
        completedSessionsToday: 0,
        currentStreakDays: 1,
        trees: savedTrees,
        currentSeason,
        seasonCycleCount,
      };
      waterMl = 0;
    }

    const nextReminder =
      typeof parsed.nextHydrationReminderTimestamp === 'number' &&
      parsed.nextHydrationReminderTimestamp > Date.now()
        ? parsed.nextHydrationReminderTimestamp
        : Date.now() + (config.hydrationReminderIntervalMin || 45) * 60 * 1000;

    const loadedState: StoredAppState = {
      version: 2,
      config,
      progress,
      waterMl,
      lastActiveDate: today,
      nextHydrationReminderTimestamp: nextReminder,
    };

    saveAppState(loadedState);
    return loadedState;
  } catch (_e) {
    // Jika JSON rusak total, gunakan default yang aman
    saveAppState(defaultState);
    return defaultState;
  }
}

export function saveAppState(state: StoredAppState): void {
  try {
    const updatedState: StoredAppState = {
      ...state,
      version: 2,
      lastActiveDate: getTodayDateString(),
    };
    localStorage.setItem(STORAGE_KEY_APP_STATE, JSON.stringify(updatedState));
  } catch (_e) {
    // Abaikan jika storage browser dibatasi
  }
}
