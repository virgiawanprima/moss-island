export type IslandState = 'hidden' | 'compact' | 'expanded';

export type ActiveTab = 'focus' | 'music' | 'settings';

export type PhaseType = 'focus' | 'break';

export interface PlanPhase {
  breakKind?: 'short' | 'long';
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
  momoIntensity?: 'calm' | 'expressive';
  hoverEnabled?: boolean;
  focusTargetMin?: number; // Kompatibilitas snapshot lama; pengaturan baru memakai totalDurationMin.
  totalDurationMin: number;
  focusDurationMin: number;
  breakDurationMin: number;
  autostartBreak: boolean;
  autostartNextFocus: boolean;
  soundEnabled: boolean;
  volume: number;
  alwaysOnTop: boolean;
  targetDailySessions: number;
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

export const TREE_SPECIES = ['banana', 'mango', 'durian', 'palm', 'guava'] as const;
export type TreeSpecies = typeof TREE_SPECIES[number];

export interface PlantedTree {
  id: string;
  gridR: number;
  gridC: number;
  treeType: TreeSpecies;
  plantedAtTimestamp: number;
}

export interface IslandProgress {
  growthStage: number; // 0: tanah berumput, 1: beberapa pohon, 2: hutan rimbun
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
  lastActiveDate: string; // YYYY-MM-DD
  // Snapshot timer aktif agar sesi tidak hilang saat aplikasi ditutup/crash
  timerSession?: TimerSnapshot | null;
}

// Snapshot status timer pada transisi penting untuk pemulihan saat startup
export interface TimerSnapshot {
  focusTargetMin?: number;
  scheduleVersion?: number;
  phaseIndex: number;
  status: 'running' | 'paused' | 'waiting_next';
  phaseRemainingSeconds: number;
  targetEndTime: number | null;
  savedAt: number;
  // Penjagaan: snapshot hanya dipulihkan bila rencana masih cocok
  totalDurationMin: number;
  focusDurationMin: number;
  breakDurationMin: number;
}
