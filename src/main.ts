import {
  IslandState,
  ActiveTab,
  PomodoroConfig,
  PlanPhase,
  PomodoroPlan,
  TimerStatus,
  StoredAppState,
  IslandSeason,
  SeasonMode,
} from './types';
import { IslandRenderer } from './canvas/islandRenderer';
import { PomodoroEngine } from './timer/pomodoroEngine';
import { buildPomodoroPlan, validatePomodoroInput } from './timer/pomodoroPlan';
import { AmbientSynth, AmbientTrack } from './audio/ambientSynth';
import { SystemMediaBridge } from './audio/systemMediaBridge';
import { lyricsService } from './audio/lyricsService';
import {
  resolveMediaSourceIdentity,
  type MediaSourceIdentity,
} from './audio/mediaSourceIdentity';
import type { ArtworkSource } from './audio/lyricsService';
import {
  loadAppState,
  saveAppState,
  getTodayDateString,
  isYesterday,
} from './storage';
import { sendDesktopNotification, initNotificationPermissions } from './notificationService';
import { isAutostartEnabled, setAutostartEnabled } from './autostartService';
import { installMockMediaSession } from './devMediaSimulation';

// Inisialisasi status aplikasi dari penyimpanan persisten
let appState: StoredAppState = loadAppState();
export let currentIslandState: IslandState = 'expanded';
export let currentTab: ActiveTab = 'focus';

// Modul-modul utama
let renderer: IslandRenderer | null = null;
let engine: PomodoroEngine;
let audio: AmbientSynth;
let mediaBridge: SystemMediaBridge | null = null;
let isAudioPlaying: boolean = false;
let isSystemMediaActive: boolean = false;
let isAlwaysOnTopActive: boolean = true;
let isSettingsModalOpen: boolean = false;
let lastKnownDate: string = getTodayDateString();
let hasNotifiedHydrationDue: boolean = false;

// Track ambient lokal dengan deskripsi jujur
interface TrackItem {
  id: AmbientTrack;
  title: string;
  artist: string;
}

const ambientTracks: TrackItem[] = [
  { id: 'rain', title: 'Suara Hujan Hutan', artist: 'Moss Audio · Forest Tape' },
  { id: 'stream', title: 'Gemericik Sungai', artist: 'Moss Audio · Water Whisper' },
  { id: 'breeze', title: 'Semilir Angin Pinus', artist: 'Moss Audio · Valley Wind' },
];
let currentTrackIdx: number = 0;

if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
  // 0. Dukungan pengujian visual: ?mockmedia=opera|spotify mensimulasikan sesi
  //    media sistem pada pratinjau peramban. Tidak berpengaruh pada desktop Tauri.
  installMockMediaSession(new URLSearchParams(window.location.search).get('mockmedia'));

  // 1. Deteksi Lingkungan Native Tauri Desktop
  initTauriEnvironment();

  // 2. Inisialisasi Renderer Canvas 2D
  const canvasEl = document.querySelector<HTMLCanvasElement>('#island-canvas');
  if (canvasEl) {
    renderer = new IslandRenderer(canvasEl, () => {
      return currentIslandState === 'expanded' && currentTab === 'focus';
    });
    renderer.setSeason(appState.progress.currentSeason || 'spring');
    renderer.setPlantedTrees(appState.progress.trees || []);
    renderer.start();

    // Klik pulau / Momo untuk memicu reaksi animasi khas musiman Momo
    canvasEl.addEventListener('click', () => {
      if (renderer) {
        renderer.triggerSeasonalAction();
      }
    });
  }

  // 3. Inisialisasi Audio Ambient
  audio = new AmbientSynth();

  // 4. Inisialisasi Mesin Pomodoro Berbasis Total Waktu
  engine = new PomodoroEngine(appState.config, {
    onTick: (remaining, total, phase, totalProgress) => {
      handleTimerTick(remaining, total, phase, totalProgress);
    },
    onPhaseComplete: (completedPhase, nextPhase, isSkipped) => {
      handlePhaseComplete(completedPhase, nextPhase, isSkipped);
    },
    onPlanComplete: (plan) => {
      handlePlanComplete(plan);
    },
    onStatusChange: (status) => {
      handleStatusChange(status);
    },
  });

  // 5. Hubungkan Pengendali UI & Navigasi
  bindTabs();
  bindTimerControls();
  bindHydrationControls();
  bindMusicControls();
  bindWindowAndNotchControls();
  bindSettingsModal();
  bindStateSwitcher();
  bindClockTicker();

  // Sinkronisasi status awal UI
  syncUI();

  // Dukungan parameter URL untuk pengujian langsung
  const urlParams = new URLSearchParams(window.location.search);
  const initialTab = urlParams.get('tab') as ActiveTab;
  const initialState = urlParams.get('state') as IslandState;
  if (initialTab && ['music', 'focus', 'hydration'].includes(initialTab)) {
    document.querySelector<HTMLButtonElement>(`#tab-btn-${initialTab}`)?.click();
  }
  if (initialState && ['hidden', 'compact', 'expanded'].includes(initialState)) {
    setIslandState(initialState);
  }
});
}

// ============================================================================
// 1. INTEGRASI NATIVE DESKTOP TAURI 2
// ============================================================================
function isTauri(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window || '__TAURI_METADATA__' in window)
  );
}

async function initTauriEnvironment() {
  for (let i = 0; i < 15; i++) {
    if (isTauri()) break;
    await new Promise((r) => setTimeout(r, 40));
  }
  if (!isTauri()) return;

  document.body.classList.add('is-tauri-native');
  document.documentElement.classList.add('is-tauri-native');

  // Posisikan window awal tepat di atas tengah monitor tanpa celah dan pastikan selalu di atas
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('set_always_on_top', { alwaysOnTop: true });
    await invoke('position_island_top_center', { yOffset: 0.0 });
  } catch (_e) {
    // Fallback jika pemanggilan command gagal
  }

  // Daftarkan listener event native (System Tray dan Hotkey Global Ctrl+Shift+M)
  try {
    const { listen } = await import('@tauri-apps/api/event');
    await listen('toggle-island-state', () => {
      toggleIslandStateCycle();
    });
    await listen('tray-toggle', () => {
      toggleIslandStateCycle();
    });
    await listen('tray-show', () => {
      setIslandState('expanded');
    });
    await listen('tray-hide', () => {
      setIslandState('hidden');
    });
  } catch (err) {
    console.warn('Gagal mendaftarkan pendengar event native:', err);
  }

  // Kembalikan ke posisi menempel tengah atas saat drag selesai dilepas (mouseup)
  window.addEventListener('mouseup', async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('snap_to_top_center');
    } catch (_e) {
      // Abaikan jika bukan di tauri
    }
  });

  // Hitung ulang posisi jika konfigurasi layar atau ukuran peramban berubah (ditahan saat transisi berlangsung)
  window.addEventListener('resize', async () => {
    if (isIslandTransitioning) return;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('position_island_top_center', { yOffset: 0.0 });
    } catch (_e) {
      // Abaikan
    }
  });

  // Inisialisasi izin notifikasi desktop
  void initNotificationPermissions();
}

export function toggleIslandStateCycle() {
  if (currentIslandState === 'hidden') {
    setIslandState('expanded');
  } else if (currentIslandState === 'compact') {
    setIslandState('expanded');
  } else {
    setIslandState('hidden');
  }
}

// ============================================================================
// 1.1 KONFIGURASI UKURAN ISLAND SEBAGAI SATU SUMBER ACUAN (Single Source of Truth)
// ============================================================================
export interface IslandDimensionConfig {
  width: number;
  height: number;
  minWidth: number | null;
  minHeight: number | null;
  resizable: boolean;
}

export const ISLAND_DIMENSIONS = {
  hidden: {
    width: 130,
    height: 28,
    minWidth: null,
    minHeight: null,
    resizable: false,
  },
  compact: {
    width: 460,
    height: 42,
    minWidth: null,
    minHeight: null,
    resizable: false,
  },
  settings: {
    width: 960,
    height: 560,
    minWidth: 640,
    minHeight: 480,
    resizable: true,
  },
  expanded: {
    focus: {
      width: 960,
      height: 308,
      minWidth: 640,
      minHeight: 308,
      resizable: true,
    },
    hydration: {
      width: 960,
      height: 308,
      minWidth: 640,
      minHeight: 308,
      resizable: true,
    },
    music: {
      width: 960,
      height: 248,
      minWidth: 640,
      minHeight: 248,
      resizable: true,
    },
  },
} as const;

export function getIslandDimension(
  state: IslandState,
  tab: ActiveTab = currentTab,
  modalOpen: boolean = isSettingsModalOpen
): IslandDimensionConfig {
  if (modalOpen || tab === 'settings') {
    return ISLAND_DIMENSIONS.settings;
  }
  if (state === 'hidden') {
    return ISLAND_DIMENSIONS.hidden;
  }
  if (state === 'compact') {
    return ISLAND_DIMENSIONS.compact;
  }
  if (tab === 'music') {
    return ISLAND_DIMENSIONS.expanded.music;
  }
  if (tab === 'hydration') {
    return ISLAND_DIMENSIONS.expanded.hydration;
  }
  return ISLAND_DIMENSIONS.expanded.focus;
}

async function syncTauriWindowState(state: IslandState, modalOpen: boolean = false) {
  if (!isTauri()) return;

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const dim = getIslandDimension(state, currentTab, modalOpen);

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const durationMs = prefersReducedMotion ? 0 : 200;

    // Animasi ukuran window native secara bertahap melalui API Tauri
    try {
      await invoke('animate_island_window', {
        targetWidth: dim.width,
        targetHeight: dim.height,
        durationMs,
        yOffset: 0.0,
        resizable: dim.resizable,
        minWidth: dim.minWidth,
        minHeight: dim.minHeight,
      });
    } catch {
      await invoke('set_island_window_size', {
        width: dim.width,
        height: dim.height,
        minWidth: dim.minWidth,
        minHeight: dim.minHeight,
        resizable: dim.resizable,
      });
      await invoke('position_island_top_center', { yOffset: 0.0 });
    }

    await invoke('set_always_on_top', { alwaysOnTop: isAlwaysOnTopActive });
  } catch (_e) {
    // Abaikan jika pemanggilan native gagal
  }
}

let activeTransitionToken = 0;
let isIslandTransitioning = false;

// ============================================================================
// 2. TRANSISI STATUS ISLAND (Hidden, Compact, Expanded)
// Alur terkendali: Redupkan konten lama -> Ubah bentuk panel -> Tampilkan konten baru
// ============================================================================
export async function setIslandState(state: IslandState) {
  const widget = document.querySelector<HTMLElement>('#dynamic-island');
  if (!widget) return;

  // Jika status sudah sesuai dan sudah siap, hindari transisi berulang
  if (
    state === currentIslandState &&
    widget.classList.contains(`state-${state}`) &&
    (state !== 'expanded' || widget.classList.contains('expanded-ready'))
  ) {
    return;
  }

  const token = ++activeTransitionToken;
  isIslandTransitioning = true;
  currentIslandState = state;

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fadeOutDuration = prefersReducedMotion ? 0 : 80;
  const fadeInDuration = prefersReducedMotion ? 0 : 80;

  // 1. TAHAP 1: Redupkan konten aktif lama secara lembut
  widget.classList.add('is-fading-out');
  if (fadeOutDuration > 0) {
    await new Promise((r) => setTimeout(r, fadeOutDuration));
  }
  if (token !== activeTransitionToken) return;

  // 2. TAHAP 2: Ubah bentuk panel (window & widget), tahan min-height expanded
  widget.classList.remove('is-fading-out', 'expanded-ready');
  widget.classList.add('is-morphing');
  if (state === 'expanded') {
    widget.classList.remove('tab-focus', 'tab-hydration', 'tab-music');
    widget.classList.add(`tab-${currentTab}`);
  }

  // Dalam mode peramban non-Tauri, perbarui class state sekarang agar transisi CSS berjalan
  if (!isTauri()) {
    widget.classList.remove('state-hidden', 'state-compact', 'state-expanded');
    widget.classList.add(`state-${state}`);
    if (!prefersReducedMotion) {
      await new Promise((r) => setTimeout(r, 200));
    }
  } else {
    // Animasi ukuran window native Tauri secara bertahap
    await syncTauriWindowState(state, isSettingsModalOpen);
  }
  if (token !== activeTransitionToken) return;

  // 3. TAHAP 3: Tampilkan konten baru dan terapkan min-height setelah pembesaran selesai
  widget.classList.remove('state-hidden', 'state-compact', 'state-expanded', 'is-morphing');
  widget.classList.add(`state-${state}`);
  if (state === 'expanded') {
    widget.classList.add('expanded-ready');
    widget.classList.remove('tab-focus', 'tab-hydration', 'tab-music');
    widget.classList.add(`tab-${currentTab}`);
  }

  // Kelola renderer Kanvas 2D Momo
  if (state === 'expanded' && currentTab === 'focus') {
    renderer?.start();
    renderer?.waveHello();
  } else {
    renderer?.pause();
  }

  // Update tombol tester state di dock/footer
  document.querySelectorAll('.state-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-state') === state);
  });

  // Beri waktu fade-in konten baru
  if (fadeInDuration > 0) {
    await new Promise((r) => setTimeout(r, fadeInDuration));
  }
  if (token !== activeTransitionToken) return;

  isIslandTransitioning = false;

  // Pemusatan presisi di akhir transisi jika menggunakan Tauri desktop
  if (isTauri()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('position_island_top_center', { yOffset: 0.0 });
    } catch (_e) {
      // Abaikan
    }
  }
}

// ============================================================================
// 3. SINKRONISASI UI TIMER & TIMELINE SESI
// ============================================================================
function updateForestGenerationBadge() {
  const badge = document.querySelector<HTMLElement>('#forest-gen-badge');
  if (!badge || !renderer) return;

  const info = renderer.getForestGenerationInfo();
  const currentGen = info.generation + 1;
  badge.innerText = `Hutan ke-${currentGen} · ${info.currentGenTrees}/${info.maxSlots} pohon`;
  badge.title = `Generasi hutan aktif: ke-${currentGen}. Total pohon permanen yang ditanam: ${info.totalTrees}.`;
}

function syncUI() {
  updateSessionMeta();
  updateHydrationUI();
  updateTimelineUI();
  updateSettingsFormInputs();
  updateForestGenerationBadge();
  engine.notifyTick();
  handleStatusChange(engine.getStatus());
}

function updateSessionMeta() {
  const plan = engine.getPlan();
  const phase = engine.getCurrentPhase();

  const sessionTag = document.querySelector<HTMLElement>('#session-tag');
  const durationTag = document.querySelector<HTMLElement>('#session-duration-tag');
  const statTitle = document.querySelector<HTMLElement>('#stat-total-title');
  const statDesc = document.querySelector<HTMLElement>('#stat-total-desc');
  const autoLoopP1 = document.querySelector<HTMLElement>('#auto-loop-p1');
  const autoLoopP2 = document.querySelector<HTMLElement>('#auto-loop-p2');

  const totalHours = Math.floor(plan.totalDurationMin / 60);
  const remainingMins = plan.totalDurationMin % 60;
  const totalTimeLabel =
    remainingMins > 0 ? `TOTAL ${totalHours} JAM ${remainingMins}M` : `TOTAL ${totalHours} JAM`;

  if (statTitle) {
    statTitle.innerText = totalTimeLabel;
  }
  if (statDesc) {
    const focusHours = Math.floor(plan.totalFocusMin / 60);
    const focusMins = plan.totalFocusMin % 60;
    const focusStr =
      focusHours > 0 && focusMins === 0
        ? `${focusHours} jam Fokus`
        : focusHours > 0
        ? `${focusHours} jam ${focusMins}m Fokus`
        : `${plan.totalFocusMin}m Fokus`;

    const breakHours = Math.floor(plan.totalBreakMin / 60);
    const breakMins = plan.totalBreakMin % 60;
    const breakStr =
      breakHours > 0 && breakMins === 0
        ? `${breakHours} jam istirahat`
        : breakHours > 0
        ? `${breakHours} jam ${breakMins}m istirahat`
        : `${plan.totalBreakMin}m istirahat`;

    statDesc.innerText = `${focusStr} + ${breakStr}`;
  }

  if (autoLoopP1) {
    autoLoopP1.innerText = `Otomatis: Fokus ${appState.config.focusDurationMin}m > istirahat ${appState.config.breakDurationMin}m`;
  }
  if (autoLoopP2) {
    const totalTimeHours = Math.floor(plan.totalDurationMin / 60);
    const totalTimeMins = plan.totalDurationMin % 60;
    const stopText =
      totalTimeMins === 0
        ? `berhenti setelah ${totalTimeHours} jam.`
        : `selesai dalam ${plan.totalDurationMin} menit.`;
    autoLoopP2.innerText = `${plan.focusSessionCount} putaran, ${stopText}`;
  }

  if (engine.getStatus() === 'completed') {
    if (sessionTag) sessionTag.innerText = 'RENCANA SELESAI';
    if (durationTag) durationTag.innerText = `${plan.focusSessionCount}/${plan.focusSessionCount} sesi tuntas`;
    return;
  }

  if (phase) {
    const match = phase.label.match(/\d+/);
    const sessionNum = match ? parseInt(match[0], 10) : 1;
    const sessionStr = sessionNum.toString().padStart(2, '0');
    if (phase.type === 'focus') {
      if (sessionTag) sessionTag.innerText = `FOKUS · SESI ${sessionStr}`;
      if (durationTag) {
        durationTag.innerText = `${appState.config.focusDurationMin} / ${appState.config.breakDurationMin} menit`;
      }
    } else {
      if (sessionTag) sessionTag.innerText = `ISTIRAHAT · SESI ${sessionStr}`;
      if (durationTag) durationTag.innerText = `${phase.durationMin} menit`;
    }
  }

  // Tampilkan peringatan fase terakhir diperpendek jika berlaku
  const shortenedAlert = document.querySelector<HTMLElement>('#active-shortened-alert');
  if (shortenedAlert) {
    const hasShortened = plan.phases.some((p) => p.isShortened);
    shortenedAlert.style.display = hasShortened ? 'inline-block' : 'none';
  }
}

function updateTimelineUI() {
  const plan = engine.getPlan();
  const currentIdx = engine.getCurrentPhaseIndex();
  const currentPhase = engine.getCurrentPhase();

  const trackEl = document.querySelector<HTMLElement>('#timeline-track');
  const sessionsCountEl = document.querySelector<HTMLElement>('#timeline-sessions-count');
  const detailTextEl = document.querySelector<HTMLElement>('#timeline-detail-text');

  if (sessionsCountEl) {
    sessionsCountEl.innerText = `${appState.progress.completedSessionsToday}/${plan.focusSessionCount} Fokus`;
  }

  if (detailTextEl && currentPhase) {
    const typeLabel = currentPhase.type === 'focus' ? 'Fokus' : 'Istirahat';
    const statusLabel =
      engine.getStatus() === 'running'
        ? 'Sedang berjalan'
        : engine.getStatus() === 'paused'
        ? 'Dijeda'
        : engine.getStatus() === 'waiting_next'
        ? 'Menunggu dimulai'
        : engine.getStatus() === 'completed'
        ? 'Selesai'
        : 'Siap dimulai';
    detailTextEl.innerText = `Fase ${currentIdx + 1}/${plan.phases.length} · ${typeLabel} ${currentPhase.durationMin}m · ${statusLabel}`;
  }

  if (trackEl) {
    renderTimelineSegments(trackEl, plan, currentIdx);
  }
}

function renderTimelineSegments(
  trackEl: HTMLElement,
  plan: PomodoroPlan,
  activeIdx: number,
  onSegmentClick?: (index: number) => void
) {
  trackEl.innerHTML = '';

  plan.phases.forEach((phase, idx) => {
    const seg = document.createElement('div');
    seg.className = `timeline-segment ${phase.type}`;

    if (idx === activeIdx) {
      seg.classList.add('active');
    } else if (idx < activeIdx) {
      seg.classList.add('completed');
    }

    // Lebar proporsional berbasis durasi menit
    seg.style.flex = `${phase.durationMin}`;
    seg.style.minWidth = '4px';
    seg.title = `Fase ${idx + 1}: ${phase.type === 'focus' ? 'Fokus' : 'Istirahat'} (${phase.durationMin} menit)${phase.isShortened ? ' [Diperpendek]' : ''}`;

    if (onSegmentClick) {
      seg.addEventListener('click', () => onSegmentClick(idx));
    }

    trackEl.appendChild(seg);
  });
}

function handleTimerTick(
  remainingSeconds: number,
  phaseTotalSeconds: number,
  currentPhase: PlanPhase,
  totalProgressFraction: number
) {
  const m = Math.floor(remainingSeconds / 60);
  const s = remainingSeconds % 60;
  const timeStr = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;

  const timerDisplay = document.querySelector<HTMLElement>('#timer-display');
  if (timerDisplay) timerDisplay.innerText = timeStr;

  const compactTime = document.querySelector<HTMLElement>('#compact-time');
  if (compactTime) compactTime.innerText = timeStr;

  // Hitung persentase progres fokus secara nyata (tanpa paksa 10% atau 28% di awal)
  const phaseElapsed = phaseTotalSeconds - remainingSeconds;
  const phasePercent =
    phaseTotalSeconds > 0
      ? Math.min(100, Math.max(0, Math.round((phaseElapsed / phaseTotalSeconds) * 100)))
      : 0;

  void totalProgressFraction;

  const progressFill = document.querySelector<HTMLElement>('#focus-progress-fill');
  if (progressFill) progressFill.style.width = `${phasePercent}%`;

  const percentLabel = document.querySelector<HTMLElement>('#growth-percent');
  if (percentLabel) percentLabel.innerText = `${phasePercent}%`;

  // Pembaruan teks perkembangan pohon dan progres sesi
  const captionLabel = document.querySelector<HTMLElement>('#growth-caption');
  const treeCount = appState.progress.trees?.length || 0;

  if (currentPhase.type === 'focus') {
    // Selama fokus berlangsung: petak menunjukkan progres pertumbuhan tunas
    const progressFraction = phaseTotalSeconds > 0 ? (phaseTotalSeconds - remainingSeconds) / phaseTotalSeconds : 0;
    renderer?.updateFocusProgress(progressFraction);

    if (captionLabel) {
      if (treeCount === 0) {
        captionLabel.innerText = 'Oak kecilmu sedang tumbuh';
      } else {
        captionLabel.innerText = `${treeCount} pohon di pulaumu · Tunas baru tumbuh`;
      }
    }
  } else {
    // Selama istirahat: Momo istirahat santai di bawah pohon
    renderer?.setBreakMode(true);
    if (captionLabel) {
      captionLabel.innerText = 'Waktu istirahat santai untuk pikiranmu';
    }
  }

  // Update teks detail timeline jika elemen tersedia
  const detailTextEl = document.querySelector<HTMLElement>('#timeline-detail-text');
  if (detailTextEl) {
    const typeLabel = currentPhase.type === 'focus' ? 'Fokus' : 'Istirahat';
    const currentIdx = engine.getCurrentPhaseIndex();
    const plan = engine.getPlan();
    detailTextEl.innerText = `Fase ${currentIdx + 1}/${plan.phases.length} · ${typeLabel} ${timeStr} tersisa`;
  }
}

function handlePhaseComplete(
  completedPhase: PlanPhase,
  _nextPhase?: PlanPhase | null,
  isSkipped: boolean = false
) {
  // Bunyikan lonceng lembut jika suara aktif dan bukan fase yang di-skip
  if (appState.config.soundEnabled && !isSkipped) {
    audio.playChime();
  }

  if (completedPhase.type === 'focus' && !isSkipped) {
    appState.progress.completedSessionsToday++;

    // Hitungan musim: bertambah hanya jika sesi fokus selesai penuh
    if (appState.config.seasonMode === 'cycle') {
      const nextCycle = (appState.progress.seasonCycleCount || 0) + 1;
      if (nextCycle >= 6) {
        // Rotasi ke musim berikutnya: semi -> panas -> gugur -> dingin -> semi
        const seasons: IslandSeason[] = ['spring', 'summer', 'autumn', 'winter'];
        const currentIdx = seasons.indexOf(appState.progress.currentSeason || 'spring');
        const nextSeason = seasons[(currentIdx + 1) % seasons.length];
        appState.progress.currentSeason = nextSeason;
        appState.progress.seasonCycleCount = 0;
        renderer?.setSeason(nextSeason);
      } else {
        appState.progress.seasonCycleCount = nextCycle;
      }
    }

    // Tunas tumbuh menjadi satu pohon permanen, disambut Momo merayakan gembira
    if (renderer) {
      const newTree = renderer.completeFocusSession();
      if (!appState.progress.trees) appState.progress.trees = [];
      appState.progress.trees.push(newTree);
      saveAppState(appState);
    }

    const captionLabel = document.querySelector<HTMLElement>('#growth-caption');
    if (captionLabel) {
      const count = appState.progress.trees?.length || 1;
      captionLabel.innerText = `Satu pohon baru mekar! Total ${count} pohon.`;
    }

    // Kirim notifikasi desktop native saat fokus selesai
    void sendDesktopNotification(
      'Fokus Selesai! 🌿',
      'Momo berhasil menanam 1 pohon di hutanmu. Waktunya istirahat sejenak.'
    );
  } else if (completedPhase.type === 'break' && !isSkipped) {
    // Kirim notifikasi desktop native saat istirahat selesai
    void sendDesktopNotification(
      'Istirahat Selesai! ✨',
      'Waktunya kembali fokus bersama Momo.'
    );
  }

  updateForestGenerationBadge();
  updateSessionMeta();
  updateTimelineUI();
}

function handlePlanComplete(_plan: PomodoroPlan) {
  if (appState.config.soundEnabled) {
    audio.playChime();
  }
  renderer?.celebrateBriefly(60);
  renderer?.setOverviewMode(true); // Kamera sedikit menjauh memperlihatkan seluruh pohon di pulau
  const captionLabel = document.querySelector<HTMLElement>('#growth-caption');
  if (captionLabel) {
    const count = appState.progress.trees?.length || 0;
    captionLabel.innerText = `Rencana belajar tuntas! Pulaumu kini memiliki ${count} pohon.`;
  }

  void sendDesktopNotification(
    'Rencana Belajar Tuntas! 🌳',
    'Luar biasa! Seluruh target waktu telah tercapai bersama Momo.'
  );

  updateForestGenerationBadge();
  updateSessionMeta();
  updateTimelineUI();
}

let previousTimerStatus: TimerStatus = 'idle';

function handleStatusChange(status: TimerStatus) {
  const btnToggle = document.querySelector<HTMLButtonElement>('#btn-toggle-timer');
  if (!btnToggle) return;

  if (status === 'running') {
    btnToggle.innerText = 'Jeda';
    btnToggle.style.backgroundColor = 'var(--color-accent-mint)';
    btnToggle.style.color = '#101917';

    const currentPhase = engine.getCurrentPhase();
    if (currentPhase?.type === 'focus') {
      const isResuming = previousTimerStatus === 'paused' || Boolean(renderer?.hasActiveSprout());
      if (isResuming) {
        // Melanjutkan sesi fokus yang dijeda: pertahankan progres tunas dan rute Momo
        renderer?.setTimerPaused(false);
        renderer?.setMood('idle');
      } else {
        // Memulai sesi fokus baru: tanam benih baru
        renderer?.startFocusPlanting();
        renderer?.setTimerPaused(false);
        renderer?.setMood('idle');
      }
    }
  } else if (status === 'paused') {
    btnToggle.innerText = 'Lanjut';
    btnToggle.style.backgroundColor = 'var(--color-accent-green)';
    btnToggle.style.color = '#101917';

    // Timer dijeda: Momo duduk di dekat tunas; pertumbuhan berhenti
    renderer?.setTimerPaused(true);
  } else if (status === 'waiting_next') {
    btnToggle.innerText = 'Mulai Sesi Berikutnya';
    btnToggle.style.backgroundColor = 'var(--color-accent-green)';
    btnToggle.style.color = '#101917';
    renderer?.setMood('idle');
  } else if (status === 'completed') {
    btnToggle.innerText = 'Mulai Baru';
    btnToggle.style.backgroundColor = 'var(--color-accent-green)';
    btnToggle.style.color = '#101917';
    renderer?.celebrateBriefly(60);
  } else {
    btnToggle.innerText = 'Mulai';
    btnToggle.style.backgroundColor = 'var(--color-accent-green)';
    btnToggle.style.color = '#101917';
    renderer?.setMood('idle');
  }

  previousTimerStatus = status;
}

// ============================================================================
// 4. PENGENDALI EVENT UI & TAB
// ============================================================================
function bindTabs() {
  const tabButtons = document.querySelectorAll<HTMLButtonElement>('.pill-tab-btn');
  const widget = document.querySelector<HTMLElement>('#dynamic-island');

  tabButtons.forEach((btn) => {
    btn.addEventListener('click', async () => {
      const targetTab = btn.getAttribute('data-tab') as ActiveTab;
      if (!targetTab) return;

      currentTab = targetTab;
      tabButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');

      if (widget) {
        widget.classList.remove('tab-focus', 'tab-hydration', 'tab-music');
        widget.classList.add(`tab-${targetTab}`);
      }

      document.querySelectorAll<HTMLElement>('.tab-panel').forEach((panel) => {
        panel.classList.remove('active');
      });
      const activePanel = document.querySelector<HTMLElement>(`#panel-${targetTab}`);
      if (activePanel) activePanel.classList.add('active');
      if (targetTab === 'hydration') {
        updateHydrationUI();
      }

      // Sinkronkan ukuran jendela native sesuai tab yang dipilih saat expanded
      if (currentIslandState === 'expanded') {
        isIslandTransitioning = true;
        try {
          await syncTauriWindowState('expanded', isSettingsModalOpen);
        } finally {
          isIslandTransitioning = false;
        }
      }

      // Hemat render Canvas jika tidak melihat tab Fokus
      if (targetTab === 'focus' && currentIslandState === 'expanded') {
        renderer?.start();
      } else {
        renderer?.pause();
      }
    });
  });

  // Dock buttons navigation
  document.querySelector('#dock-btn-focus')?.addEventListener('click', async () => {
    currentTab = 'focus';
    document.querySelector<HTMLButtonElement>('#tab-btn-focus')?.click();
    await setIslandState('expanded');
  });
  document.querySelector('#dock-btn-music')?.addEventListener('click', async () => {
    currentTab = 'music';
    document.querySelector<HTMLButtonElement>('#tab-btn-music')?.click();
    await setIslandState('expanded');
  });
}

function bindTimerControls() {
  const btnToggle = document.querySelector<HTMLButtonElement>('#btn-toggle-timer');
  const btnFinish = document.querySelector<HTMLButtonElement>('#btn-finish-timer');

  btnToggle?.addEventListener('click', () => {
    engine.toggle();
  });

  btnFinish?.addEventListener('click', () => {
    renderer?.cancelFocusSession();
    engine.reset();
    updateSessionMeta();
    updateTimelineUI();
  });
}

// ============================================================================
// 5. PENGINGAT MINUM AIR INTERAKTIF DENGAN MOMO
// ============================================================================
function bindHydrationControls() {
  const btnDrink = document.querySelector<HTMLButtonElement>('#btn-drink-water');
  const btnSnooze = document.querySelector<HTMLButtonElement>('#btn-snooze-water');
  const compactDrop = document.querySelector<HTMLElement>('#compact-water-drop');

  compactDrop?.addEventListener('click', (e) => {
    e.stopPropagation();
    setIslandState('expanded');
    document.querySelector<HTMLButtonElement>('#tab-btn-hydration')?.click();
  });

  btnDrink?.addEventListener('click', () => {
    const targetMl = appState.config.dailyWaterTargetMl || 2000;
    const isTargetJustReached = (appState.waterMl + 250) >= targetMl && appState.waterMl < targetMl;

    // Catatan air HANYA bertambah saat pengguna menekan tombol minum
    appState.waterMl = Math.min(targetMl + 500, appState.waterMl + 250);
    appState.progress.hydrationGlasses = Math.floor(appState.waterMl / 250);
    hasNotifiedHydrationDue = false;

    // Jadwalkan ulang pengingat berikutnya
    const intervalMin = appState.config.hydrationReminderIntervalMin || 45;
    appState.nextHydrationReminderTimestamp = Date.now() + intervalMin * 60 * 1000;
    saveAppState(appState);

    renderer?.setHydrated(true);

    const momoActor = document.querySelector<HTMLElement>('#momo-hydration-actor');
    const teaCup = document.querySelector<HTMLElement>('#pixel-tea-cup');
    const scene = document.querySelector<HTMLElement>('#tea-cup-scene');

    // 1. Momo meneguk air dan air di mug surut menjadi kosong
    if (momoActor) momoActor.className = 'momo-hydrated-sprite momo-pose-sip';
    if (teaCup) teaCup.classList.add('is-empty');
    if (scene) scene.classList.remove('is-due');
    btnDrink.classList.remove('pulse-action');

    updateHydrationStats();

    // Feedback tombol
    const originalText = btnDrink.innerText;
    btnDrink.innerText = 'Segar! (+250 ml)';
    setTimeout(() => {
      btnDrink.innerText = originalText;
    }, 1500);

    if (isTargetJustReached) {
      // 2. Target harian tercapai: Momo mengangkat mug untuk bersulang dengan percikan pixel
      setTimeout(() => {
        if (momoActor) momoActor.className = 'momo-hydrated-sprite momo-pose-toast';
        if (appState.config.soundEnabled) audio.playChime();

        const badge = document.querySelector<HTMLElement>('#hydration-badge');
        const heading = document.querySelector<HTMLElement>('#hydration-heading');
        const desc = document.querySelector<HTMLElement>('#hydration-desc');

        if (badge) {
          badge.innerText = 'TARGET TERCAPAI';
          badge.className = 'session-badge badge-green';
        }
        if (heading) heading.innerText = 'Target Hari Ini Tercapai!';
        if (desc) desc.innerText = 'Kerja luar biasa menjaga hidrasi dan fokus pikiranmu hari ini.';

        setTimeout(() => {
          updateHydrationUI();
        }, 2600);
      }, 1200);
    } else {
      setTimeout(() => {
        updateHydrationUI();
      }, 1600);
    }
  });

  btnSnooze?.addEventListener('click', () => {
    // Tunda riil 10 menit
    appState.nextHydrationReminderTimestamp = Date.now() + 10 * 60 * 1000;
    hasNotifiedHydrationDue = false;
    saveAppState(appState);

    const momoActor = document.querySelector<HTMLElement>('#momo-hydration-actor');
    const teaCup = document.querySelector<HTMLElement>('#pixel-tea-cup');
    const scene = document.querySelector<HTMLElement>('#tea-cup-scene');
    const desc = document.querySelector<HTMLElement>('#hydration-desc');

    // Momo meletakkan mug dan duduk menunggu santai
    if (momoActor) momoActor.className = 'momo-hydrated-sprite momo-pose-relaxed';
    if (teaCup) teaCup.classList.add('is-empty');
    if (scene) scene.classList.remove('is-due');
    btnDrink?.classList.remove('pulse-action');

    const snoozeDate = new Date(appState.nextHydrationReminderTimestamp);
    const snoozeTimeStr = `${snoozeDate.getHours().toString().padStart(2, '0')}:${snoozeDate.getMinutes().toString().padStart(2, '0')}`;
    if (desc) desc.innerText = `Pengingat ditunda 10 menit (pukul ${snoozeTimeStr}).`;

    btnSnooze.innerText = 'Ditunda 10 m';
    setTimeout(() => {
      btnSnooze.innerText = 'Tunda 10 m';
    }, 2000);

    const compactDropEl = document.querySelector<HTMLElement>('#compact-water-drop');
    if (compactDropEl) compactDropEl.classList.remove('active');
  });
}

function updateHydrationStats() {
  const targetMl = appState.config.dailyWaterTargetMl || 2000;
  const currentMl = appState.waterMl;
  const totalGlasses = Math.max(1, Math.round(targetMl / 250));
  const currentGlasses = Math.min(totalGlasses, Math.floor(currentMl / 250));

  const volEl = document.querySelector<HTMLElement>('#hydration-vol');
  if (volEl) {
    volEl.innerText = `${currentMl.toLocaleString('id-ID')} / ${targetMl.toLocaleString('id-ID')} ml`;
  }

  const glassesEl = document.querySelector<HTMLElement>('#hydration-glasses');
  if (glassesEl) {
    glassesEl.innerText = `${currentGlasses} / ${totalGlasses} gelas`;
  }

  const barEl = document.querySelector<HTMLElement>('#segmented-glasses');
  if (barEl) {
    barEl.innerHTML = '';
    for (let i = 0; i < totalGlasses; i++) {
      const seg = document.createElement('span');
      seg.className = `glass-seg ${i < currentGlasses ? 'filled' : ''}`;
      barEl.appendChild(seg);
    }
  }
}

function updateHydrationUI() {
  updateHydrationStats();

  const isDue = Date.now() >= appState.nextHydrationReminderTimestamp;
  const momoActor = document.querySelector<HTMLElement>('#momo-hydration-actor');
  const teaCup = document.querySelector<HTMLElement>('#pixel-tea-cup');
  const scene = document.querySelector<HTMLElement>('#tea-cup-scene');
  const btnDrink = document.querySelector<HTMLButtonElement>('#btn-drink-water');
  const badge = document.querySelector<HTMLElement>('#hydration-badge');
  const heading = document.querySelector<HTMLElement>('#hydration-heading');
  const desc = document.querySelector<HTMLElement>('#hydration-desc');
  const compactDrop = document.querySelector<HTMLElement>('#compact-water-drop');

  if (compactDrop) {
    compactDrop.classList.toggle('active', isDue);
  }

  const nextDate = new Date(appState.nextHydrationReminderTimestamp);
  const nextTimeStr = `${nextDate.getHours().toString().padStart(2, '0')}:${nextDate.getMinutes().toString().padStart(2, '0')}`;
  const targetMl = appState.config.dailyWaterTargetMl || 2000;
  const isTargetMet = appState.waterMl >= targetMl;

  if (isDue) {
    if (!hasNotifiedHydrationDue) {
      hasNotifiedHydrationDue = true;
      sendDesktopNotification(
        'Waktunya Minum Air!',
        'Beri jeda sejenak untuk dirimu dan teguk segelas air segar.'
      );
    }

    // Pengingat tiba: Momo datang membawa mug dan mengangkatnya mengajak minum
    if (teaCup) teaCup.classList.remove('is-empty');
    if (scene) scene.classList.add('is-due');
    if (momoActor && !momoActor.classList.contains('momo-pose-sip') && !momoActor.classList.contains('momo-pose-toast')) {
      momoActor.className = 'momo-hydrated-sprite momo-pose-offer';
    }
    if (btnDrink) btnDrink.classList.add('pulse-action');
    if (badge) {
      badge.innerText = 'WAKTUNYA ISI ULANG';
      badge.className = 'session-badge badge-blue';
    }
    if (heading) heading.innerText = 'Seteguk dulu, yuk.';
    if (desc) desc.innerText = 'Beri jeda untuk dirimu dan segelas air.';
  } else {
    hasNotifiedHydrationDue = false;
    // Belum waktunya minum: Momo duduk santai, mug kosong (penanda visual bahwa sesi minum sudah ditangani)
    if (teaCup) teaCup.classList.add('is-empty');
    if (scene) scene.classList.remove('is-due');
    if (momoActor && !momoActor.classList.contains('momo-pose-sip') && !momoActor.classList.contains('momo-pose-toast')) {
      momoActor.className = 'momo-hydrated-sprite momo-pose-relaxed';
    }
    if (btnDrink) btnDrink.classList.remove('pulse-action');
    if (badge) {
      badge.innerText = isTargetMet ? 'TARGET TERCAPAI' : 'HIDRASI TERJAGA';
      badge.className = isTargetMet ? 'session-badge badge-green' : 'session-badge badge-blue';
    }
    if (heading) heading.innerText = isTargetMet ? 'Target Harian Selesai!' : 'Pikiranmu segar kembali.';
    if (desc) desc.innerText = isTargetMet
      ? `Hebat! ${appState.waterMl.toLocaleString('id-ID')} ml air terpenuhi hari ini.`
      : `Pengingat berikutnya pukul ${nextTimeStr}.`;
  }
}

// ============================================================================
// 6. AUDIO & MUSIK AMBIENT
// ============================================================================
function setEqualizerPlaying(playing: boolean) {
  const eq = document.querySelector<HTMLElement>('.compact-equalizer');
  if (eq) {
    if (playing) eq.classList.add('playing');
    else eq.classList.remove('playing');
  }
}

function renderMusicAlbumArt(
  identity: MediaSourceIdentity | null,
  customArtUrl?: string | null,
  artSource: ArtworkSource = 'none'
) {
  const artContainer = document.querySelector<HTMLElement>('#music-album-art');
  if (!artContainer) return;

  if (customArtUrl) {
    // Keterangan sumber gambar harus jujur sesuai asalnya
    let coverTitle: string;
    if (artSource === 'session') {
      coverTitle = identity?.isSpotifyVerified
        ? 'Sampul dari sesi media Spotify aktif'
        : 'Sampul dari sesi media aktif';
    } else if (artSource === 'search') {
      coverTitle = 'Sampul hasil pencarian terverifikasi (Deezer/iTunes) — bukan langsung dari Spotify';
    } else {
      coverTitle = 'Media Player';
    }

    const isVerifiedSpotify = identity?.isSpotifyVerified ?? false;
    artContainer.className = 'album-art-pine custom-cover-active';
    artContainer.title = coverTitle;
    artContainer.innerHTML = `
      <img src="${customArtUrl}" class="real-album-cover" alt="Album Art" />
      ${isVerifiedSpotify ? `
        <div class="spotify-corner-pill" title="Diputar via Spotify (terverifikasi)">
          <svg viewBox="0 0 48 48" fill="none">
            <circle cx="24" cy="24" r="24" fill="#1ED760"/>
            <path d="M16 19.5C21 17.8 28.5 18.3 33.2 21.2C34 21.7 34.2 22.7 33.7 23.4C33.2 24.1 32.2 24.3 31.5 23.9C27.5 21.4 20.8 21 16.5 22.3C15.7 22.5 14.8 22 14.6 21.2C14.3 20.4 14.8 19.6 16 19.5ZM16.5 24.5C20.8 23.2 27.5 23.7 31.9 26.3C32.5 26.7 32.8 27.6 32.3 28.2C31.9 28.8 31 29.1 30.4 28.6C26.7 26.4 20.8 26 17 27.1C16.2 27.3 15.4 26.9 15.2 26.1C15 25.3 15.6 24.7 16.5 24.5ZM17.2 29.5C20.8 28.4 26.5 28.9 30.3 31.2C30.8 31.5 31.1 32.3 30.7 32.8C30.3 33.3 29.5 33.6 29 33.2C25.8 31.2 20.8 30.8 17.7 31.7C17 31.9 16.3 31.5 16.1 30.9C15.9 30.2 16.5 29.7 17.2 29.5Z" fill="#121212"/>
          </svg>
        </div>
      ` : ''}
    `;
    return;
  }

  if (identity?.isSpotifyVerified) {
    artContainer.className = 'album-art-pine spotify-art';
    artContainer.title = 'Spotify terverifikasi (sampul belum tersedia)';
    artContainer.innerHTML = `
      <svg width="44" height="44" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="48" height="48" rx="10" fill="#121212"/>
        <circle cx="24" cy="24" r="16" fill="#1ED760"/>
        <path d="M16 19.5C21 17.8 28.5 18.3 33.2 21.2C34 21.7 34.2 22.7 33.7 23.4C33.2 24.1 32.2 24.3 31.5 23.9C27.5 21.4 20.8 21 16.5 22.3C15.7 22.5 14.8 22 14.6 21.2C14.3 20.4 14.8 19.6 16 19.5ZM16.5 24.5C20.8 23.2 27.5 23.7 31.9 26.3C32.5 26.7 32.8 27.6 32.3 28.2C31.9 28.8 31 29.1 30.4 28.6C26.7 26.4 20.8 26 17 27.1C16.2 27.3 15.4 26.9 15.2 26.1C15 25.3 15.6 24.7 16.5 24.5ZM17.2 29.5C20.8 28.4 26.5 28.9 30.3 31.2C30.8 31.5 31.1 32.3 30.7 32.8C30.3 33.3 29.5 33.6 29 33.2C25.8 31.2 20.8 30.8 17.7 31.7C17 31.9 16.3 31.5 16.1 30.9C15.9 30.2 16.5 29.7 17.2 29.5Z" fill="#121212"/>
      </svg>
    `;
  } else {
    artContainer.className = 'album-art-pine';
    artContainer.title = 'Ambient Forest (Moss Island Synth)';
    artContainer.innerHTML = `
      <svg width="42" height="42" viewBox="0 0 32 32" fill="none">
        <rect width="32" height="32" rx="4" fill="#58486e"/>
        <polygon points="16,6 8,18 24,18" fill="#71BA83"/>
        <polygon points="16,12 6,24 26,24" fill="#355e3b"/>
        <rect x="14" y="24" width="4" height="5" fill="#8c6438"/>
      </svg>
    `;
  }
}

function formatTime(seconds: number): string {
  if (!seconds || isNaN(seconds) || seconds < 0) return '00:00';
  const totalSecs = Math.floor(seconds);
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function bindMusicControls() {
  const btnToggle = document.querySelector<HTMLButtonElement>('#btn-music-toggle');
  const btnPrev = document.querySelector<HTMLButtonElement>('#btn-music-prev');
  const btnNext = document.querySelector<HTMLButtonElement>('#btn-music-next');
  const dancingMomo = document.querySelector<HTMLElement>('#dancing-momo');
  const stageEl = document.querySelector<HTMLElement>('#music-momo-stage');
  let lastMediaTrackKey: string = '';
  let currentCustomArtUrl: string | null = null;
  let currentArtSource: ArtworkSource = 'none';
  // Identitas sesi+rekaman yang sedang dipakai untuk pipeline artwork
  let lastSessionIdentity: string = '';
  // Penolong balapan: respons artwork lama (permintaan dengan token lebih kecil) ditolak
  let artworkRequestToken: number = 0;
  // Kunci render cover terakhir agar polling tiap detik tidak me-render ulang <img>
  let lastCoverRenderKey: string = '';

  function syncAlbumArtRender(
    identity: MediaSourceIdentity | null,
    artUrl: string | null,
    artSource: ArtworkSource,
    mediaActive: boolean
  ) {
    const key = mediaActive
      ? `${artUrl || ''}|${identity?.badgeText || ''}|${artSource}`
      : 'inactive';
    if (key === lastCoverRenderKey) return;
    lastCoverRenderKey = key;
    renderMusicAlbumArt(mediaActive ? identity : null, artUrl, artSource);
  }

  function triggerTrackChangeAnimation() {
    const coverBox = document.querySelector<HTMLElement>('.album-cover-box');
    const trackTitle = document.querySelector<HTMLElement>('#music-track-title');

    coverBox?.classList.remove('track-slide-transition');
    trackTitle?.classList.remove('track-slide-transition');
    dancingMomo?.classList.add('turn-head');

    void coverBox?.offsetWidth;

    coverBox?.classList.add('track-slide-transition');
    trackTitle?.classList.add('track-slide-transition');

    setTimeout(() => {
      dancingMomo?.classList.remove('turn-head');
      coverBox?.classList.remove('track-slide-transition');
      trackTitle?.classList.remove('track-slide-transition');
    }, 350);
  }

  // Status awal berhenti jika belum diputar secara eksplisit
  if (btnToggle) {
    btnToggle.innerText = '▶';
  }
  if (dancingMomo) {
    dancingMomo.style.animationPlayState = 'paused';
  }
  stageEl?.classList.remove('playing');
  setEqualizerPlaying(false);

  let lyricsSlideTimeout: number | null = null;
  let lyricsFadeTimeout: number | null = null;

  function renderLyricsContent(update: import('./audio/lyricsService').LyricsLinesUpdate) {
    const cardLine1 = document.querySelector<HTMLElement>('#music-card-line1');
    const cardHighlight = document.querySelector<HTMLElement>('#music-card-highlight');
    const cardLine2 = document.querySelector<HTMLElement>('#music-card-line2');
    const cardIncoming = document.querySelector<HTMLElement>('#music-card-incoming');
    const dotsEl = document.querySelector<HTMLElement>('#lyrics-instrumental-dots');
    const lyricsCard = document.querySelector<HTMLElement>('#music-lyrics-card');

    if (lyricsCard) {
      lyricsCard.classList.toggle('is-paused', update.isPlaying === false);
    }

    if (cardLine1) cardLine1.innerText = update.line1;

    if (cardHighlight) {
      cardHighlight.innerText = update.highlight;
      cardHighlight.style.display = update.isInstrumental ? 'none' : 'block';
    }

    if (dotsEl) {
      dotsEl.style.display = update.isInstrumental ? 'inline-flex' : 'none';
      if (update.isPlaying === false) {
        dotsEl.style.animationPlayState = 'paused';
      } else {
        dotsEl.style.animationPlayState = 'running';
      }
    }

    if (cardLine2) cardLine2.innerText = update.line2;
    if (cardIncoming) cardIncoming.innerText = update.incoming || '';
  }

  // Hubungkan pembaruan lirik dari lyricsService ke antarmuka kartu tengah
  lyricsService.subscribe((update) => {
    const cardTag = document.querySelector<HTMLElement>('#music-card-tag');
    const trackEl = document.querySelector<HTMLElement>('#lyrics-track');
    const viewportEl = document.querySelector<HTMLElement>('#lyrics-viewport');
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (cardTag && isSystemMediaActive) {
      const track = mediaBridge?.getCurrentTrack();
      const identity = resolveMediaSourceIdentity(track ?? null);
      const prefix = identity.badgeText;
      if (update.isSynced) {
        cardTag.innerText = update.isInstrumental ? `${prefix} · INSTRUMENTAL` : `${prefix} · LIRIK SINKRON`;
      } else if (update.line1 === 'Lirik biasa (sinkronisasi tidak tersedia)') {
        cardTag.innerText = `${prefix} · LIRIK BIASA (SINKRONISASI TIDAK TERSEDIA)`;
      } else {
        cardTag.innerText = `${prefix} · LIRIK & INFO`;
      }
    }

    // Jika reduced motion aktif, atau transisi none, atau elemen belum ada: langsung perbarui tanpa pergeseran
    if (prefersReducedMotion || update.transitionType === 'none' || !trackEl) {
      if (lyricsSlideTimeout !== null) {
        clearTimeout(lyricsSlideTimeout);
        lyricsSlideTimeout = null;
      }
      trackEl?.classList.remove('is-sliding-up');
      renderLyricsContent(update);
      return;
    }

    // 1. Saat seek atau ganti lagu (jump): langsung pilih baris dan fade singkat 160 ms (80ms fade out, 80ms fade in)
    if (update.transitionType === 'jump') {
      if (lyricsSlideTimeout !== null) {
        clearTimeout(lyricsSlideTimeout);
        lyricsSlideTimeout = null;
        trackEl.classList.remove('is-sliding-up');
      }
      if (viewportEl) {
        viewportEl.classList.add('is-fading');
        if (lyricsFadeTimeout !== null) clearTimeout(lyricsFadeTimeout);
        lyricsFadeTimeout = window.setTimeout(() => {
          renderLyricsContent(update);
          viewportEl.classList.remove('is-fading');
          lyricsFadeTimeout = null;
        }, 80);
      } else {
        renderLyricsContent(update);
      }
      return;
    }

    // 2. Saat berganti baris berurutan (step): seluruh susunan bergeser ke atas selama 200 ms
    if (update.transitionType === 'step') {
      const cardIncoming = document.querySelector<HTMLElement>('#music-card-incoming');
      if (cardIncoming) cardIncoming.innerText = update.incoming || update.line2;

      trackEl.classList.add('is-sliding-up');

      if (lyricsSlideTimeout !== null) clearTimeout(lyricsSlideTimeout);
      lyricsSlideTimeout = window.setTimeout(() => {
        renderLyricsContent(update);
        trackEl.classList.remove('is-sliding-up');
        lyricsSlideTimeout = null;
      }, 200);
      return;
    }

    renderLyricsContent(update);
  });

  // Hubungkan pembaruan cover album dan avatar penyanyi
  lyricsService.subscribeArtwork((artInfo) => {
    currentCustomArtUrl = artInfo.albumArtUrl;
    currentArtSource = artInfo.source;
    const track = mediaBridge?.getCurrentTrack();
    const identity = resolveMediaSourceIdentity(track ?? null);

    if (isSystemMediaActive) {
      syncAlbumArtRender(identity, artInfo.albumArtUrl, artInfo.source, true);

      const compactThumb = document.querySelector<HTMLImageElement>('#compact-album-thumb');
      if (compactThumb) {
        if (artInfo.albumArtUrl) {
          compactThumb.src = artInfo.albumArtUrl;
          compactThumb.style.display = 'inline-block';
        } else {
          compactThumb.style.display = 'none';
        }
      }

      const artistAvatar = document.querySelector<HTMLImageElement>('#music-artist-avatar');
      if (artistAvatar) {
        if (artInfo.artistPicUrl) {
          artistAvatar.src = artInfo.artistPicUrl;
          artistAvatar.style.display = 'inline-block';
        } else {
          artistAvatar.style.display = 'none';
        }
      }
    }
  });

  // Inisialisasi bridge sistem media OS (Spotify / Browser / Media Session)
  mediaBridge = new SystemMediaBridge();

  // Daftarkan listener saat lagu selesai (Momo melepas headphone dan meregangkan badan)
  mediaBridge.onSongFinished(() => {
    renderer?.triggerSongFinished();
    if (dancingMomo) {
      dancingMomo.classList.add('song-finished');
      setTimeout(() => {
        dancingMomo.classList.remove('song-finished');
      }, 3600);
    }
  });

  // Variabel kendali ekstrapolasi waktu pemutaran lokal mandiri
  let localPlaybackPos: number = 0;
  let lastReportedSystemPos: number = -1;
  let isPlaybackActive: boolean = false;
  let currentTrackDuration: number = 0;
  let playbackTickerTimer: number | null = null;
  let seekCooldownUntil: number = 0;

  function updateMusicProgressUI(positionSecs: number, durationSecs: number) {
    const clampedPos = Math.max(0, durationSecs > 0 ? Math.min(positionSecs, durationSecs) : positionSecs);
    const progressFill = document.querySelector<HTMLElement>('#music-progress-fill');
    const timeCurrent = document.querySelector<HTMLElement>('#music-time-current');
    const timeTotal = document.querySelector<HTMLElement>('#music-time-total');

    if (timeCurrent) {
      timeCurrent.innerText = formatTime(clampedPos);
    }
    if (timeTotal) {
      timeTotal.innerText = formatTime(durationSecs);
    }
    if (progressFill) {
      const percent = durationSecs > 0
        ? Math.min(100, Math.max(0, (clampedPos / durationSecs) * 100))
        : 0;
      progressFill.style.width = `${percent}%`;
    }

    // Sinkronkan lirik seketika ke lyricsService
    lyricsService.syncPosition(clampedPos, isPlaybackActive);
  }

  function startPlaybackTicker() {
    if (playbackTickerTimer !== null) return;
    let lastTickTime = performance.now();
    playbackTickerTimer = window.setInterval(() => {
      const now = performance.now();
      const dt = (now - lastTickTime) / 1000;
      lastTickTime = now;

      if (isPlaybackActive && isSystemMediaActive) {
        localPlaybackPos += dt;
        if (currentTrackDuration > 0 && localPlaybackPos > currentTrackDuration) {
          localPlaybackPos = currentTrackDuration;
        }
        updateMusicProgressUI(localPlaybackPos, currentTrackDuration);
      }
    }, 250);
  }

  function stopPlaybackTicker() {
    if (playbackTickerTimer !== null) {
      clearInterval(playbackTickerTimer);
      playbackTickerTimer = null;
    }
  }

  mediaBridge.subscribe((track) => {
    if (track && track.has_session && track.title.trim().length > 0) {
      isSystemMediaActive = true;
      // Identitas sumber: aplikasi asli dipisahkan dari layanan.
      // Media non-Spotify (termasuk browser) TIDAK diberi label Spotify.
      const identity = resolveMediaSourceIdentity(track);

      const trackKey = `${track.title}:::${track.artist}`.toLowerCase();
      const isNewTrack = trackKey !== lastMediaTrackKey;
      if (isNewTrack) {
        lastMediaTrackKey = trackKey;
        triggerTrackChangeAnimation();
        localPlaybackPos = track.position_secs;
        lastReportedSystemPos = track.position_secs;
      }

      // ======================================================================
      // PIPELINE ARTWORK SESI MEDIA (satu sesi untuk metadata, sampul, waktu,
      // lirik, dan kontrol). Identitas sesi+rekaman menjadi penjaga konsistensi.
      // ======================================================================
      const sessionIdentity = `${track.session_key || ''}#${track.record_key || trackKey}`;
      if (sessionIdentity !== lastSessionIdentity) {
        lastSessionIdentity = sessionIdentity;
        const artToken = ++artworkRequestToken;
        const artworkKey = sessionIdentity;

        // 1. Kosongkan cover lama seketika dan reset metadata artwork rekaman sebelumnya
        lyricsService.onSystemRecordChanged(
          artworkKey,
          {
            title: track.title,
            artist: track.artist,
            album: track.album,
            durationSecs: track.duration_secs,
          },
          track.has_thumbnail === true
        );

        // 2. Ambil thumbnail dari sesi media yang sama (bukan dari pencarian luar)
        void (async () => {
          const art = await mediaBridge?.fetchArtwork(track);
          // Abaikan respons yang terlambat setelah lagu/sesi berganti
          if (artToken !== artworkRequestToken) return;

          const applied = art
            ? lyricsService.applySessionArtworkData(
                artworkKey,
                art.data_base64,
                art.mime_type,
                { title: track.title, artist: track.artist }
              )
            : false;

          if (!applied) {
            // Thumbnail tidak tersedia / gagal dibaca / format tidak didukung:
            // tahan placeholder, lalu coba fallback pencarian terverifikasi (opsional)
            lyricsService.notifySessionArtworkUnavailable(artworkKey);
            void lyricsService.requestSearchArtworkFallback({
              title: track.title,
              artist: track.artist,
              album: track.album,
              durationSecs: track.duration_secs,
              identityKey: artworkKey,
            });
          }
        })();
      }

      currentTrackDuration = track.duration_secs;
      isPlaybackActive = track.is_playing;

      if (!isNewTrack && performance.now() >= seekCooldownUntil) {
        // Jika sistem melaporkan posisi baru yang berbeda dari laporan sistem sebelumnya
        if (track.position_secs !== lastReportedSystemPos) {
          const diff = Math.abs(track.position_secs - localPlaybackPos);
          // Jika perbedaan cukup besar (pengguna seek di Spotify desktop) atau lompat mundur lebih dari 1 detik
          if (diff > 2.0 || track.position_secs < localPlaybackPos - 1.0) {
            localPlaybackPos = track.position_secs;
          } else {
            // Selisih kecil: kalibrasi lembut mendekati posisi sistem
            localPlaybackPos = track.position_secs;
          }
          lastReportedSystemPos = track.position_secs;
        } else {
          // Sistem mengembalikan posisi yang sama (cache/statis):
          // JANGAN menimpa localPlaybackPos jika musik sedang berjalan!
          // Waktu lokal mandiri tetap terus melaju mulus.
        }
      }

      // Tampilkan sampul (dari sesi aktif / pencarian terverifikasi) tanpa render ulang tiap polling
      syncAlbumArtRender(identity, currentCustomArtUrl, currentArtSource, true);

      const sourceBadge = document.querySelector<HTMLElement>('#music-source-badge');
      if (sourceBadge) {
        sourceBadge.innerText = identity.badgeText;
        sourceBadge.className = identity.isSpotifyVerified
          ? 'session-badge badge-green'
          : 'session-badge badge-purple';
      }

      const titleEl = document.querySelector<HTMLElement>('#music-track-title');
      if (titleEl) titleEl.innerText = track.title;

      const artistEl = document.querySelector<HTMLElement>('#music-track-artist');
      if (artistEl) artistEl.innerText = track.artist || track.album || identity.appName;

      const compactTrack = document.querySelector<HTMLElement>('#compact-track');
      if (compactTrack) {
        compactTrack.innerText = track.artist ? `${track.title} · ${track.artist}` : track.title;
      }

      const cardTag = document.querySelector<HTMLElement>('#music-card-tag');
      if (cardTag && !cardTag.innerText.includes('LIRIK')) {
        cardTag.innerText = `${identity.badgeText} · INFO`;
      }

      // Muat lirik daring dari LRCLIB dengan durasi rekaman untuk mencocokkan versi lagu
      lyricsService.loadLyrics(track.title, track.artist, track.album, track.is_playing, localPlaybackPos, track.duration_secs);

      // Perbarui tampilan waktu dan progres
      updateMusicProgressUI(localPlaybackPos, currentTrackDuration);

      if (track.is_playing) {
        startPlaybackTicker();
      } else {
        stopPlaybackTicker();
      }

      if (btnToggle) {
        btnToggle.innerText = track.is_playing ? '❚❚' : '▶';
      }
      if (dancingMomo) {
        dancingMomo.style.animationPlayState = track.is_playing ? 'running' : 'paused';
      }
      stageEl?.classList.toggle('playing', track.is_playing);
      setEqualizerPlaying(track.is_playing);
      renderer?.setMusicPlaying(track.is_playing);
      renderer?.setAmbientMode(null);

      // Hentikan synth lokal jika media sistem sedang aktif dan memutar suara
      if (isAudioPlaying && track.is_playing) {
        audio.stop();
        isAudioPlaying = false;
      }
    } else {
      isSystemMediaActive = false;
      isPlaybackActive = false;
      stopPlaybackTicker();
      localPlaybackPos = 0;
      lastReportedSystemPos = -1;
      // Batalkan permintaan artwork yang masih berjalan dan bersihkan sampul
      artworkRequestToken++;
      lastSessionIdentity = '';
      currentCustomArtUrl = null;
      currentArtSource = 'none';
      renderMusicAlbumArt(null, null, 'none');
      lastCoverRenderKey = 'inactive';

      const progressFill = document.querySelector<HTMLElement>('#music-progress-fill');
      const timeCurrent = document.querySelector<HTMLElement>('#music-time-current');
      const timeTotal = document.querySelector<HTMLElement>('#music-time-total');
      if (progressFill) progressFill.style.width = '0%';
      if (timeCurrent) timeCurrent.innerText = '00:00';
      if (timeTotal) timeTotal.innerText = '00:00';

      const compactThumb = document.querySelector<HTMLImageElement>('#compact-album-thumb');
      if (compactThumb) compactThumb.style.display = 'none';

      const artistAvatar = document.querySelector<HTMLImageElement>('#music-artist-avatar');
      if (artistAvatar) artistAvatar.style.display = 'none';

      if (!isAudioPlaying) {
        const localTrack = ambientTracks[currentTrackIdx];
        const sourceBadge = document.querySelector<HTMLElement>('#music-source-badge');
        if (sourceBadge) {
          sourceBadge.innerText = 'AMBIENT FOREST';
          sourceBadge.className = 'session-badge badge-purple';
        }

        const titleEl = document.querySelector<HTMLElement>('#music-track-title');
        if (titleEl) titleEl.innerText = localTrack.title;

        const artistEl = document.querySelector<HTMLElement>('#music-track-artist');
        if (artistEl) artistEl.innerText = localTrack.artist;

        const compactTrack = document.querySelector<HTMLElement>('#compact-track');
        if (compactTrack) compactTrack.innerText = localTrack.title;

        const cardTag = document.querySelector<HTMLElement>('#music-card-tag');
        if (cardTag) cardTag.innerText = 'LYRICS / AMBIENT';

        lyricsService.setAmbientTrack(localTrack.id, false);

        if (btnToggle) btnToggle.innerText = '▶';
        if (dancingMomo) dancingMomo.style.animationPlayState = 'paused';
        stageEl?.classList.remove('playing');
        setEqualizerPlaying(false);
      }
    }
  });

  // Daftarkan aksi klik pada bilah progres musik untuk seek posisi lagu
  const progressTrack = document.querySelector<HTMLElement>('#music-progress-track');
  progressTrack?.addEventListener('click', async (e: MouseEvent) => {
    const track = mediaBridge?.getCurrentTrack();
    if (!track || !isSystemMediaActive || !track.duration_secs || track.duration_secs <= 0) return;

    const rect = progressTrack.getBoundingClientRect();
    const clickX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const ratio = rect.width > 0 ? clickX / rect.width : 0;
    const targetPos = ratio * track.duration_secs;

    const prevPos = localPlaybackPos;
    // Beri preview visual sementara pada progres bar
    const progressFill = document.querySelector<HTMLElement>('#music-progress-fill');
    if (progressFill) progressFill.style.width = `${ratio * 100}%`;

    // Kirim permintaan seek dan periksa konfirmasi keberhasilan dari Spotify
    const success = await mediaBridge?.seekTo(targetPos);
    if (success) {
      localPlaybackPos = targetPos;
      lastReportedSystemPos = targetPos;
      seekCooldownUntil = performance.now() + 800;
      updateMusicProgressUI(targetPos, currentTrackDuration);
    } else {
      // Jika perintah seek gagal atau ditolak oleh sistem, pulihkan tampilan ke posisi sebenarnya
      updateMusicProgressUI(prevPos, currentTrackDuration);
    }
  });

  // Mulai memantau status sesi media OS setiap 1 detik
  mediaBridge.startPolling(1000);

  btnToggle?.addEventListener('click', async () => {
    if (isSystemMediaActive && mediaBridge) {
      await mediaBridge.togglePlay();
    } else {
      isAudioPlaying = !isAudioPlaying;
      const currentAmbient = ambientTracks[currentTrackIdx].id;
      if (isAudioPlaying) {
        btnToggle.innerText = '❚❚';
        audio.play(currentAmbient);
        if (dancingMomo) dancingMomo.style.animationPlayState = 'running';
        stageEl?.classList.add('playing');
        setEqualizerPlaying(true);
        renderer?.setMusicPlaying(true);
        renderer?.setAmbientMode(currentAmbient);
        lyricsService.setAmbientTrack(currentAmbient, true);
      } else {
        btnToggle.innerText = '▶';
        audio.stop();
        if (dancingMomo) dancingMomo.style.animationPlayState = 'paused';
        stageEl?.classList.remove('playing');
        setEqualizerPlaying(false);
        renderer?.setMusicPlaying(false);
        lyricsService.setAmbientTrack(currentAmbient, false);
      }
    }
  });

  const changeTrack = (delta: number) => {
    currentTrackIdx = (currentTrackIdx + delta + ambientTracks.length) % ambientTracks.length;
    const track = ambientTracks[currentTrackIdx];

    triggerTrackChangeAnimation();

    const titleEl = document.querySelector<HTMLElement>('#music-track-title');
    if (titleEl) titleEl.innerText = track.title;

    const artistEl = document.querySelector<HTMLElement>('#music-track-artist');
    if (artistEl) artistEl.innerText = track.artist;

    const compactTrack = document.querySelector<HTMLElement>('#compact-track');
    if (compactTrack) compactTrack.innerText = track.title;

    if (isAudioPlaying) {
      audio.play(track.id);
      renderer?.setAmbientMode(track.id);
      lyricsService.setAmbientTrack(track.id, true);
    } else {
      lyricsService.setAmbientTrack(track.id, false);
    }
  };

  btnPrev?.addEventListener('click', async () => {
    if (isSystemMediaActive && mediaBridge) {
      await mediaBridge.prevTrack();
    } else {
      changeTrack(-1);
    }
  });

  btnNext?.addEventListener('click', async () => {
    if (isSystemMediaActive && mediaBridge) {
      await mediaBridge.nextTrack();
    } else {
      changeTrack(1);
    }
  });
}

// ============================================================================
// 7. KONTROL WINDOW & NOTCH NATIVE
// ============================================================================
function bindWindowAndNotchControls() {
  // Tombol Pin Always on Top
  const btnPin = document.querySelector<HTMLButtonElement>('#btn-pin-always-on-top');
  if (btnPin) {
    btnPin.addEventListener('click', async (e) => {
      e.stopPropagation();
      isAlwaysOnTopActive = !isAlwaysOnTopActive;
      btnPin.classList.toggle('active', isAlwaysOnTopActive);
      btnPin.title = isAlwaysOnTopActive
        ? 'Selalu di Atas (Always on Top): Aktif'
        : 'Selalu di Atas (Always on Top): Nonaktif';
      if (isTauri()) {
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          await invoke('set_always_on_top', { alwaysOnTop: isAlwaysOnTopActive });
        } catch (_err) {
          // ignore
        }
      }
    });
  }

  // Pertegas status Always on Top saat window mendapatkan fokus kembali
  window.addEventListener('focus', async () => {
    if (isAlwaysOnTopActive && isTauri()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('set_always_on_top', { alwaysOnTop: true });
      } catch (_e) {
        // ignore
      }
    }
  });

  // Tombol minimize [-] -> compact notch
  document.querySelector('#btn-minimize-notch')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    setIslandState('compact');
  });

  // Tombol sembunyikan [x] -> hidden/minimal notch
  document.querySelector('#btn-close-notch')?.addEventListener('click', (e) => {
    e.stopPropagation();
    setIslandState('hidden');
  });

  // Tombol keluar aplikasi [⏻]
  document.querySelector('#btn-header-quit')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (isTauri()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('close_app');
      } catch (_e) {
        window.close();
      }
    } else {
      alert('Untuk keluar, tutup tab atau jendela peramban.');
    }
  });

  // Tombol expand di compact [v] -> expanded
  document.querySelector('#btn-compact-expand')?.addEventListener('click', (e) => {
    e.stopPropagation();
    setIslandState('expanded');
  });

  // Tombol close di compact [x] -> hidden
  document.querySelector('#btn-compact-close')?.addEventListener('click', (e) => {
    e.stopPropagation();
    setIslandState('hidden');
  });

  // Klik di view minimal atau view compact mengembalikan ke expanded
  document.querySelector('#view-minimal')?.addEventListener('click', () => {
    setIslandState('expanded');
  });

  document.querySelector('#view-compact')?.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).tagName !== 'BUTTON') {
      setIslandState('expanded');
    }
  });

  // Klik ganda pada area pegangan notch atau header untuk memastikan panel menempel ke tengah atas
  const snapHandler = async (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, input, select, [role="button"], a')) return;
    if (isTauri()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('snap_to_top_center');
      } catch (_e) {
        // Abaikan
      }
    }
  };
  document.querySelector<HTMLElement>('#view-minimal')?.addEventListener('dblclick', snapHandler);
  document.querySelector<HTMLElement>('#view-compact')?.addEventListener('dblclick', snapHandler);
  document.querySelector<HTMLElement>('header.panel-header')?.addEventListener('dblclick', snapHandler);
}

// ============================================================================
// 8. MODAL DIALOG PENGATURAN POMODORO & WIDGET
// ============================================================================
function bindSettingsModal() {
  const modalEl = document.querySelector<HTMLElement>('#modal-settings');
  const btnSessionPill = document.querySelector('#session-pill-clickable');
  const btnDockSettings = document.querySelector('#dock-btn-settings');
  const btnCloseSettings = document.querySelector('#btn-close-settings');
  const btnSaveSettings = document.querySelector('#btn-save-settings');

  const openModal = () => {
    isSettingsModalOpen = true;
    updateSettingsFormInputs();
    updateModalPlanPreview();
    modalEl?.classList.add('active');
    syncTauriWindowState(currentIslandState, true);
  };

  const closeModal = () => {
    isSettingsModalOpen = false;
    modalEl?.classList.remove('active');
    syncTauriWindowState(currentIslandState, false);
  };

  btnSessionPill?.addEventListener('click', openModal);
  btnSessionPill?.addEventListener('keydown', (e: Event) => {
    const ke = e as KeyboardEvent;
    if (ke.key === 'Enter' || ke.key === ' ') {
      ke.preventDefault();
      openModal();
    }
  });
  btnDockSettings?.addEventListener('click', () => {
    setIslandState('expanded');
    openModal();
  });
  btnCloseSettings?.addEventListener('click', closeModal);

  // Perubahan input realtime untuk preview
  const inputs = [
    '#setting-total-hours',
    '#setting-total-mins',
    '#setting-focus-mins',
    '#setting-break-mins',
  ];
  inputs.forEach((id) => {
    const el = document.querySelector(id);
    el?.addEventListener('input', () => updateModalPlanPreview());
    el?.addEventListener('change', () => updateModalPlanPreview());
  });

  const seasonCycleRadio = document.querySelector<HTMLInputElement>('#season-mode-cycle');
  const seasonManualRadio = document.querySelector<HTMLInputElement>('#season-mode-manual');
  const seasonSelectWrapper = document.querySelector<HTMLElement>('#season-select-wrapper');

  seasonCycleRadio?.addEventListener('change', () => {
    if (seasonSelectWrapper) seasonSelectWrapper.style.display = 'none';
  });
  seasonManualRadio?.addEventListener('change', () => {
    if (seasonSelectWrapper) seasonSelectWrapper.style.display = 'block';
  });

  btnSaveSettings?.addEventListener('click', () => {
    saveSettingsFromModal(closeModal);
  });
}

function updateSettingsFormInputs() {
  const cfg = appState.config;
  const hours = Math.floor(cfg.totalDurationMin / 60);
  const mins = cfg.totalDurationMin % 60;

  const hInput = document.querySelector<HTMLInputElement>('#setting-total-hours');
  const mInput = document.querySelector<HTMLSelectElement>('#setting-total-mins');
  const fInput = document.querySelector<HTMLInputElement>('#setting-focus-mins');
  const bInput = document.querySelector<HTMLInputElement>('#setting-break-mins');
  const autoBInput = document.querySelector<HTMLInputElement>('#setting-auto-break');
  const autoFInput = document.querySelector<HTMLInputElement>('#setting-auto-focus');

  if (hInput) hInput.value = String(hours);
  if (mInput) mInput.value = String(mins);
  if (fInput) fInput.value = String(cfg.focusDurationMin);
  if (bInput) bInput.value = String(cfg.breakDurationMin);
  if (autoBInput) autoBInput.checked = cfg.autostartBreak;
  if (autoFInput) autoFInput.checked = cfg.autostartNextFocus;

  const seasonCycleRadio = document.querySelector<HTMLInputElement>('#season-mode-cycle');
  const seasonManualRadio = document.querySelector<HTMLInputElement>('#season-mode-manual');
  const seasonSelectWrapper = document.querySelector<HTMLElement>('#season-select-wrapper');
  const manualSeasonSelect = document.querySelector<HTMLSelectElement>('#setting-manual-season');
  const seasonBadge = document.querySelector<HTMLElement>('#season-status-badge');

  const isCycle = cfg.seasonMode !== 'manual';
  if (seasonCycleRadio) seasonCycleRadio.checked = isCycle;
  if (seasonManualRadio) seasonManualRadio.checked = !isCycle;
  if (seasonSelectWrapper) seasonSelectWrapper.style.display = isCycle ? 'none' : 'block';
  if (manualSeasonSelect) manualSeasonSelect.value = appState.progress.currentSeason || 'spring';

  if (seasonBadge) {
    const seasonNames: Record<IslandSeason, string> = {
      spring: 'Semi',
      summer: 'Panas',
      autumn: 'Gugur',
      winter: 'Dingin',
    };
    const sName = seasonNames[appState.progress.currentSeason || 'spring'] || 'Semi';
    if (isCycle) {
      seasonBadge.innerText = `${sName} · Siklus ${appState.progress.seasonCycleCount || 0}/6 Sesi`;
    } else {
      seasonBadge.innerText = `${sName} (Manual)`;
    }
  }

  const autoAppInput = document.querySelector<HTMLInputElement>('#setting-autostart-app');
  if (autoAppInput) {
    isAutostartEnabled().then((enabled) => {
      autoAppInput.checked = enabled;
    }).catch(() => {
      autoAppInput.checked = false;
    });
  }
}

function updateModalPlanPreview() {
  const h = parseInt((document.querySelector<HTMLInputElement>('#setting-total-hours')?.value || '4'), 10) || 0;
  const m = parseInt((document.querySelector<HTMLSelectElement>('#setting-total-mins')?.value || '0'), 10) || 0;
  const focus = parseInt((document.querySelector<HTMLInputElement>('#setting-focus-mins')?.value || '30'), 10) || 30;
  const brk = parseInt((document.querySelector<HTMLInputElement>('#setting-break-mins')?.value || '10'), 10) || 10;

  const totalMin = h * 60 + m;
  const validation = validatePomodoroInput(totalMin, focus, brk);

  const summaryEl = document.querySelector<HTMLElement>('#preview-plan-summary');
  const trackEl = document.querySelector<HTMLElement>('#modal-preview-timeline-track');
  const alertEl = document.querySelector<HTMLElement>('#preview-shortened-alert');
  const cardTotalEl = document.querySelector<HTMLElement>('#summary-card-total');
  const cardFocusEl = document.querySelector<HTMLElement>('#summary-card-focus');
  const cardBreakEl = document.querySelector<HTMLElement>('#summary-card-break');
  const rangeMetaEl = document.querySelector<HTMLElement>('#preview-total-duration-label');
  const activeSessionTextEl = document.querySelector<HTMLElement>('#preview-active-session-text');
  const footerStatsEl = document.querySelector<HTMLElement>('#modal-footer-stats');

  if (!validation.isValid) {
    if (summaryEl) {
      summaryEl.innerText = `Peringatan: ${validation.errorMessage}`;
      summaryEl.style.color = '#ff8080';
    }
    if (alertEl) alertEl.style.display = 'none';
    if (trackEl) trackEl.innerHTML = '';
    return;
  }

  if (summaryEl) {
    summaryEl.style.color = '';
  }

  const plan = buildPomodoroPlan(totalMin, focus, brk);

  // Update elemen sesuai Figma 1:1
  if (summaryEl) {
    summaryEl.innerText = `${plan.focusSessionCount} sesi Fokus`;
  }

  if (cardTotalEl) {
    const th = Math.floor(plan.totalDurationMin / 60);
    const tm = plan.totalDurationMin % 60;
    cardTotalEl.innerText = tm > 0 ? `${th} jam ${tm} m` : `${th} jam`;
  }

  if (cardFocusEl) {
    const fh = Math.floor(plan.totalFocusMin / 60);
    const fm = plan.totalFocusMin % 60;
    cardFocusEl.innerText = fh > 0 ? (fm > 0 ? `${fh} jam ${fm} menit` : `${fh} jam`) : `${fm} menit`;
  }

  if (cardBreakEl) {
    cardBreakEl.innerText = `${plan.totalBreakMin} menit`;
  }

  if (rangeMetaEl) {
    rangeMetaEl.innerText = `${plan.totalDurationMin} menit`;
  }

  if (activeSessionTextEl) {
    activeSessionTextEl.innerText = `Putaran 1 · Fokus ${plan.focusDurationMin} menit · Menit 0-${plan.focusDurationMin}`;
  }

  if (footerStatsEl) {
    footerStatsEl.innerText = `${plan.totalDurationMin} menit total · ${plan.totalFocusMin} menit fokus · ${plan.totalBreakMin} menit istirahat`;
  }

  if (alertEl) {
    const hasShortened = plan.phases.some((p) => p.isShortened);
    alertEl.style.display = hasShortened ? 'inline-block' : 'none';
  }

  if (trackEl) {
    renderTimelineSegments(trackEl, plan, -1);
  }
}

function saveSettingsFromModal(onSuccess: () => void) {
  const h = parseInt((document.querySelector<HTMLInputElement>('#setting-total-hours')?.value || '4'), 10) || 0;
  const m = parseInt((document.querySelector<HTMLInputElement>('#setting-total-mins')?.value || '0'), 10) || 0;
  const focus = parseInt((document.querySelector<HTMLInputElement>('#setting-focus-mins')?.value || '30'), 10) || 30;
  const brk = parseInt((document.querySelector<HTMLInputElement>('#setting-break-mins')?.value || '10'), 10) || 10;

  const totalMin = h * 60 + m;

  // Validasi input batas waktu menggunakan validator resmi mesin
  const validation = validatePomodoroInput(totalMin, focus, brk);
  if (!validation.isValid) {
    alert(validation.errorMessage || 'Pengaturan durasi tidak valid.');
    return;
  }

  const autoBreak = document.querySelector<HTMLInputElement>('#setting-auto-break')?.checked ?? true;
  const autoFocus = document.querySelector<HTMLInputElement>('#setting-auto-focus')?.checked ?? true;
  const autoApp = document.querySelector<HTMLInputElement>('#setting-autostart-app')?.checked ?? false;

  const waterTarget = parseInt((document.querySelector<HTMLInputElement>('#setting-water-target')?.value || '2000'), 10) || 2000;
  const waterInterval = parseInt((document.querySelector<HTMLInputElement>('#setting-water-interval')?.value || '45'), 10) || 45;
  const soundEnabled = document.querySelector<HTMLInputElement>('#setting-sound-enabled')?.checked ?? true;

  if (waterTarget < 100 || waterTarget > 10000) {
    alert('Target minum air harian harus antara 100 ml dan 10.000 ml.');
    return;
  }
  if (waterInterval < 1 || waterInterval > 360) {
    alert('Interval pengingat minum harus antara 1 dan 360 menit.');
    return;
  }

  const isSeasonManual = document.querySelector<HTMLInputElement>('#season-mode-manual')?.checked ?? false;
  const chosenSeasonMode: SeasonMode = isSeasonManual ? 'manual' : 'cycle';
  const chosenManualSeason = (document.querySelector<HTMLSelectElement>('#setting-manual-season')?.value || 'spring') as IslandSeason;

  const tempPlan = buildPomodoroPlan(totalMin, focus, brk);

  const newConfig: PomodoroConfig = {
    totalDurationMin: totalMin,
    focusDurationMin: focus,
    breakDurationMin: brk,
    autostartBreak: autoBreak,
    autostartNextFocus: autoFocus,
    soundEnabled,
    volume: appState.config.volume ?? 0.5,
    alwaysOnTop: true,
    targetDailySessions: tempPlan.focusSessionCount,
    dailyWaterTargetMl: waterTarget,
    hydrationReminderIntervalMin: waterInterval,
    seasonMode: chosenSeasonMode,
  };

  // Jika timer sedang aktif berjalan atau jeda, konfirmasi kepada pengguna
  const isTimerActive = engine.getStatus() === 'running' || engine.getStatus() === 'paused';
  if (isTimerActive) {
    const confirmChange = confirm(
      'Sesi timer sedang berjalan. Terapkan rencana baru sekarang dan mulai ulang sesi?'
    );
    if (!confirmChange) {
      return;
    }
  }

  // Hitung ulang jadwal pengingat minum jika interval diubah
  const oldWaterInterval = appState.config.hydrationReminderIntervalMin || 45;
  if (oldWaterInterval !== waterInterval) {
    appState.nextHydrationReminderTimestamp = Date.now() + waterInterval * 60 * 1000;
    hasNotifiedHydrationDue = false;
  }

  // Terapkan autostart sistem hanya setelah validasi dan konfirmasi berhasil disetujui
  setAutostartEnabled(autoApp).catch((err) => {
    console.warn('Gagal memperbarui status autostart aplikasi:', err);
  });

  appState.config = newConfig;
  if (chosenSeasonMode === 'manual') {
    appState.progress.currentSeason = chosenManualSeason;
    renderer?.setSeason(chosenManualSeason);
  }
  saveAppState(appState);

  engine.updateConfig(newConfig);
  engine.rebuildPlan();

  syncUI();
  onSuccess();
}

// ============================================================================
// 9. PENGALIH CEPAT STATUS NOTCH (Tester Bar)
// ============================================================================
function bindStateSwitcher() {
  document.querySelectorAll<HTMLButtonElement>('.state-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const state = btn.getAttribute('data-state') as IslandState;
      if (state) setIslandState(state);
    });
  });
}

// ============================================================================
// 10. TICKER JAM DESKTOP & PEMERIKSAAN PERGANTIAN TANGGAL
// ============================================================================
function bindClockTicker() {
  const updateClock = () => {
    const now = new Date();
    const hours = now.getHours().toString().padStart(2, '0');
    const mins = now.getMinutes().toString().padStart(2, '0');
    const timeStr = `${hours}:${mins}`;

    // Wallpaper ambient clock
    const ambientTimeEl = document.querySelector<HTMLElement>('#ambient-time');
    if (ambientTimeEl) ambientTimeEl.innerText = timeStr;

    // Top status bar
    const topClockEl = document.querySelector<HTMLElement>('#desktop-date-clock');
    if (topClockEl) {
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const dayName = days[now.getDay()];
      const monthName = months[now.getMonth()];
      const dateNum = now.getDate();
      topClockEl.innerText = `${dayName} ${dateNum} ${monthName} · ${timeStr}`;
    }

    // Pemeriksaan pergantian hari lokal (termasuk jika laptop tetap menyala melewati tengah malam)
    const today = getTodayDateString();
    if (today !== lastKnownDate) {
      handleMidnightRollover(today);
      lastKnownDate = today;
    }

    // Status pengingat minum
    const isDue = Date.now() >= appState.nextHydrationReminderTimestamp;
    if (isDue && !hasNotifiedHydrationDue) {
      updateHydrationUI();
    }
    const compactDrop = document.querySelector<HTMLElement>('#compact-water-drop');
    if (compactDrop) {
      compactDrop.classList.toggle('active', isDue);
    }

    const hydrationTab = document.querySelector<HTMLButtonElement>('#tab-btn-hydration');
    if (hydrationTab) {
      if (isDue && currentTab !== 'hydration') {
        hydrationTab.style.boxShadow = '0 0 10px rgba(113, 186, 131, 0.9)';
        hydrationTab.title = 'Waktunya minum air!';
      } else {
        hydrationTab.style.boxShadow = '';
        hydrationTab.title = '';
      }
    }
  };

  updateClock();
  setInterval(updateClock, 1000);
}

function handleMidnightRollover(today: string) {
  if (isYesterday(appState.lastActiveDate)) {
    appState.progress.currentStreakDays++;
  } else {
    appState.progress.currentStreakDays = 1;
  }

  appState.progress.completedSessionsToday = 0;
  appState.progress.growthStage = 0;
  appState.progress.hydrationGlasses = 0;
  appState.waterMl = 0;
  appState.lastActiveDate = today;
  appState.nextHydrationReminderTimestamp =
    Date.now() + (appState.config.hydrationReminderIntervalMin || 45) * 60 * 1000;

  saveAppState(appState);
  syncUI();
}
