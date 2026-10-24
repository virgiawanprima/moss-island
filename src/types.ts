export type IslandState = 'hidden' | 'compact' | 'expanded';

export type ActiveTab = 'focus' | 'hydration' | 'music' | 'settings';

export type PhaseType = 'focus' | 'break';

export interface PlanPhase {
  id: number;
  type: PhaseType;
  durationMin: number;
  isShortened: boolean;
  label: string;
}

export interface PomodoroPlan {
  totalDurationMin: number;
  focusDurationMin: number;
  breakDurationMin: number;
  totalFocusMin: number;
  totalBreakMin: number;
  focusSessionCount: number;
  phases: PlanPhase[];
}

export type TimerStatus = 'idle' | 'running' | 'paused' | 'waiting_next' | 'completed';

export type IslandSeason = 'spring' | 'summer' | 'autumn' | 'winter';
export type SeasonMode = 'cycle' | 'manual';

export interface PomodoroConfig {
  totalDurationMin: number;
  focusDurationMin: number;
  breakDurationMin: number;
  autostartBreak: boolean;
  autostartNextFocus: boolean;
  soundEnabled: boolean;
  volume: number;
  alwaysOnTop: boolean;
  targetDailySessions: number;
  dailyWaterTargetMl: number;
  hydrationReminderIntervalMin: number;
  seasonMode: SeasonMode;
}

// Untuk kompatibilitas tipe lama jika diperlukan
export type TimerMode = 'focus' | 'short_break' | 'long_break';

export interface PomodoroSettings {
  focusDurationMin: number;
  shortBreakMin: number;
  longBreakMin: number;
  autostartNextSession: boolean;
  soundEnabled: boolean;
  targetDailySessions: number;
}

export interface PlantedTree {
  id: string;
  gridR: number;
  gridC: number;
  treeType: 'pine' | 'oak';
  plantedAtTimestamp: number;
}

export interface IslandProgress {
  growthStage: number; // 0: tanah berumput, 1: beberapa pohon, 2: hutan rimbun
  hydrationGlasses: number;
  completedSessionsToday: number;
  currentStreakDays: number;
  trees: PlantedTree[]; // Koleksi pohon permanen yang diperoleh dari sesi selesai
  currentSeason: IslandSeason;
  seasonCycleCount: number; // 0..5 (berganti musim tiap 6 sesi fokus selesai)
}

export interface StoredAppState {
  version: number;
  config: PomodoroConfig;
  progress: IslandProgress;
  waterMl: number;
  lastActiveDate: string; // YYYY-MM-DD
  nextHydrationReminderTimestamp: number;
}
