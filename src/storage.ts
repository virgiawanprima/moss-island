import {
  PomodoroConfig,
  IslandProgress,
  PlantedTree,
  StoredAppState,
  TimerSnapshot,
  TREE_SPECIES,
  TreeSpecies,
} from './types';
import { DEFAULT_POMODORO_CONFIG, buildPomodoroPlan, buildFocusTargetPlan } from './timer/pomodoroPlan';
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
      completedSessionsToday: 0,
      currentStreakDays: 1,
      trees: [],
      currentSeason: 'spring',
      seasonCycleCount: 0,
    },
    lastActiveDate: today,
    timerSession: null,
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

  const focusTargetMin = typeof raw.focusTargetMin === 'number' && Number.isInteger(raw.focusTargetMin) && raw.focusTargetMin >= 1 && raw.focusTargetMin <= 1440
    ? raw.focusTargetMin : buildPomodoroPlan(total, focus, brk).totalFocusMin;
  const fixedPlan = buildFocusTargetPlan(focusTargetMin);
  return {
    focusTargetMin,
    hoverEnabled: typeof raw.hoverEnabled === 'boolean' ? raw.hoverEnabled : false,
    momoIntensity: raw.momoIntensity === 'calm' ? 'calm' : 'expressive',
    totalDurationMin: fixedPlan.totalDurationMin,
    focusDurationMin: 25,
    breakDurationMin: 5,
    autostartBreak,
    autostartNextFocus,
    soundEnabled,
    volume,
    alwaysOnTop,
    targetDailySessions,
    seasonMode,
  };
}

/**
 * Memvalidasi satu entri pohon secara individual.
 * Mengembalikan null bila entri tidak valid sehingga hanya bagian yang rusak
 * yang dibuang, tanpa menghilangkan seluruh progres pengguna.
 */
function sanitizeTreeEntry(raw: unknown, index: number): PlantedTree | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Record<string, unknown>;
  const id = typeof t.id === 'string' && t.id.trim().length > 0 ? t.id.trim() : null;
  const gridR =
    typeof t.gridR === 'number' && Number.isInteger(t.gridR) && t.gridR >= 0 && t.gridR <= 5
      ? t.gridR
      : null;
  const gridC =
    typeof t.gridC === 'number' && Number.isInteger(t.gridC) && t.gridC >= 0 && t.gridC <= 5
      ? t.gridC
      : null;
  const treeType = TREE_SPECIES.includes(t.treeType as TreeSpecies)
    ? t.treeType as TreeSpecies
    : t.treeType === 'oak' || t.treeType === 'pine' ? TREE_SPECIES[index % TREE_SPECIES.length] : null;
  const plantedAt =
    typeof t.plantedAtTimestamp === 'number' &&
    Number.isFinite(t.plantedAtTimestamp) &&
    t.plantedAtTimestamp > 0
      ? t.plantedAtTimestamp
      : null;

  if (id === null || gridR === null || gridC === null || treeType === null || plantedAt === null) {
    console.warn(`Entri pohon #${index} tidak valid dan dilewati saat memuat progres.`);
    return null;
  }
  return { id, gridR, gridC, treeType, plantedAtTimestamp: plantedAt };
}

/** Batasi penghitung ke bilangan bulat non-negatif dengan batas atas wajar. */
function sanitizeCounter(value: unknown, fallback: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(max, Math.floor(value)));
}

export function sanitizeTimerSnapshot(raw: unknown): TimerSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const snap = raw as Record<string, unknown>;
  if (snap.scheduleVersion !== 3 && snap.scheduleVersion !== 2 && (snap.scheduleVersion !== undefined || (typeof snap.phaseIndex === 'number' && snap.phaseIndex >= 7))) return null;
  if (snap.status !== 'running' && snap.status !== 'paused' && snap.status !== 'waiting_next') return null;
  if (typeof snap.phaseIndex !== 'number' || !Number.isInteger(snap.phaseIndex) || snap.phaseIndex < 0) return null;
  if (typeof snap.phaseRemainingSeconds !== 'number' || !Number.isFinite(snap.phaseRemainingSeconds) || snap.phaseRemainingSeconds < 0 || snap.phaseRemainingSeconds > 86400) return null;
  if (snap.targetEndTime !== null && (typeof snap.targetEndTime !== 'number' || !Number.isFinite(snap.targetEndTime))) return null;
  if (typeof snap.savedAt !== 'number' || !Number.isFinite(snap.savedAt) || snap.savedAt <= 0) return null;
  const numsOk = ['totalDurationMin', 'focusDurationMin', 'breakDurationMin'].every((k) => {
    const v = snap[k];
    return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 2880;
  });
  if (!numsOk) return null;
  try {
    const plan = snap.scheduleVersion === 3 ? buildFocusTargetPlan(snap.focusTargetMin as number)
      : buildPomodoroPlan(snap.totalDurationMin as number, snap.focusDurationMin as number, snap.breakDurationMin as number);
    if (snap.scheduleVersion === 3 && (plan.totalDurationMin !== snap.totalDurationMin || snap.focusDurationMin !== 25 || snap.breakDurationMin !== 5)) return null;
    if (snap.phaseIndex >= plan.phases.length) return null;
    if (snap.status !== 'running' && snap.phaseRemainingSeconds <= 0) return null;
  } catch {
    return null;
  }
  return {
    scheduleVersion: snap.scheduleVersion as number | undefined,
    focusTargetMin: snap.scheduleVersion === 3 ? snap.focusTargetMin as number : undefined,
    phaseIndex: snap.phaseIndex,
    status: snap.status,
    phaseRemainingSeconds: snap.phaseRemainingSeconds,
    targetEndTime: snap.targetEndTime as number | null,
    savedAt: snap.savedAt,
    totalDurationMin: snap.totalDurationMin as number,
    focusDurationMin: snap.focusDurationMin as number,
    breakDurationMin: snap.breakDurationMin as number,
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
    // Validasi per entri: pohon yang rusak dibuang, pohon yang sah tetap dipertahankan
    const rawTrees = Array.isArray(savedProgress.trees) ? savedProgress.trees : [];
    const savedTrees: PlantedTree[] = rawTrees
      .map((entry: unknown, index: number) => sanitizeTreeEntry(entry, index))
      .filter((tree: PlantedTree | null): tree is PlantedTree => tree !== null);

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
      growthStage: sanitizeCounter(savedProgress.growthStage, 0, 2),
      completedSessionsToday: sanitizeCounter(savedProgress.completedSessionsToday, 0, 999),
      currentStreakDays: Math.max(1, sanitizeCounter(savedProgress.currentStreakDays, 1, 9999)),
      trees: savedTrees,
      currentSeason,
      seasonCycleCount,
    };

    const lastActiveDate = typeof parsed.lastActiveDate === 'string' ? parsed.lastActiveDate : today;

    // Snapshot timer aktif: hanya dipakai bila strukturnya sah
    const timerSession: TimerSnapshot | null = sanitizeTimerSnapshot(parsed.timerSession);

    // Pemeriksaan pergantian hari: reset hitungan harian tetapi pertahankan pohon dan hitungan musim
    if (lastActiveDate === today) {
      // Hari yang sama, lanjutkan progres
    } else if (isYesterday(lastActiveDate)) {
      // Hari baru berturutan: lanjutkan streak, reset hitungan harian tetapi pertahankan pohon dan musim
      progress = {
        growthStage: progress.growthStage,
        completedSessionsToday: 0,
        currentStreakDays: progress.currentStreakDays + 1,
        trees: savedTrees,
        currentSeason,
        seasonCycleCount,
      };
    } else {
      // Terlewat lebih dari satu hari: reset streak menjadi 1, pertahankan pohon dan musim
      progress = {
        growthStage: 0,
        completedSessionsToday: 0,
        currentStreakDays: 1,
        trees: savedTrees,
        currentSeason,
        seasonCycleCount,
      };
    }

    const loadedState: StoredAppState = {
      version: 2,
      config,
      progress,
      lastActiveDate: today,
      timerSession,
    };

    saveAppState(loadedState);
    return loadedState;
  } catch (_e) {
    // Jika JSON rusak total, gunakan default yang aman
    saveAppState(defaultState);
    return defaultState;
  }
}

export function saveAppState(state: StoredAppState): boolean {
  try {
    const updatedState: StoredAppState = {
      ...state,
      version: 2,
      lastActiveDate: getTodayDateString(),
    };
    localStorage.setItem(STORAGE_KEY_APP_STATE, JSON.stringify(updatedState));
    return true;
  } catch (_e) {
    return false;
  }
}
