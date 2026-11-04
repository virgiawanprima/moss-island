import { PetPerformance } from './petPerformance';
import { parseSettingsDuration, hasScheduleChanged } from './settings';
import { TabTransition } from './tabTransition';
import {
  IslandState,
  ActiveTab,
  PomodoroConfig,
  PlanPhase,
  PomodoroPlan,
  TimerStatus,
  StoredAppState,
  IslandSeason,
} from './types';
import { IslandRenderer } from './canvas/islandRenderer';
import { PomodoroEngine } from './timer/pomodoroEngine';
import { buildPomodoroPlan, getFirstPhasePreview, getNextPhaseLabel } from './timer/pomodoroPlan';
import { AmbientSynth, AMBIENT_TRACKS } from './audio/ambientSynth';
import { STUDY_COVERS } from './audio/studyMusic';
import { formatPlaybackTime } from './audio/formatPlaybackTime';
import { mountMusicMomo } from './audio/musicMomoView';
import { SpeakerBeat } from './audio/speakerBeat';
import type { MomoPlayback } from './audio/musicMomo';
import { shouldIgnoreAmbiguousWebViewSession, takeOverLocalPlayback } from './audio/musicSource';
import { DeviceVolumeSync } from './audio/deviceVolumeSync';
import { SystemMediaBridge } from './audio/systemMediaBridge';
import { ArtworkRetry } from './audio/artworkRetry';
import { advancePlayback, reconcilePlayback } from './audio/playbackPosition';
import { lyricsService } from './audio/lyricsService';
import { LyricsView } from './audio/lyricsView';
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
import { HoverIntent } from './hoverIntent';
import { isVerticalDock, dockWithinThreshold, type DockPlacement } from './edgeDock';
import { renderRestPhase } from './timer/restView';
import { restingPet, rigDesktopPet, mountPetGait, stepDesktopPet, type PetContext } from './desktopPet';

// Inisialisasi status aplikasi dari penyimpanan persisten
let appState: StoredAppState = loadAppState();
export let currentIslandState: IslandState = 'expanded';
export let currentTab: ActiveTab = 'focus';
let musicMomo: ReturnType<typeof mountMusicMomo> | null = null;

// Modul-modul utama
let renderer: IslandRenderer | null = null;
let engine: PomodoroEngine;
let audio: AmbientSynth;
let mediaBridge: SystemMediaBridge | null = null;
let isAudioPlaying: boolean = false;
let isSystemMediaActive: boolean = false;
let petMusicPlaying = false;
let isAlwaysOnTopActive: boolean = appState.config.alwaysOnTop ?? true;
let isSettingsModalOpen: boolean = false;
let lastKnownDate: string = getTodayDateString();

const ambientTracks = AMBIENT_TRACKS;
let currentTrackIdx: number = 0;
const MINIMAL_POSITION_KEY = 'moss_minimal_position_v1';
const DOCK_EDGE_KEY = 'moss_dock_edge_v1';
function readDockEdge(): DockPlacement {
  try {
    const edge = localStorage.getItem(DOCK_EDGE_KEY);
    if (edge === 'floating' || edge === 'top' || edge === 'bottom' || edge === 'left' || edge === 'right') return edge;
  } catch { /* Gunakan tepi atas bila penyimpanan tidak tersedia. */ }
  return 'top';
}
let dockEdge: DockPlacement = readDockEdge();
function applyDockEdge(edge: DockPlacement) {
  dockEdge = edge;
  document.documentElement.dataset.dockEdge = edge;
  try { localStorage.setItem(DOCK_EDGE_KEY, edge); } catch { /* Orientasi tetap berlaku selama sesi. */ }
}
let petMoveInFlight: Promise<void> | null = null;
let petAutomaticUntil = 0;
let petManualUntil = 0;
let nativeGeometryWrites = 0;
let nativeGeometryQuietUntil = 0;
let minimalPositionMemory: { x: number; y: number } | null = null;
function readMinimalPosition(): { x: number; y: number } | null {
  if (minimalPositionMemory) return minimalPositionMemory;
  try {
    const value: unknown = JSON.parse(localStorage.getItem(MINIMAL_POSITION_KEY) || 'null');
    if (value && typeof value === 'object' && 'x' in value && 'y' in value
      && typeof value.x === 'number' && Number.isFinite(value.x)
      && typeof value.y === 'number' && Number.isFinite(value.y)) return minimalPositionMemory = { x: value.x, y: value.y };
  } catch { /* Penyimpanan yang rusak tidak boleh menghalangi pembukaan aplikasi. */ }
  return minimalPositionMemory;
}

function saveMinimalPosition(position: { x: number; y: number }) {
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) return;
  minimalPositionMemory = position;
  try { localStorage.setItem(MINIMAL_POSITION_KEY, JSON.stringify(position)); }
  catch { console.warn('Posisi Momo tidak dapat disimpan untuk sesi berikutnya.'); }
}

async function rememberMinimalWindowPosition(): Promise<void> {
  if (!isTauri()) return;
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const nativeWindow = getCurrentWindow();
    const [position, size] = await Promise.all([nativeWindow.outerPosition(), nativeWindow.outerSize()]);
    saveMinimalPosition({ x: position.x + size.width / 2, y: position.y + size.height / 2 });
  } catch (error) { console.warn('Posisi Momo tidak dapat dibaca:', error); }
}

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

  // 4b. Pulihkan sesi timer yang belum selesai dari snapshot (aplikasi ditutup,
  // crash, atau komputer direstart). Kebijakan waktu konsisten dengan kebijakan
  // tidur: fase berjalan dilanjutkan dari deadline tersimpan.
  const savedTimerSession = appState.timerSession ?? null;
  if (savedTimerSession) {
    const restored = engine.restoreFromSnapshot(savedTimerSession);
    if (restored) {
      console.info('Sesi timer dipulihkan dari snapshot tersimpan.');
    } else {
      console.info('Snapshot timer diabaikan karena tidak cocok dengan pengaturan saat ini.');
    }
    appState.timerSession = engine.getSnapshot();
    saveAppState(appState);
  }

  // 5. Hubungkan Pengendali UI & Navigasi
  bindTabs();
  bindTimerControls();
  bindMusicControls();
  bindWindowAndNotchControls();
  bindSettingsModal();
  bindStateSwitcher();
  bindClockTicker();

  // Sinkronisasi status awal UI
  syncUI();

  // Simpan snapshot timer saat tab/jendela ditutup agar sesi tidak hilang
  window.addEventListener('pagehide', () => persistTimerSnapshot());
  window.addEventListener('beforeunload', () => persistTimerSnapshot());

  // Dukungan parameter URL untuk pengujian langsung
  const urlParams = new URLSearchParams(window.location.search);
  const initialTab = urlParams.get('tab') as ActiveTab;
  const initialState = urlParams.get('state') as IslandState;
  if (initialTab && ['music', 'focus'].includes(initialTab)) {
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
    await new Promise((r) => { setTimeout(r, 40); });
  }
  if (!isTauri()) return;

  document.body.classList.add('is-tauri-native');
  document.documentElement.classList.add('is-tauri-native');
  applyDockEdge(dockEdge);

  // Posisikan window awal tepat di atas tengah monitor tanpa celah dan pastikan selalu di atas
  // sesuai preferensi pin yang tersimpan (bukan selalu true)
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('set_always_on_top', { alwaysOnTop: isAlwaysOnTopActive });
    const anchor = readMinimalPosition();
    if (anchor) await invoke('move_minimal_window', anchor);
    else await invoke('position_island_top_center', { yOffset: 0.0 });
    if (!isIslandTransitioning) {
      petAutomaticUntil = performance.now() + 500;
      await syncTauriWindowState(currentIslandState, isSettingsModalOpen);
      petAutomaticUntil = performance.now() + 250;
    }
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
    width: 76,
    height: 92,
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
    music: {
      width: 960,
      height: 228,
      minWidth: 640,
      minHeight: 228,
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
  return ISLAND_DIMENSIONS.expanded.focus;
}

async function syncTauriWindowState(state: IslandState, modalOpen: boolean = false) {
  if (!isTauri()) return;

  nativeGeometryWrites++;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const baseDim = getIslandDimension(state, currentTab, modalOpen);
    let dim: IslandDimensionConfig = !modalOpen && isVerticalDock(dockEdge) && state === 'expanded'
      ? { ...baseDim, width: 560, height: currentTab === 'focus' ? 560 : currentTab === 'music' ? 480 : 420, minWidth: 440, minHeight: 320 }
      : !modalOpen && isVerticalDock(dockEdge) && state === 'compact' ? { ...baseDim, width: 96, height: 300 }
      : baseDim;
    const { currentMonitor } = await import('@tauri-apps/api/window');
    const monitor = await currentMonitor();
    if (monitor) {
      const width = Math.min(dim.width, monitor.workArea.size.width / monitor.scaleFactor);
      const height = Math.min(dim.height, monitor.workArea.size.height / monitor.scaleFactor);
      dim = { ...dim, width, height, minWidth: dim.minWidth === null ? null : Math.min(dim.minWidth, width),
        minHeight: dim.minHeight === null ? null : Math.min(dim.minHeight, height) };
    }
    const anchor = readMinimalPosition();

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
        anchorX: anchor?.x ?? null,
        anchorY: anchor?.y ?? null,
      });
    } catch {
      await invoke('set_island_window_size', {
        width: dim.width,
        height: dim.height,
        minWidth: dim.minWidth,
        minHeight: dim.minHeight,
        resizable: dim.resizable,
      });
      if (anchor) await invoke('move_minimal_window', anchor);
      else await invoke('position_island_top_center', { yOffset: 0.0 });
    }

    await invoke('set_always_on_top', { alwaysOnTop: isAlwaysOnTopActive });
  } catch (_e) {
    // Abaikan jika pemanggilan native gagal
  } finally {
    nativeGeometryWrites--;
    nativeGeometryQuietUntil = performance.now() + 250;
  }
}

let activeTransitionToken = 0;
let isIslandTransitioning = false;

export function shouldRememberFloatingPosition(current: IslandState, next: IslandState, placement: DockPlacement = dockEdge): boolean {
  return next !== current && (current === 'hidden' || current === 'compact'
    || (current === 'expanded' && placement === 'floating'));
}

export function shouldCenterAfterTransition(hasSavedPosition: boolean): boolean {
  return !hasSavedPosition;
}

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
  await petMoveInFlight;
  if (token !== activeTransitionToken) return;
  if (shouldRememberFloatingPosition(currentIslandState, state)) {
    await rememberMinimalWindowPosition();
    if (token !== activeTransitionToken) return;
  }
  currentIslandState = state;
  if (!isTauri() && state !== 'hidden') { widget.style.left = ''; widget.style.top = ''; }

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fadeOutDuration = prefersReducedMotion ? 0 : 80;
  const fadeInDuration = prefersReducedMotion ? 0 : 80;

  // 1. TAHAP 1: Redupkan konten aktif lama secara lembut
  widget.classList.add('is-fading-out');
  if (fadeOutDuration > 0) {
    await new Promise((r) => { setTimeout(r, fadeOutDuration); });
  }
  if (token !== activeTransitionToken) return;

  // 2. TAHAP 2: Ubah bentuk panel (window & widget), tahan min-height expanded
  widget.classList.remove('is-fading-out', 'expanded-ready');
  widget.classList.add('is-morphing');
  if (state === 'expanded') {
    widget.classList.remove('tab-focus', 'tab-music');
    widget.classList.add(`tab-${currentTab}`);
  }

  // Dalam mode peramban non-Tauri, perbarui class state sekarang agar transisi CSS berjalan
  if (!isTauri()) {
    widget.classList.remove('state-hidden', 'state-compact', 'state-expanded');
    widget.classList.add(`state-${state}`);
    if (!prefersReducedMotion) {
      await new Promise((r) => { setTimeout(r, 200); });
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
    widget.classList.remove('tab-focus', 'tab-music');
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
    await new Promise((r) => { setTimeout(r, fadeInDuration); });
  }
  if (token !== activeTransitionToken) return;

  isIslandTransitioning = false;

  // Posisi tersimpan sudah diterapkan oleh animasi native.
  if (isTauri() && shouldCenterAfterTransition(readMinimalPosition() !== null)) {
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
  badge.innerText = `${info.currentGenTrees}/${info.maxSlots} pohon`;
  badge.title = `Generasi hutan aktif: ke-${currentGen}. Total pohon permanen yang ditanam: ${info.totalTrees}.`;
}

function syncUI() {
  updateSessionMeta();
  updateTimelineUI();
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
    autoLoopP1.innerText = engine.getStatus() === 'completed'
      ? 'Seluruh fase rencana sudah selesai.'
      : getNextPhaseLabel(plan, engine.getCurrentPhaseIndex(), appState.config);
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

    if (phase.type === 'focus') {
      if (sessionTag) sessionTag.innerText = `Fokus · ${sessionNum}`;
      if (durationTag) {
        durationTag.innerText = `${phase.durationMin} menit`;
      }
    } else {
      if (sessionTag) sessionTag.innerText = `Rehat · ${sessionNum}`;
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

  renderRestPhase(document, currentPhase, remainingSeconds, phaseTotalSeconds, engine.getStatus());
  updateSessionMeta();
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
        captionLabel.innerText = 'Pohon kecilmu sedang tumbuh';
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
  nextPhase?: PlanPhase | null,
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
      nextPhase?.type === 'break'
        ? 'Pohonmu sudah tumbuh. Waktunya istirahat dan minum air dulu.'
        : 'Pohonmu sudah tumbuh. Rencana fokusmu selesai.'
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

// Snapshot timer disimpan pada setiap transisi status penting agar sesi yang
// belum selesai dapat dipulihkan setelah aplikasi ditutup / crash / restart.
function persistTimerSnapshot() {
  if (!engine) return;
  appState.timerSession = engine.getSnapshot();
  saveAppState(appState);
}

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
    if (engine.getCurrentPhase()?.type === 'focus' && renderer && !renderer.hasActiveSprout()) renderer.startFocusPlanting();
    renderer?.setTimerPaused(true);
  } else if (status === 'waiting_next') {
    btnToggle.innerText = engine.getCurrentPhase()?.type === 'break' ? 'Mulai Istirahat' : 'Mulai Fokus';
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
  persistTimerSnapshot();
}

// ============================================================================
// 4. PENGENDALI EVENT UI & TAB
// ============================================================================
function bindTabs() {
  const tabButtons = document.querySelectorAll<HTMLButtonElement>('.pill-tab-btn');
  const widget = document.querySelector<HTMLElement>('#dynamic-island');
  const transition = new TabTransition<ActiveTab>(currentTab, async (targetTab) => {
    const stateToken = activeTransitionToken;
    const expanded = currentIslandState === 'expanded';
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (expanded) {
      isIslandTransitioning = true;
      widget?.classList.add('is-switching-tab');
    }
    try {
      if (expanded && !reducedMotion) {
        await new Promise<void>((resolve) => { setTimeout(resolve, 70); });
      }
      currentTab = targetTab;
      tabButtons.forEach((button) => {
        button.classList.toggle('active', button.getAttribute('data-tab') === targetTab);
      });

      if (widget) {
        widget.classList.remove('tab-focus', 'tab-music');
        widget.classList.add(`tab-${targetTab}`);
      }

      document.querySelectorAll<HTMLElement>('.tab-panel').forEach((panel) => {
        panel.classList.remove('active');
      });
      const activePanel = document.querySelector<HTMLElement>(`#panel-${targetTab}`);
      if (activePanel) activePanel.classList.add('active');

      // Sinkronkan ukuran jendela native sesuai tab yang dipilih saat expanded
      if (currentIslandState === 'expanded') {
        isIslandTransitioning = true;
        await syncTauriWindowState('expanded', isSettingsModalOpen);
        if (!isTauri() && !reducedMotion) {
          await new Promise<void>((resolve) => { setTimeout(resolve, 200); });
        }
      }

      // Hemat render Canvas jika tidak melihat tab Fokus
      if (targetTab === 'focus' && currentIslandState === 'expanded') {
        renderer?.start();
      } else {
        renderer?.pause();
      }
    } finally {
      widget?.classList.remove('is-switching-tab');
      if (stateToken === activeTransitionToken) isIslandTransitioning = false;
    }
  });

  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab') as ActiveTab;
      if (!['focus', 'music'].includes(targetTab)) return;
      void transition.request(targetTab).catch((error: unknown) => {
        console.error('Perpindahan fitur gagal:', error);
      });
    });
  });

  // Dock buttons navigation
  document.querySelector('#dock-btn-focus')?.addEventListener('click', async () => {
    await transition.request('focus');
    await setIslandState('expanded');
  });
  document.querySelector('#dock-btn-music')?.addEventListener('click', async () => {
    await transition.request('music');
    await setIslandState('expanded');
  });
}

function bindTimerControls() {
  const btnToggle = document.querySelector<HTMLButtonElement>('#btn-toggle-timer');
  const btnFinish = document.querySelector<HTMLButtonElement>('#btn-finish-timer');
  const cancelPrompt = document.querySelector<HTMLElement>('#focus-cancel-confirm');
  const actionStack = document.querySelector<HTMLElement>('#panel-focus .actions-stack');
  const keepFocus = document.querySelector<HTMLButtonElement>('#btn-keep-focus');
  const setCancelPrompt = (open: boolean) => {
    if (cancelPrompt) cancelPrompt.hidden = !open;
    if (actionStack) actionStack.hidden = open;
    const details = document.querySelector<HTMLDetailsElement>('#focus-plan-details');
    if (details) details.hidden = open;
    if (open) { if (details) details.open = false; keepFocus?.focus(); }
    else document.querySelector<HTMLElement>('#focus-plan-details > summary')?.focus();
  };
  const cancelPlan = () => {
    setCancelPrompt(false);
    renderer?.cancelFocusSession();
    engine.reset();
    updateSessionMeta();
    updateTimelineUI();
  };
  keepFocus?.addEventListener('click', () => setCancelPrompt(false));
  document.querySelector('#btn-confirm-cancel-focus')?.addEventListener('click', cancelPlan);
  cancelPrompt?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); setCancelPrompt(false); }
  });

  btnToggle?.addEventListener('click', () => {
    engine.toggle();
  });

  btnFinish?.addEventListener('click', () => {
    if (['running', 'paused', 'waiting_next'].includes(engine.getStatus())) {
      setCancelPrompt(true);
      return;
    }
    cancelPlan();
  });
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

/**
 * Memvalidasi URL gambar eksternal sebelum dipakai pada elemen <img>.
 * Hanya protokol aman yang diizinkan; selain itu dikembalikan null.
 */
function safeExternalImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^blob:/i.test(trimmed)) return trimmed;
  if (/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(trimmed)) return trimmed;
  return null;
}

const SPOTIFY_PILL_SVG = `
  <div class="spotify-corner-pill" title="Diputar via Spotify (terverifikasi)">
    <svg viewBox="0 0 48 48" fill="none">
      <circle cx="24" cy="24" r="24" fill="#1ED760"/>
      <path d="M16 19.5C21 17.8 28.5 18.3 33.2 21.2C34 21.7 34.2 22.7 33.7 23.4C33.2 24.1 32.2 24.3 31.5 23.9C27.5 21.4 20.8 21 16.5 22.3C15.7 22.5 14.8 22 14.6 21.2C14.3 20.4 14.8 19.6 16 19.5ZM16.5 24.5C20.8 23.2 27.5 23.7 31.9 26.3C32.5 26.7 32.8 27.6 32.3 28.2C31.9 28.8 31 29.1 30.4 28.6C26.7 26.4 20.8 26 17 27.1C16.2 27.3 15.4 26.9 15.2 26.1C15 25.3 15.6 24.7 16.5 24.5ZM17.2 29.5C20.8 28.4 26.5 28.9 30.3 31.2C30.8 31.5 31.1 32.3 30.7 32.8C30.3 33.3 29.5 33.6 29 33.2C25.8 31.2 20.8 30.8 17.7 31.7C17 31.9 16.3 31.5 16.1 30.9C15.9 30.2 16.5 29.7 17.2 29.5Z" fill="#121212"/>
    </svg>
  </div>`;

function renderMusicAlbumArt(
  identity: MediaSourceIdentity | null,
  customArtUrl?: string | null,
  artSource: ArtworkSource = 'none'
) {
  const artContainer = document.querySelector<HTMLElement>('#music-album-art');
  if (!artContainer) return;
  if (!identity && !customArtUrl) {
    const track = ambientTracks[currentTrackIdx];
    const cover = STUDY_COVERS[track.id];
    artContainer.className = 'album-art-pine';
    artContainer.title = `${track.title} · ${cover.label}`;
    const img = document.createElement('img');
    img.src = cover.file;
    img.alt = cover.label;
    img.width = 64;
    img.height = 64;
    img.style.width = '100%';
    img.style.height = '100%';
    artContainer.replaceChildren(img);
    return;
  }

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
    const safeUrl = safeExternalImageUrl(customArtUrl);
    if (!safeUrl) {
      // Sumber tidak aman/tidak dikenal: tampilkan placeholder, jangan sisipkan URL
      renderMusicAlbumArt(identity, null, 'none');
      return;
    }

    artContainer.className = 'album-art-pine custom-cover-active';
    artContainer.title = coverTitle;
    // Bangun elemen lewat DOM API (bukan interpolasi HTML) agar data dari
    // layanan eksternal tidak pernah diparse sebagai markup
    artContainer.replaceChildren();
    const img = document.createElement('img');
    img.className = 'real-album-cover';
    img.alt = 'Album Art';
    img.src = safeUrl;
    artContainer.appendChild(img);
    if (isVerifiedSpotify) {
      artContainer.insertAdjacentHTML('beforeend', SPOTIFY_PILL_SVG);
    }
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
    artContainer.title = 'Moss Island · Musik instrumental';
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
  return formatPlaybackTime(seconds);
}

function bindMusicControls() {
  const volumeSlider = document.querySelector<HTMLInputElement>('#music-volume');
  const volumeValue = document.querySelector<HTMLOutputElement>('#music-volume-value');
  const volumeLabel = document.querySelector<HTMLLabelElement>('label[for="music-volume"]');
  let deviceVolumeMode = false;
  let volumeModeToken = 0;
  let volumeQueue = Promise.resolve();
  let volumeEditToken = 0;
  const volumeSync = new DeviceVolumeSync();
  const invokeVolume = async (command: string, args?: { volume: number }) => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<number>(command, args);
  };
  const updateVolumeMode = async (external: boolean) => {
    const changed = deviceVolumeMode !== external;
    if (!changed && !external) return;
    deviceVolumeMode = external;
    if (changed) {
      ++volumeModeToken;
      volumeSync.invalidate();
    }
    const token = volumeModeToken;
    if (volumeLabel) volumeLabel.textContent = external ? 'Volume perangkat' : 'Volume bawaan';
    if (!volumeSlider) return;
    volumeSlider.setAttribute('aria-label', external ? 'Volume perangkat Windows, semua aplikasi' : 'Volume musik bawaan');
    volumeSlider.title = external ? 'Mengatur keluaran Windows untuk semua aplikasi' : 'Mengatur musik bawaan Moss Island';
    if (changed) volumeSlider.disabled = external;
    await volumeSync.refresh(
      async () => external ? invokeVolume('get_device_volume') : audio.getVolume(),
      (value) => {
        if (token !== volumeModeToken) return;
        volumeSlider.value = String(Math.round(value * 100));
        if (volumeValue) volumeValue.value = volumeSlider.value + '%';
        volumeSlider.disabled = false;
      },
      () => {
        if (token !== volumeModeToken) return;
        if (volumeValue) volumeValue.value = 'Tidak tersedia';
        volumeSlider.title = 'Volume perangkat tidak dapat dibaca. Periksa perangkat keluaran Windows.';
      }, performance.now(), changed);
  };
  audio.setVolume(appState.config.volume ?? 0.5);
  if (volumeSlider) {
    volumeSlider.value = String(Math.round(audio.getVolume() * 100));
    if (volumeValue) volumeValue.value = volumeSlider.value + '%';
    volumeSlider.addEventListener('input', () => {
      const volume = Number(volumeSlider.value) / 100;
      if (deviceVolumeMode) {
        const mode = volumeModeToken;
        const edit = ++volumeEditToken;
        volumeSync.beginWrite();
        if (volumeValue) volumeValue.value = volumeSlider.value + '%';
        volumeQueue = volumeQueue.then(async () => {
          try {
            if (mode !== volumeModeToken || edit !== volumeEditToken) return;
            const actual = await invokeVolume('set_device_volume', { volume });
            if (mode !== volumeModeToken || edit !== volumeEditToken) return;
            volumeSlider.value = String(Math.round(actual * 100));
            if (volumeValue) volumeValue.value = volumeSlider.value + '%';
          } catch {
            if (mode === volumeModeToken && volumeValue) volumeValue.value = 'Gagal';
          } finally {
            volumeSync.endWrite();
          }
        });
        return;
      }
      audio.setVolume(volume);
      appState.config.volume = volume;
      if (volumeValue) volumeValue.value = volumeSlider.value + '%';
    });
    volumeSlider.addEventListener('change', () => { if (!deviceVolumeMode) saveAppState(appState); });
  }
  const btnToggle = document.querySelector<HTMLButtonElement>('#btn-music-toggle');
  const btnPrev = document.querySelector<HTMLButtonElement>('#btn-music-prev');
  const btnNext = document.querySelector<HTMLButtonElement>('#btn-music-next');
  const momoButton = document.querySelector<HTMLButtonElement>('#dancing-momo');
  const speaker = new SpeakerBeat(() => musicMomo?.beat(true), text => {
    const status = document.querySelector<HTMLElement>('#speaker-beat-status');
    if (status) status.textContent = text;
  });
  if (momoButton) musicMomo = mountMusicMomo(momoButton, () => appState.config.momoIntensity ?? 'expressive',
    visible => speaker.setActive(visible));
  window.addEventListener('pagehide', () => speaker.setActive(false));
  audio.onBeat = null;
  audio.setBeatVisible(false);
  const stageEl = document.querySelector<HTMLElement>('#music-momo-stage');
  const repeatButton = document.querySelector<HTMLButtonElement>('#btn-music-repeat');
  const sessionSelect = document.querySelector<HTMLSelectElement>('#music-session-select');
  const musicStatus = document.querySelector<HTMLElement>('#music-action-status');
  let mediaCommandPending = false;

  let endedMomoRecord = '';
  const momoRecord = () => {
    const track = mediaBridge?.getCurrentTrack();
    return isSystemMediaActive && track ? `${track.session_key}#${track.record_key}` : `local:${ambientTracks[currentTrackIdx].id}`;
  };
  function setPlaybackAppearance(playing: boolean, state: MomoPlayback = playing ? 'playing' : 'paused') {
    const key = momoRecord();
    if (playing || key !== endedMomoRecord) endedMomoRecord = '';
    musicMomo?.controller.setPlayback(endedMomoRecord === key && state === 'paused' ? 'ended' : state, key);
    const minimal = document.querySelector<HTMLElement>('#view-minimal');
    if (minimal) minimal.dataset.playing = String(playing && state === 'playing');
    if (!btnToggle) return;
    btnToggle.dataset.playing = String(playing);
    const label = playing ? 'Jeda musik' : 'Putar musik';
    btnToggle.title = label;
    btnToggle.setAttribute('aria-label', label);
  }

  function updateMediaControls(track: import('./audio/systemMediaBridge').SystemMediaTrack | null) {
    const missingSelected = !track && !!mediaBridge?.getSelectedSession() && mediaBridge.getSelectedSession() !== 'local';
    if (btnToggle) btnToggle.disabled = mediaCommandPending || missingSelected || (!!track && !track.capabilities?.toggle);
    if (btnNext) btnNext.disabled = mediaCommandPending || missingSelected || (!!track && !track.capabilities?.next);
    if (btnPrev) btnPrev.disabled = mediaCommandPending || missingSelected || (!!track && !track.capabilities?.previous);
    if (repeatButton) {
      const local = !track && mediaBridge?.getSelectedSession() === 'local';
      repeatButton.disabled = mediaCommandPending || !track?.capabilities?.repeat || track.repeat_mode == null;
      repeatButton.dataset.repeat = local ? 'one' : track?.repeat_mode ?? 'off';
      const label = track?.capabilities?.repeat
        ? `Repeat: ${track.repeat_mode === 'one' ? 'satu lagu' : track.repeat_mode === 'all' ? 'semua lagu' : 'mati'}`
        : local ? 'Playlist bawaan selalu diulang' : 'Repeat tidak didukung pemutar ini';
      repeatButton.title = label;
      repeatButton.setAttribute('aria-label', label);
      repeatButton.setAttribute('aria-pressed', String(local || track?.repeat_mode === 'one' || track?.repeat_mode === 'all'));
    }
    const seek = document.querySelector<HTMLElement>('#music-progress-track');
    const canSeek = !!track?.capabilities?.seek && track.duration_secs > 0;
    seek?.setAttribute('aria-disabled', String(!canSeek));
    if (seek) seek.tabIndex = canSeek ? 0 : -1;
  }

  async function runMediaCommand(action: () => Promise<boolean>) {
    if (mediaCommandPending) return;
    const sessionKey = mediaBridge?.getCurrentTrack()?.session_key;
    const focused = document.activeElement instanceof HTMLButtonElement
      && document.activeElement.closest('.music-controls-row') ? document.activeElement : null;
    mediaCommandPending = true;
    updateMediaControls(mediaBridge?.getCurrentTrack() ?? null);
    try {
      const success = await action();
      if (musicStatus && mediaBridge?.getCurrentTrack()?.session_key === sessionKey) {
        musicStatus.innerText = success ? '' : 'Pemutar menolak perintah. Coba lagi.';
      }
    } finally {
      mediaCommandPending = false;
      updateMediaControls(mediaBridge?.getCurrentTrack() ?? null);
      if (focused && !focused.disabled && document.activeElement === document.body
        && mediaBridge?.getCurrentTrack()?.session_key === sessionKey) {
        focused.focus({ preventScroll: true });
      }
    }
  }
  let lastMediaTrackKey: string = '';
  let currentCustomArtUrl: string | null = null;
  let currentArtSource: ArtworkSource = 'none';
  // Identitas sesi+rekaman yang sedang dipakai untuk pipeline artwork
  let lastSessionIdentity: string = '';
  // Penolong balapan: respons artwork lama (permintaan dengan token lebih kecil) ditolak
  let artworkRequestToken: number = 0;
  const artworkRetry = new ArtworkRetry();
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

    void coverBox?.offsetWidth;

    coverBox?.classList.add('track-slide-transition');
    trackTitle?.classList.add('track-slide-transition');

    setTimeout(() => {
      coverBox?.classList.remove('track-slide-transition');
      trackTitle?.classList.remove('track-slide-transition');
    }, 350);
  }

  // Status awal berhenti jika belum diputar secara eksplisit
  if (btnToggle) {
    setPlaybackAppearance(false);
  }
  stageEl?.classList.remove('playing');
  setEqualizerPlaying(false);

  const lyricsView = new LyricsView(renderLyricsContent);

  function renderLyricsContent(update: import('./audio/lyricsService').LyricsLinesUpdate) {
    const cardLine1 = document.querySelector<HTMLElement>('#music-card-line1');
    const cardHighlight = document.querySelector<HTMLElement>('#music-card-highlight');
    const cardLine2 = document.querySelector<HTMLElement>('#music-card-line2');
    const cardIncoming = document.querySelector<HTMLElement>('#music-card-incoming');
    const dotsEl = document.querySelector<HTMLElement>('#lyrics-instrumental-dots');
    const lyricsCard = document.querySelector<HTMLElement>('#music-lyrics-card');

    if (lyricsCard) {
      lyricsCard.setAttribute('aria-busy', String(update.loadStatus === 'loading'));
      lyricsCard.classList.toggle('is-paused', update.isPlaying === false);
      lyricsCard.classList.toggle('is-local-music', !isSystemMediaActive);
      lyricsCard.classList.toggle('is-plain-lyrics', !update.isSynced && (update.totalLines ?? 0) > 0);
    }
    const lyricsViewport = document.querySelector<HTMLElement>('#lyrics-viewport');
    if (lyricsViewport) {
      lyricsViewport.tabIndex = isSystemMediaActive ? 0 : -1;
      lyricsViewport.setAttribute('aria-label', !update.isSynced && (update.totalLines ?? 0) > 0
        ? 'Lirik tanpa penanda waktu, gulir untuk membaca'
        : isSystemMediaActive ? 'Lirik lagu, gulir untuk membaca baris panjang' : 'Playlist bawaan berulang');
    }

    if (cardLine1) cardLine1.innerText = update.line1;

    if (cardHighlight) {
      cardHighlight.innerText = update.highlight;
      cardHighlight.style.display = update.isInstrumental ? 'none' : 'block';
    }

    if (dotsEl) {
      dotsEl.setAttribute('aria-label', isSystemMediaActive ? 'Instrumental' : 'Playlist berulang');
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
    for (const id of ['#btn-lyrics-slower', '#btn-lyrics-faster', '#btn-lyrics-reset']) {
      const control = document.querySelector<HTMLButtonElement>(id);
      if (control) control.disabled = !isSystemMediaActive || !update.isSynced;
    }
    const offsetOutput = document.querySelector<HTMLOutputElement>('#lyrics-offset');
    if (offsetOutput) offsetOutput.value = `${(update.offsetSeconds || 0).toFixed(1).replace('.', ',')} dtk`;
    const cardTag = document.querySelector<HTMLElement>('#music-card-tag');

    if (cardTag && isSystemMediaActive) {
      const track = mediaBridge?.getCurrentTrack();
      const identity = resolveMediaSourceIdentity(track ?? null);
      const prefix = `${identity.badgeText} · LRCLIB`;
      if (update.loadStatus) {
        cardTag.innerText = `${prefix} · ${update.loadStatus === 'loading' ? 'MEMUAT LIRIK'
          : update.loadStatus === 'error' ? 'LIRIK GAGAL DIMUAT' : 'LIRIK BELUM TERSEDIA'}`;
      } else if (update.isSynced) {
        cardTag.innerText = update.isInstrumental ? `${prefix} · INSTRUMENTAL` : `${prefix} · LIRIK SINKRON`;
      } else if (update.line1 === 'Lirik biasa (sinkronisasi tidak tersedia)') {
        cardTag.innerText = `${prefix} · LIRIK BIASA (SINKRONISASI TIDAK TERSEDIA)`;
      } else {
        cardTag.innerText = `${prefix} · LIRIK & INFO`;
      }
    }

    const hasLyrics = update.isSynced || (update.totalLines ?? 0) > 0;
    lyricsView.update(hasLyrics ? {
      ...update,
      line1: update.line1 === 'Lirik biasa (sinkronisasi tidak tersedia)' ? '' : update.line1,
    } : {
      ...update,
      line1: '',
      highlight: isSystemMediaActive ? update.highlight : '',
      line2: update.line2,
      incoming: '',
      isInstrumental: !isSystemMediaActive,
    });
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
  let readingSessions = false;
  async function refreshSessions() {
    if (readingSessions || !sessionSelect || document.activeElement === sessionSelect) return;
    readingSessions = true;
    try {
      const sessions = await mediaBridge!.listSessions();
      const selected = mediaBridge!.getSelectedSession() || '';
      const options = [new Option('Otomatis', ''), new Option('Musik bawaan', 'local')];
      for (const session of sessions) {
        options.push(new Option(`${session.source_display_name || 'Pemutar'} · ${session.title}`, session.session_key));
      }
      if (selected && selected !== 'local' && !sessions.some(s => s.session_key === selected)) {
        options.push(new Option('Sesi pilihan tidak tersedia', selected));
      }
      if (document.activeElement !== sessionSelect) {
        sessionSelect.replaceChildren(...options);
        sessionSelect.value = selected;
      }
      const status = document.querySelector<HTMLElement>('#music-session-status');
      if (status) status.innerText = !mediaBridge!.isTauriAvailable
        ? 'Sesi aplikasi lain hanya tersedia di desktop.'
        : selected && selected !== 'local' && !sessions.some(s => s.session_key === selected)
        ? 'Sesi pilihan terputus. Pilih sesi lain atau Otomatis.'
        : sessions.length ? `${sessions.length} sesi tersedia.` : 'Belum ada sesi media.';
    } finally { readingSessions = false; }
  }
  sessionSelect?.addEventListener('change', () => {
    void mediaBridge!.selectSession(sessionSelect.value || null);
    if (musicStatus) musicStatus.innerText = '';
  });
  void refreshSessions();
  window.setInterval(() => { void refreshSessions(); }, 5000);
  for (const [id, delta, reset] of [
    ['#btn-lyrics-slower', -0.5, false], ['#btn-lyrics-faster', 0.5, false], ['#btn-lyrics-reset', 0, true],
  ] as const) {
    document.querySelector(id)?.addEventListener('click', () => {
      const saved = lyricsService.adjustTiming(delta, reset);
      const status = document.querySelector<HTMLElement>('#lyrics-timing-status');
      if (status) status.innerText = saved ? 'Koreksi lirik tersimpan.' : 'Koreksi tidak tersimpan. Coba lagi.';
    });
  }
  repeatButton?.addEventListener('click', () => {
    const mode = mediaBridge?.getCurrentTrack()?.repeat_mode;
    void runMediaCommand(() => mediaBridge!.setRepeat(mode === 'off' ? 'all' : mode === 'all' ? 'one' : 'off'));
  });

  // Daftarkan listener saat lagu selesai (Momo melepas headphone dan meregangkan badan)
  mediaBridge.onSongFinished(() => {
    renderer?.triggerSongFinished();
    endedMomoRecord = momoRecord();
    musicMomo?.controller.setPlayback('ended', endedMomoRecord);
  });

  // Variabel kendali ekstrapolasi waktu pemutaran lokal mandiri
  let localPlaybackPos: number = 0;
  let lastReportedSystemPos: number = -1;
  let isPlaybackActive: boolean = false;
  let currentTrackDuration: number = 0;
  let playbackTickerTimer: number | null = null;
  let seekCooldownUntil: number = 0;
  let playbackCorrection = 0;
  let ambientElapsedSeconds = 0;
  let localHasStarted = false;
  let ambientStartedAt: number | null = null;

  function pauseAmbientClock() {
    if (ambientStartedAt !== null) {
      ambientElapsedSeconds += (performance.now() - ambientStartedAt) / 1000;
      ambientStartedAt = null;
    }
  }

  function renderAmbientTime() {
    if (isSystemMediaActive) return;
    const elapsed = ambientElapsedSeconds + (ambientStartedAt === null
      ? 0 : (performance.now() - ambientStartedAt) / 1000);
    const current = document.querySelector<HTMLElement>('#music-time-current');
    const total = document.querySelector<HTMLElement>('#music-time-total');
    const progress = document.querySelector<HTMLElement>('#music-progress-track');
    if (current) current.innerText = formatTime(elapsed);
    if (total) total.style.display = 'none';
    if (progress) progress.style.display = 'none';
  }

  audio.onPlaybackState = (state) => {
    if (isSystemMediaActive || !isAudioPlaying) return;
    if (state === 'loading') {
      if (musicStatus) musicStatus.innerText = '';
      pauseAmbientClock();
      setPlaybackAppearance(true, 'loading');
    } else if (state === 'playing') {
      ambientStartedAt ??= performance.now();
      setPlaybackAppearance(true);
    } else {
      pauseAmbientClock();
      isAudioPlaying = false;
      setPlaybackAppearance(false);
      stageEl?.classList.remove('playing');
      setEqualizerPlaying(false);
      petMusicPlaying = false; renderer?.setMusicPlaying(false);
      lyricsService.setAmbientTrack(ambientTracks[currentTrackIdx].id, false);
      if (musicStatus) musicStatus.innerText = audio.getPlaybackFailure()?.message ?? 'Audio gagal dimuat. Coba putar kembali.';
    }
  };

  window.setInterval(renderAmbientTime, 1000);

  function updateMusicProgressUI(positionSecs: number, durationSecs: number) {
    const clampedPos = Math.max(0, durationSecs > 0 ? Math.min(positionSecs, durationSecs) : positionSecs);
    const progressFill = document.querySelector<HTMLElement>('#music-progress-fill');
    const timeCurrent = document.querySelector<HTMLElement>('#music-time-current');
    const timeTotal = document.querySelector<HTMLElement>('#music-time-total');

    const progressTrack = document.querySelector<HTMLElement>('#music-progress-track');
    if (progressTrack) progressTrack.style.display = '';
    progressTrack?.setAttribute('aria-valuemax', String(Math.max(0, durationSecs)));
    progressTrack?.setAttribute('aria-valuenow', String(clampedPos));
    if (timeTotal) timeTotal.style.display = '';

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
        const rate = mediaBridge?.getCurrentTrack()?.playback_rate ?? 1;
        const advanced = advancePlayback(localPlaybackPos, dt, playbackCorrection, rate);
        localPlaybackPos = advanced.position;
        playbackCorrection = advanced.correction;
        if (currentTrackDuration > 0 && localPlaybackPos > currentTrackDuration) {
          localPlaybackPos = currentTrackDuration;
        }
        updateMusicProgressUI(localPlaybackPos, currentTrackDuration);
      }
    }, 50);
  }

  function stopPlaybackTicker() {
    if (playbackTickerTimer !== null) {
      clearInterval(playbackTickerTimer);
      playbackTickerTimer = null;
    }
  }

  let localPlaybackRequest = 0;
  mediaBridge.subscribe((track) => {
    if (track && shouldIgnoreAmbiguousWebViewSession(track.source_app, mediaBridge!.getSelectedSession(),
      !isSystemMediaActive && (isAudioPlaying || localHasStarted))) return;
    updateMediaControls(track);
    const hasExternalMedia = !!(track && track.has_session && track.title.trim().length > 0);
    const disconnected = !hasExternalMedia && !!mediaBridge?.getSelectedSession()
      && mediaBridge.getSelectedSession() !== 'local';
    void updateVolumeMode(hasExternalMedia);
    document.querySelector('#music-lyrics-card')?.classList.toggle('is-local-music', !hasExternalMedia && !disconnected);
    if (track && track.has_session && track.title.trim().length > 0) {
      if (isAudioPlaying) console.warn('Sesi sistem mengambil alih audio lokal:', {
        sourceApp: track.source_app,
        localPlaylistTitle: ambientTracks.some(item => item.title === track.title),
        playbackStatus: track.playback_status,
      });
      // Pengambilalihan kontrol juga menghentikan sumber lokal ketika sesi luar dijeda.
      takeOverLocalPlayback(audio, pauseAmbientClock, () => ++localPlaybackRequest);
      isAudioPlaying = false;
      isSystemMediaActive = true;
      // Identitas sumber: aplikasi asli dipisahkan dari layanan.
      // Media non-Spotify (termasuk browser) TIDAK diberi label Spotify.
      const identity = resolveMediaSourceIdentity(track);

      const trackKey = `${track.session_key}#${track.record_key}#${track.title}:::${track.artist}`.toLowerCase();
      const isNewTrack = trackKey !== lastMediaTrackKey;
      if (isNewTrack) {
        lastMediaTrackKey = trackKey;
        playbackCorrection = 0;
        seekCooldownUntil = 0;
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
        artworkRequestToken++;
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
      }

      if (artworkRetry.begin(sessionIdentity, track.has_thumbnail === true)) {
        const artToken = ++artworkRequestToken;
        const artworkKey = sessionIdentity;
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
          artworkRetry.finish(artworkKey, applied);

          if (!applied) {
            // Thumbnail tidak tersedia / gagal dibaca / format tidak didukung:
            // tahan placeholder, lalu coba fallback pencarian terverifikasi (opsional)
            if (!currentCustomArtUrl) lyricsService.notifySessionArtworkUnavailable(artworkKey);
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
          const reconciled = reconcilePlayback(localPlaybackPos, track.position_secs, track.is_playing);
          localPlaybackPos = reconciled.position;
          playbackCorrection = reconciled.correction;
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
        setPlaybackAppearance(track.is_playing, !track.is_playing && track.playback_status === 'changing' ? 'loading'
          : track.is_playing ? 'playing' : 'paused');
      }
      stageEl?.classList.toggle('playing', track.is_playing);
      setEqualizerPlaying(track.is_playing);
      petMusicPlaying = track.is_playing; renderer?.setMusicPlaying(track.is_playing);
      renderer?.setAmbientMode(null);

    } else {
      isSystemMediaActive = false;
      isPlaybackActive = false;
      stopPlaybackTicker();
      localPlaybackPos = 0;
      playbackCorrection = 0;
      lastReportedSystemPos = -1;
      // Batalkan permintaan artwork yang masih berjalan dan bersihkan sampul
      artworkRequestToken++;
      artworkRetry.reset();
      lastSessionIdentity = '';
      lastMediaTrackKey = '';
      currentCustomArtUrl = null;
      currentArtSource = 'none';
      if (disconnected) {
        takeOverLocalPlayback(audio, pauseAmbientClock, () => ++localPlaybackRequest);
        isAudioPlaying = false;
        lyricsService.clear();
        const artwork = document.querySelector<HTMLElement>('#music-album-art');
        if (artwork) { artwork.replaceChildren(); artwork.title = 'Sampul tidak tersedia'; }
        lastCoverRenderKey = '';
        const title = document.querySelector<HTMLElement>('#music-track-title');
        const artist = document.querySelector<HTMLElement>('#music-track-artist');
        const compact = document.querySelector<HTMLElement>('#compact-track');
        const tag = document.querySelector<HTMLElement>('#music-card-tag');
        const badge = document.querySelector<HTMLElement>('#music-source-badge');
        const highlight = document.querySelector<HTMLElement>('#music-card-highlight');
        const line1 = document.querySelector<HTMLElement>('#music-card-line1');
        const line2 = document.querySelector<HTMLElement>('#music-card-line2');
        if (title) title.innerText = 'Sesi media terputus';
        if (artist) artist.innerText = 'Pilih sumber lain di pengaturan.';
        if (compact) compact.innerText = 'Sesi media terputus';
        if (badge) badge.innerText = 'SESI TERPUTUS';
        if (tag) tag.innerText = 'SUMBER TIDAK TERSEDIA';
        if (line1) line1.innerText = '';
        if (highlight) { highlight.innerText = 'Pilih sumber lain di pengaturan.'; highlight.style.display = 'block'; }
        if (line2) line2.innerText = '';
        document.querySelector<HTMLElement>('#lyrics-instrumental-dots')?.style.setProperty('display', 'none');
        setPlaybackAppearance(false, 'disconnected');
        stageEl?.classList.remove('playing');
        setEqualizerPlaying(false);
        petMusicPlaying = false; renderer?.setMusicPlaying(false);
        return;
      }
      renderMusicAlbumArt(null, null, 'none');
      lastCoverRenderKey = 'inactive';

      renderAmbientTime();

      const compactThumb = document.querySelector<HTMLImageElement>('#compact-album-thumb');
      if (compactThumb) compactThumb.style.display = 'none';

      const artistAvatar = document.querySelector<HTMLImageElement>('#music-artist-avatar');
      if (artistAvatar) artistAvatar.style.display = 'none';

      if (!isAudioPlaying) {
        const localTrack = ambientTracks[currentTrackIdx];
        const sourceBadge = document.querySelector<HTMLElement>('#music-source-badge');
        if (sourceBadge) {
          sourceBadge.innerText = 'MUSIK BELAJAR';
          sourceBadge.className = 'session-badge badge-purple';
        }

        const titleEl = document.querySelector<HTMLElement>('#music-track-title');
        if (titleEl) titleEl.innerText = localTrack.title;

        const artistEl = document.querySelector<HTMLElement>('#music-track-artist');
        if (artistEl) artistEl.innerText = localTrack.artist;

        const compactTrack = document.querySelector<HTMLElement>('#compact-track');
        if (compactTrack) compactTrack.innerText = localTrack.title;

        const cardTag = document.querySelector<HTMLElement>('#music-card-tag');
        if (cardTag) cardTag.innerText = 'PLAYLIST BAWAAN · LOOP';

        lyricsService.setAmbientTrack(localTrack.id, false);

        setPlaybackAppearance(false, mediaBridge?.getSelectedSession() !== 'local' ? 'disconnected' : localHasStarted ? 'paused' : 'idle');
        stageEl?.classList.remove('playing');
        setEqualizerPlaying(false);
      }
    }
  });

  // Daftarkan aksi klik pada bilah progres musik untuk seek posisi lagu
  const progressTrack = document.querySelector<HTMLElement>('#music-progress-track');
  let seekRequest = 0;
  const seekToPosition = async (targetPos: number) => {
    const track = mediaBridge?.getCurrentTrack();
    if (!track?.capabilities?.seek || !isSystemMediaActive || track.duration_secs <= 0) return;
    const request = ++seekRequest;
    targetPos = Math.max(0, Math.min(targetPos, track.duration_secs));
    const ratio = targetPos / track.duration_secs;

    const prevPos = localPlaybackPos;
    // Beri preview visual sementara pada progres bar
    const progressFill = document.querySelector<HTMLElement>('#music-progress-fill');
    if (progressFill) progressFill.style.width = `${ratio * 100}%`;

    // Kirim permintaan seek dan periksa konfirmasi keberhasilan dari Spotify
    const success = await mediaBridge?.seekTo(targetPos);
    const active = mediaBridge?.getCurrentTrack();
    if (request !== seekRequest || active?.session_key !== track.session_key || active?.record_key !== track.record_key) return;
    if (success) {
      localPlaybackPos = targetPos;
      playbackCorrection = 0;
      lastReportedSystemPos = targetPos;
      seekCooldownUntil = performance.now() + 800;
      updateMusicProgressUI(targetPos, currentTrackDuration);
    } else {
      // Jika perintah seek gagal atau ditolak oleh sistem, pulihkan tampilan ke posisi sebenarnya
      updateMusicProgressUI(prevPos, currentTrackDuration);
    }
  };
  progressTrack?.addEventListener('click', (e: MouseEvent) => {
    const track = mediaBridge?.getCurrentTrack();
    if (!track) return;
    const rect = progressTrack.getBoundingClientRect();
    void seekToPosition(rect.width > 0 ? (e.clientX - rect.left) / rect.width * track.duration_secs : 0);
  });
  progressTrack?.addEventListener('keydown', e => {
    const track = mediaBridge?.getCurrentTrack();
    if (!track?.capabilities?.seek || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    void seekToPosition(e.key === 'Home' ? 0 : e.key === 'End' ? track.duration_secs
      : localPlaybackPos + (e.key === 'ArrowLeft' ? -5 : 5));
  });

  // Mulai memantau status sesi media OS setiap 1 detik
  mediaBridge.startPolling(1000);

  btnToggle?.addEventListener('click', async () => {
    const request = ++localPlaybackRequest;
    if (isSystemMediaActive && mediaBridge) {
      await runMediaCommand(() => mediaBridge!.togglePlay());
    } else {
      isAudioPlaying = !isAudioPlaying;
      const currentAmbient = ambientTracks[currentTrackIdx].id;
      if (isAudioPlaying) {
        setPlaybackAppearance(true, 'loading');
        const started = await audio.play(currentAmbient);
        if (request !== localPlaybackRequest || !isAudioPlaying) return;
        if (!started || isSystemMediaActive) {
          audio.stop();
          isAudioPlaying = false;
          setPlaybackAppearance(false);
          if (!isSystemMediaActive) {
            if (musicStatus) musicStatus.innerText = audio.getPlaybackFailure()?.message ?? 'Audio gagal diputar. Coba lagi.';
          }
          return;
        }
        ambientStartedAt = performance.now();
        localHasStarted = true;
        setPlaybackAppearance(true);
        stageEl?.classList.add('playing');
        setEqualizerPlaying(true);
        petMusicPlaying = true; renderer?.setMusicPlaying(true);
        renderer?.setAmbientMode(null);
        lyricsService.setAmbientTrack(currentAmbient, true);
      } else {
        setPlaybackAppearance(false);
        pauseAmbientClock();
        audio.stop();
        stageEl?.classList.remove('playing');
        setEqualizerPlaying(false);
        petMusicPlaying = false; renderer?.setMusicPlaying(false);
        lyricsService.setAmbientTrack(currentAmbient, false);
      }
      renderAmbientTime();
    }
  });

  const changeTrack = async (delta: number) => {
    if (musicStatus) musicStatus.innerText = '';
    const request = ++localPlaybackRequest;
    audio.resetPlayback();
    ambientElapsedSeconds = 0;
    localHasStarted = false;
    ambientStartedAt = null;
    currentTrackIdx = (currentTrackIdx + delta + ambientTracks.length) % ambientTracks.length;
    const track = ambientTracks[currentTrackIdx];

    triggerTrackChangeAnimation();
    renderMusicAlbumArt(null);

    const titleEl = document.querySelector<HTMLElement>('#music-track-title');
    if (titleEl) titleEl.innerText = track.title;

    const artistEl = document.querySelector<HTMLElement>('#music-track-artist');
    if (artistEl) artistEl.innerText = track.artist;

    const compactTrack = document.querySelector<HTMLElement>('#compact-track');
    if (compactTrack) compactTrack.innerText = track.title;

    if (isAudioPlaying) {
      setPlaybackAppearance(true, 'loading');
      const started = await audio.play(track.id);
      if (request !== localPlaybackRequest || isSystemMediaActive) return;
      isAudioPlaying = started;
      localHasStarted = started;
      ambientStartedAt = started ? performance.now() : null;
      setPlaybackAppearance(started);
      setEqualizerPlaying(started);
      petMusicPlaying = started; renderer?.setMusicPlaying(started);
      stageEl?.classList.toggle('playing', started);
      if (!started && musicStatus) musicStatus.innerText = audio.getPlaybackFailure()?.message ?? 'Audio gagal diputar. Coba lagi.';
      renderer?.setAmbientMode(null);
      lyricsService.setAmbientTrack(track.id, started);
    } else {
      lyricsService.setAmbientTrack(track.id, false);
    }
    renderAmbientTime();
  };

  btnPrev?.addEventListener('click', async () => {
    if (isSystemMediaActive && mediaBridge) {
      await runMediaCommand(() => mediaBridge!.prevTrack());
    } else {
      changeTrack(-1);
    }
  });

  btnNext?.addEventListener('click', async () => {
    if (isSystemMediaActive && mediaBridge) {
      await runMediaCommand(() => mediaBridge!.nextTrack());
    } else {
      changeTrack(1);
    }
  });
}

// ============================================================================
// 7. KONTROL WINDOW & NOTCH NATIVE
// ============================================================================
function bindWindowAndNotchControls() {
  const minimalSprite = document.querySelector<SVGSVGElement>('#compact-momo-sprite')?.cloneNode(true) as SVGSVGElement | undefined;
  if (minimalSprite) {
    minimalSprite.setAttribute('id', 'desktop-pet-sprite');
    rigDesktopPet(minimalSprite);
    document.querySelector('#view-minimal .minimal-momo')?.append(minimalSprite);
  }
  const renderPetGait = minimalSprite ? mountPetGait(minimalSprite) : null;
  const petPerformance = new PetPerformance();
  const renderPet = (distance: number, time: number, walking: boolean, reduced = false) => {
    const elapsed = lastPetRender === null ? 0 : (time - lastPetRender) / 1000;
    lastPetRender = time;
    const pose = petPerformance.step(elapsed, { visible: currentIslandState === 'hidden' && !document.hidden,
      music: petMusicPlaying, walking, reduced, blocked: isIslandTransitioning || isSettingsModalOpen || minimalDragging || startPointer !== null });
    renderPetGait?.(distance, time, walking, reduced, pose.action, pose.frame);
    if (minimal) minimal.dataset.action = walking ? 'walk' : pose.action;
  };
  let lastPetRender: number | null = null;
  const minimal = document.querySelector<HTMLElement>('#view-minimal');
  const compact = document.querySelector<HTMLElement>('#view-compact');
  let startPointer: { x: number; y: number } | null = null;
  let minimalDragging = false;
  let manualWindowDrag = false;
  let trackMinimalPosition = false;
  let minimalMoveSequence = 0;
  let suppressMinimalClick = false;
  let moveTimer: number | null = null;
  let docking = false;
  if (minimal && !isTauri()) {
    let cursor = { x: -1000, y: -1000 }, pressed = false;
    let motion = restingPet(), previous = performance.now(), travelled = 0;
    document.addEventListener('pointermove', event => { cursor = { x: event.clientX, y: event.clientY }; });
    document.addEventListener('pointerdown', () => { pressed = true; });
    document.addEventListener('pointerup', () => { pressed = false; });
    const animatePreview = (time: number) => {
      const dt = (time - previous) / 1000; previous = time;
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (currentIslandState === 'hidden' && !isIslandTransitioning && !document.hidden && !reduced) {
        const rect = widget?.getBoundingClientRect();
        if (rect && widget) {
          const next = stepDesktopPet({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2,
            width: rect.width, height: rect.height, scale: 1, cursorX: cursor.x, cursorY: cursor.y,
            pressed, visible: true, area: { x: 0, y: 0, width: innerWidth, height: innerHeight } }, motion, dt, time);
          motion = next.motion; travelled += Math.hypot(motion.vx, motion.vy) * Math.min(.08, dt);
          widget.style.left = `${next.x}px`; widget.style.top = `${next.y - rect.height / 2}px`;
          minimal.dataset.walking = String(motion.walking); minimal.dataset.facing = motion.facing;
        }
      } else motion = restingPet();
      renderPet(travelled, time, motion.walking, reduced);
      requestAnimationFrame(animatePreview);
    };
    requestAnimationFrame(animatePreview);
  }
  if (minimal && isTauri()) {
    void import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
      const nativeWindow = getCurrentWindow();
      const snapWhenReleased = async () => {
          try {
            const { invoke } = await import('@tauri-apps/api/core');
            if (await invoke<boolean>('is_pointer_pressed')) {
              moveTimer = window.setTimeout(() => { void snapWhenReleased(); }, 150);
              return;
            }
            const wasDragging = minimalDragging || manualWindowDrag;
            minimalDragging = false;
            manualWindowDrag = false;
            if (isIslandTransitioning || isSettingsModalOpen || (performance.now() < petAutomaticUntil && !wasDragging)) return;
            const stateAtRelease = currentIslandState;
            docking = true;
            const { currentMonitor } = await import('@tauri-apps/api/window');
            const monitor = await currentMonitor();
            if (!monitor) return;
            const work = monitor.workArea;
            const area = { x: work.position.x, y: work.position.y, width: work.size.width, height: work.size.height };
            const [size, position] = await Promise.all([nativeWindow.outerSize(), nativeWindow.outerPosition()]);
            if (isIslandTransitioning || isSettingsModalOpen || stateAtRelease !== currentIslandState) return;
            const anchor = { x: position.x + size.width / 2, y: position.y + size.height / 2 };
            const edge = dockWithinThreshold(anchor.x, anchor.y, area, size);
            applyDockEdge(edge);
            saveMinimalPosition({
              x: edge === 'left' ? area.x : edge === 'right' ? area.x + area.width : anchor.x,
              y: edge === 'top' ? area.y : edge === 'bottom' ? area.y + area.height : anchor.y,
            });
            await syncTauriWindowState(currentIslandState);
          } catch (error) { console.warn('Gagal menempelkan Momo:', error); }
          finally { docking = false; }
      };
      const queueDock = () => {
        if (moveTimer !== null) window.clearTimeout(moveTimer);
        moveTimer = window.setTimeout(() => { void snapWhenReleased(); }, 400);
      };
      void nativeWindow.onMoved(async ({ payload }) => {
        if (nativeGeometryWrites > 0 || performance.now() < nativeGeometryQuietUntil) return;
        if (isIslandTransitioning || isSettingsModalOpen || docking || (performance.now() < petAutomaticUntil && !minimalDragging && !manualWindowDrag)) return;
        if (currentIslandState === 'hidden' && !trackMinimalPosition) return;
        petManualUntil = performance.now() + 1000;
        const sequence = ++minimalMoveSequence;
        try {
          const size = await nativeWindow.outerSize();
          if (sequence !== minimalMoveSequence || isIslandTransitioning || nativeGeometryWrites > 0 || performance.now() < nativeGeometryQuietUntil
            || (performance.now() < petAutomaticUntil && !minimalDragging && !manualWindowDrag)) return;
          saveMinimalPosition({ x: payload.x + size.width / 2, y: payload.y + size.height / 2 });
        } catch { /* Posisi aktual akan dibaca kembali setelah drag dilepas. */ }
        queueDock();
      });
      document.addEventListener('pointerdown', event => {
        const target = event.target as HTMLElement;
        if (event.button !== 0 || target.closest('button, input, select, [role="button"], a')) return;
        const region = target.closest('[data-tauri-drag-region]');
        if (!region || region.getAttribute('data-tauri-drag-region') === 'false') return;
        manualWindowDrag = true;
        petManualUntil = performance.now() + 1000;
        queueDock();
      }, { capture: true });
      for (const handle of [minimal]) {
        if (!handle) continue;
      handle.addEventListener('pointerdown', event => {
        if (event.button === 0) {
          startPointer = { x: event.screenX, y: event.screenY };
          suppressMinimalClick = false;
          handle.setPointerCapture(event.pointerId);
        }
      });
      handle.addEventListener('pointermove', event => {
        if (!startPointer || minimalDragging || !(event.buttons & 1)) return;
        if (Math.hypot(event.screenX - startPointer.x, event.screenY - startPointer.y) < 5) return;
        startPointer = null;
        minimalDragging = true;
        trackMinimalPosition = true;
        suppressMinimalClick = true;
        queueDock();
        void nativeWindow.startDragging().catch(error => { minimalDragging = false; console.warn('Gagal memindahkan Momo:', error); });
      });
      }
      window.addEventListener('pointerup', () => { startPointer = null; });
      window.addEventListener('pointercancel', () => { startPointer = null; minimalDragging = false; });

      let motion = restingPet();
      let previousTime = performance.now();
      let fractional: { x: number; y: number } | null = null;
      let savedAt = 0;
      let travelled = 0;
      let cachedContext: PetContext | null = null;
      let contextReadAt = 0;
      const petTick = async () => {
        const now = performance.now();
        const elapsed = (now - previousTime) / 1000;
        previousTime = now;
        if (currentIslandState !== 'hidden' || isIslandTransitioning || isSettingsModalOpen || docking || startPointer || minimalDragging || now < petManualUntil
          || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          motion = restingPet(); fractional = null; cachedContext = null;
          if (minimal) minimal.dataset.walking = 'false';
          renderPet(travelled, now, false, window.matchMedia('(prefers-reduced-motion: reduce)').matches);
          return;
        }
        const { invoke } = await import('@tauri-apps/api/core');
        if (!cachedContext || now - contextReadAt >= 100) {
          cachedContext = await invoke<PetContext>('desktop_pet_context');
          contextReadAt = now;
        }
        const context = { ...cachedContext };
        if (currentIslandState !== 'hidden' || isIslandTransitioning || startPointer || minimalDragging) return;
        if (fractional && Math.hypot(fractional.x - context.x, fractional.y - context.y) < 2) {
          context.x = fractional.x; context.y = fractional.y;
        }
        const next = stepDesktopPet(context, motion, elapsed, now);
        motion = next.motion;
        travelled += Math.hypot(next.x - context.x, next.y - context.y) / context.scale;
        renderPet(travelled, now, motion.walking);
        if (minimal) { minimal.dataset.walking = String(motion.walking); minimal.dataset.facing = motion.facing; }
        if (!motion.walking) { fractional = null; return; }
        fractional = { x: next.x, y: next.y };
        petAutomaticUntil = performance.now() + 250;
        if (dockEdge !== 'floating') applyDockEdge('floating');
        const targetX = Math.round(next.x - context.width / 2) + context.width / 2;
        const targetY = Math.round(next.y - context.height / 2) + context.height / 2;
        if (targetX !== cachedContext.x || targetY !== cachedContext.y) {
          const [x, y] = await invoke<[number, number]>('move_minimal_window', fractional);
          cachedContext.x = x; cachedContext.y = y;
        }
        if (minimalSprite) minimalSprite.style.translate = `${(next.x - cachedContext.x) / context.scale}px ${(next.y - cachedContext.y) / context.scale}px`;
        if (now - savedAt > 1500) { saveMinimalPosition(fractional); savedAt = now; }
      };
      let petFailed = false;
      const schedulePet = () => {
        window.requestAnimationFrame(() => {
          petMoveInFlight = petTick().catch(error => {
            if (!petFailed) console.warn('Gerak desktop Momo tidak tersedia:', error);
            petFailed = true;
          }).finally(() => { petMoveInFlight = null; schedulePet(); });
        });
      };
      schedulePet();
    }).catch(error => console.warn('Kontrol posisi Momo tidak tersedia:', error));
  }
  const hover = new HoverIntent();
  const widget = document.querySelector<HTMLElement>('#dynamic-island');
  let dragging = false;
  let keyboardNavigation = false;
  let hoverHold = false;
  window.addEventListener('keydown', e => {
    if (['Tab', 'Enter', ' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) keyboardNavigation = true;
  });
  window.addEventListener('pointerdown', () => { keyboardNavigation = false; });
  widget?.addEventListener('pointerdown', () => { dragging = true; });
  window.addEventListener('pointerup', () => { dragging = false; });
  window.addEventListener('pointercancel', () => { dragging = false; });
  window.addEventListener('blur', () => { dragging = false; hover.reset(); });
  window.setInterval(() => {
    if (!widget) return;
    const inside = widget.matches(':hover');
    if (!inside) hoverHold = false;
    const focused = document.activeElement as HTMLElement | null;
    const focusInside = !!focused && focused.offsetParent !== null && widget.contains(focused)
      && (keyboardNavigation || focused.matches('input, select, textarea, [contenteditable="true"]'));
    const confirmingCancel = !!document.querySelector('#focus-cancel-confirm:not([hidden])');
    const blocked = dragging || hoverHold || focusInside || confirmingCancel || isSettingsModalOpen || isIslandTransitioning;
    const action = hover.update(inside, appState.config.hoverEnabled === true, blocked, currentIslandState, performance.now());
    if (action) void setIslandState(action === 'expand' ? 'expanded' : 'compact');
  }, 50);
  // Tombol Pin Always on Top
  const btnPin = document.querySelector<HTMLButtonElement>('#btn-pin-always-on-top');
  if (btnPin) {
    // Tegaskan tampilan awal sesuai preferensi tersimpan
    btnPin.classList.toggle('active', isAlwaysOnTopActive);
    btnPin.title = isAlwaysOnTopActive
      ? 'Selalu di Atas (Always on Top): Aktif'
      : 'Selalu di Atas (Always on Top): Nonaktif';

    btnPin.addEventListener('click', async (e) => {
      e.stopPropagation();
      isAlwaysOnTopActive = !isAlwaysOnTopActive;
      btnPin.classList.toggle('active', isAlwaysOnTopActive);
      btnPin.title = isAlwaysOnTopActive
        ? 'Selalu di Atas (Always on Top): Aktif'
        : 'Selalu di Atas (Always on Top): Nonaktif';
      // Simpan preferensi pin agar dipakai lagi saat aplikasi dibuka
      appState.config.alwaysOnTop = isAlwaysOnTopActive;
      saveAppState(appState);
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
    hoverHold = true;
    setIslandState('compact');
  });

  // Tombol sembunyikan [x] -> hidden/minimal notch
  document.querySelector('#btn-close-notch')?.addEventListener('click', (e) => {
    e.stopPropagation();
    setIslandState('hidden');
  });

  // Tombol keluar aplikasi [⏻]
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    for (const menu of document.querySelectorAll<HTMLDetailsElement>('.island-menu[open], .focus-plan-details[open]')) {
      menu.open = false; menu.querySelector<HTMLElement>('summary')?.focus();
    }
  });
  document.addEventListener('pointerdown', event => {
    for (const menu of document.querySelectorAll<HTMLDetailsElement>('.island-menu[open], .focus-plan-details[open]')) {
      if (event.target instanceof Node && !menu.contains(event.target)) menu.open = false;
    }
  });
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
    if (suppressMinimalClick) { suppressMinimalClick = false; return; }
    setIslandState('expanded');
  });
  document.querySelector('#view-minimal')?.addEventListener('keydown', (event) => {
    const keyEvent = event as KeyboardEvent;
    if (keyEvent.key === 'Enter' || keyEvent.key === ' ') {
      keyEvent.preventDefault();
      void setIslandState('expanded');
    }
  });

  document.querySelector('#view-compact')?.addEventListener('click', (e) => {
    if (suppressMinimalClick) { suppressMinimalClick = false; return; }
    if ((e.target as HTMLElement).tagName !== 'BUTTON') {
      setIslandState('expanded');
    }
  });
  compact?.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void setIslandState('expanded'); }
  });

  // Klik ganda pada area pegangan notch atau header untuk memastikan panel menempel ke tengah atas
  const snapHandler = async (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, input, select, [role="button"], a')) return;
    e.preventDefault();
    e.stopPropagation();
    if (isTauri()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('snap_to_top_center');
        const { currentMonitor } = await import('@tauri-apps/api/window');
        const monitor = await currentMonitor();
        if (monitor) {
          applyDockEdge('top');
          saveMinimalPosition({ x: monitor.workArea.position.x + monitor.workArea.size.width / 2, y: monitor.workArea.position.y });
          await syncTauriWindowState(currentIslandState);
        }
      } catch (_e) {
        // Abaikan
      }
    }
  };
  document.querySelector<HTMLElement>('#view-compact')?.addEventListener('dblclick', snapHandler);
  document.querySelector<HTMLElement>('header.panel-header')?.addEventListener('dblclick', snapHandler);
}

// ============================================================================
// 8. MODAL DIALOG PENGATURAN POMODORO & WIDGET
// ============================================================================
let settingsSaving = false;
let settingsStartupStatus: boolean | null = null;
let settingsReadVersion = 0;

function showSettingsStatus(message: string) {
  const status = document.querySelector<HTMLElement>('#settings-status');
  if (status) status.innerText = message;
}

function readSettingsDuration() {
  const ids = { hours: 'total-hours', minutes: 'total-mins' };
  const result = parseSettingsDuration({
    hours: document.querySelector<HTMLInputElement>('#setting-total-hours')?.value ?? '',
    minutes: document.querySelector<HTMLInputElement>('#setting-total-mins')?.value ?? '',
  });
  for (const [field, id] of Object.entries(ids)) {
    const invalid = !result.valid && result.field === field;
    document.querySelector<HTMLInputElement>('#setting-' + id)?.setAttribute('aria-invalid', String(invalid));
    const error = document.querySelector<HTMLElement>('#setting-' + id + '-error');
    if (error) error.innerText = invalid && !result.valid ? result.message : '';
  }
  return result;
}

function bindSettingsModal() {
  const modalEl = document.querySelector<HTMLElement>('#modal-settings');
  const btnSessionPill = document.querySelector('#session-pill-clickable');
  const btnDockSettings = document.querySelector('#dock-btn-settings');
  document.querySelector('#btn-header-settings')?.addEventListener('click', () => openModal());
  const btnCloseSettings = document.querySelector('#btn-close-settings');
  const btnSaveSettings = document.querySelector('#btn-save-settings');

  // Fokus terakhir sebelum modal dibuka agar dapat dikembalikan ke pemicu
  let lastFocusedTrigger: HTMLElement | null = null;

  const getModalFocusables = (): HTMLElement[] => {
    if (!modalEl) return [];
    return Array.from(
      modalEl.querySelectorAll<HTMLElement>(
        'button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
    ).filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
  };

  const handleModalKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeModal();
      return;
    }
    if (e.key !== 'Tab') return;
    // Pembatasan pergerakan Tab di dalam modal (focus trap)
    const focusables = getModalFocusables();
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement as HTMLElement | null;
    const isInside = active !== null && modalEl?.contains(active);
    if (e.shiftKey && (active === first || !isInside)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !isInside)) {
      e.preventDefault();
      first.focus();
    }
  };

  const openModal = () => {
    if (settingsSaving) return;
    showSettingsStatus('');
    isSettingsModalOpen = true;
    lastFocusedTrigger = document.activeElement as HTMLElement | null;
    updateSettingsFormInputs();
    updateModalPlanPreview();
    modalEl?.classList.add('active');
    syncTauriWindowState(currentIslandState, true);
    document.addEventListener('keydown', handleModalKeydown);
    // Fokus awal ke elemen interaktif pertama di dalam modal
    getModalFocusables()[0]?.focus();
  };

  const closeModal = () => {
    if (settingsSaving) return;
    settingsReadVersion++;
    isSettingsModalOpen = false;
    modalEl?.classList.remove('active');
    syncTauriWindowState(currentIslandState, false);
    document.removeEventListener('keydown', handleModalKeydown);
    // Kembalikan fokus ke elemen pemicu pembukaan modal
    lastFocusedTrigger?.focus?.();
    lastFocusedTrigger = null;
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
    void saveSettingsFromModal(closeModal);
  });
}

function updateSettingsFormInputs() {
  const cfg = appState.config;
  const target = cfg.totalDurationMin;
  const hours = Math.floor(target / 60);
  const mins = target % 60;

  const hInput = document.querySelector<HTMLInputElement>('#setting-total-hours');
  const mInput = document.querySelector<HTMLInputElement>('#setting-total-mins');
  const autoBInput = document.querySelector<HTMLInputElement>('#setting-auto-break');
  const autoFInput = document.querySelector<HTMLInputElement>('#setting-auto-focus');

  if (hInput) hInput.value = String(hours);
  if (mInput) mInput.value = String(mins);
  if (autoBInput) autoBInput.checked = cfg.autostartBreak;
  if (autoFInput) autoFInput.checked = cfg.autostartNextFocus;
  const hoverInput = document.querySelector<HTMLInputElement>('#setting-hover');
  if (hoverInput) hoverInput.checked = cfg.hoverEnabled === true;
  const momoIntensity = document.querySelector<HTMLSelectElement>('#setting-momo-intensity');
  if (momoIntensity) momoIntensity.value = cfg.momoIntensity ?? 'expressive';

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
  const saveButton = document.querySelector<HTMLButtonElement>('#btn-save-settings');
  const version = ++settingsReadVersion;
  settingsStartupStatus = null;
  if (autoAppInput) { autoAppInput.disabled = true; autoAppInput.checked = false; }
  if (!isTauri()) {
    showSettingsStatus('Startup otomatis hanya tersedia di aplikasi desktop.');
    return;
  }
  if (saveButton) saveButton.disabled = true;
  showSettingsStatus('Membaca pengaturan startup…');
  void isAutostartEnabled().then((enabled) => {
    if (version !== settingsReadVersion) return;
    settingsStartupStatus = enabled;
    if (autoAppInput) {
      autoAppInput.disabled = enabled === null;
      autoAppInput.checked = enabled === true;
    }
    if (saveButton) saveButton.disabled = false;
    showSettingsStatus(enabled === null
      ? 'Status startup gagal dibaca. Preferensi lain dapat disimpan; startup tidak akan diubah.' : '');
  });
}

function updateModalPlanPreview() {
  const result = readSettingsDuration();
  const summaryEl = document.querySelector<HTMLElement>('#preview-plan-summary');
  const trackEl = document.querySelector<HTMLElement>('#modal-preview-timeline-track');
  const alertEl = document.querySelector<HTMLElement>('#preview-shortened-alert');
  const cardTotalEl = document.querySelector<HTMLElement>('#summary-card-total');
  const cardFocusEl = document.querySelector<HTMLElement>('#summary-card-focus');
  const cardBreakEl = document.querySelector<HTMLElement>('#summary-card-break');
  const rangeMetaEl = document.querySelector<HTMLElement>('#preview-total-duration-label');
  const activeSessionTextEl = document.querySelector<HTMLElement>('#preview-active-session-text');
  const footerStatsEl = document.querySelector<HTMLElement>('#modal-footer-stats');

  if (!result.valid) {
    if (summaryEl) {
      summaryEl.innerText = `Peringatan: ${result.message}`;
      summaryEl.style.color = '#ff8080';
    }
    if (alertEl) alertEl.style.display = 'none';
    if (trackEl) trackEl.innerHTML = '';
    for (const element of [cardTotalEl, cardFocusEl, cardBreakEl, rangeMetaEl, activeSessionTextEl, footerStatsEl]) {
      if (element) element.innerText = '—';
    }
    return;
  }

  if (summaryEl) {
    summaryEl.style.color = '';
  }

  const plan = buildPomodoroPlan(result.total, result.focus, result.rest);

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
    activeSessionTextEl.innerText = getFirstPhasePreview(plan);
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

async function saveSettingsFromModal(onSuccess: () => void) {
  if (settingsSaving) return;
  const result = readSettingsDuration();
  if (!result.valid) {
    showSettingsStatus(result.message);
    document.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus();
    return;
  }
  const tempPlan = buildPomodoroPlan(result.total, result.focus, result.rest);
  const newConfig: PomodoroConfig = {
    ...appState.config,
    focusTargetMin: undefined,
    hoverEnabled: document.querySelector<HTMLInputElement>('#setting-hover')?.checked ?? false,
    momoIntensity: document.querySelector<HTMLSelectElement>('#setting-momo-intensity')?.value === 'calm' ? 'calm' : 'expressive',
    totalDurationMin: tempPlan.totalDurationMin,
    focusDurationMin: result.focus,
    breakDurationMin: result.rest,
    autostartBreak: document.querySelector<HTMLInputElement>('#setting-auto-break')?.checked ?? appState.config.autostartBreak,
    autostartNextFocus: document.querySelector<HTMLInputElement>('#setting-auto-focus')?.checked ?? appState.config.autostartNextFocus,
    alwaysOnTop: isAlwaysOnTopActive,
    targetDailySessions: tempPlan.focusSessionCount,
    seasonMode: document.querySelector<HTMLInputElement>('#season-mode-manual')?.checked ? 'manual' : 'cycle',
  };
  const chosenSeason = document.querySelector<HTMLSelectElement>('#setting-manual-season')?.value;
  if (!['spring', 'summer', 'autumn', 'winter'].includes(chosenSeason ?? '')) {
    showSettingsStatus('Pilih musim yang tersedia.');
    return;
  }
  const scheduleChanged = hasScheduleChanged(appState.config, newConfig);
  const active = ['running', 'paused', 'waiting_next'].includes(engine.getStatus());
  if (scheduleChanged && active && !confirm('Durasi berubah. Hentikan rencana aktif dan siapkan rencana baru dari awal?')) return;

  const startupBefore = settingsStartupStatus;
  const startupAfter = document.querySelector<HTMLInputElement>('#setting-autostart-app')?.checked ?? startupBefore;
  const changeStartup = startupBefore !== null && startupAfter !== startupBefore;
  const controls = Array.from(document.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>(
    '#modal-settings input, #modal-settings select, #modal-settings button'));
  const disabledBefore = controls.map(control => control.disabled);
  settingsSaving = true;
  controls.forEach(control => { control.disabled = true; });
  showSettingsStatus('Menyimpan pengaturan…');
  try {
    if (changeStartup && !await setAutostartEnabled(startupAfter!)) {
      showSettingsStatus('Gagal mengubah startup otomatis. Pengaturan belum disimpan. Coba lagi.');
      return;
    }
    // Capture progress after the native operation so timer completions are retained.
    const candidate: StoredAppState = {
      ...appState,
      config: { ...newConfig, volume: appState.config.volume, alwaysOnTop: isAlwaysOnTopActive },
      progress: { ...appState.progress, currentSeason: newConfig.seasonMode === 'manual'
        ? chosenSeason as IslandSeason : appState.progress.currentSeason },
      timerSession: scheduleChanged ? null : engine.getSnapshot(),
    };
    if (!saveAppState(candidate)) {
      const rolledBack = !changeStartup || await setAutostartEnabled(startupBefore!);
      if (!rolledBack) settingsStartupStatus = startupAfter!;
      showSettingsStatus(rolledBack
        ? 'Gagal menyimpan pengaturan di perangkat. Perubahan belum diterapkan; coba lagi.'
        : 'Penyimpanan gagal. Startup sudah berubah dan gagal dikembalikan; preferensi lain belum diterapkan.');
      return;
    }
    appState = candidate;
    musicMomo?.refresh();
    settingsStartupStatus = changeStartup ? startupAfter! : startupBefore;
    const wasActive = ['running', 'paused', 'waiting_next'].includes(engine.getStatus());
    engine.updateConfig(candidate.config);
    if (scheduleChanged && wasActive) engine.rebuildPlan();
    if (newConfig.seasonMode === 'manual') renderer?.setSeason(chosenSeason as IslandSeason);
    syncUI();
  } finally {
    settingsSaving = false;
    controls.forEach((control, index) => { control.disabled = disabledBefore[index]; });
  }
  showSettingsStatus('');
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
  appState.lastActiveDate = today;

  saveAppState(appState);
  syncUI();
}
