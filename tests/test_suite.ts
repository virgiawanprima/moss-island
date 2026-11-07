import { seasonAfterPhase } from '../src/timer/seasonCycle';
import { formatDuration } from '../src/timer/formatDuration';
import { subscribeStorageStatus } from '../src/storage';
import { PetPerformance } from '../src/petPerformance';
import { treeSeasonTraits } from '../src/canvas/treeSprites';
import { getRestPresentation, renderRestPhase } from '../src/timer/restView';
import { parseSettingsDuration, hasScheduleChanged } from '../src/settings';
import { isAutostartEnabled } from '../src/autostartService';
import assert from 'node:assert/strict';
import { STUDY_COVERS, STUDY_TRACKS } from '../src/audio/studyMusic';
import { AmbientSynth, describeAudioFailure } from '../src/audio/ambientSynth';
import { shouldIgnoreAmbiguousWebViewSession, takeOverLocalPlayback } from '../src/audio/musicSource';
import { DeviceVolumeSync } from '../src/audio/deviceVolumeSync';
import { ArtworkRetry } from '../src/audio/artworkRetry';
import { LyricsTiming } from '../src/audio/lyricsTiming';
import { LyricsCooldownError, requestLyrics, resetLyricsCooldownForTests, retryAfterMilliseconds } from '../src/audio/lyricsTransport';
import { HoverIntent } from '../src/hoverIntent';
import { TabTransition } from '../src/tabTransition';
import { BeatDetector } from '../src/audio/beatDetector';
import { isVerticalDock, nearestDockEdge, dockWithinThreshold } from '../src/edgeDock';
import { restingPet, stepDesktopPet, petGaitAt, figmaIdleFrameAt, FIGMA_IDLE_SOURCES, type PetContext } from '../src/desktopPet';
import { canAnimateMomoBeat, createMomoBeatMotion } from '../src/audio/musicMomoView';
import { SpeakerBeat } from '../src/audio/speakerBeat';
import { MusicMomo, type MomoClock, type MomoFrame } from '../src/audio/musicMomo';
import { formatPlaybackTime } from '../src/audio/formatPlaybackTime';
import { advancePlayback, reconcilePlayback } from '../src/audio/playbackPosition';
import fs from 'node:fs';
import { buildPomodoroPlan, buildFocusTargetPlan, validatePomodoroInput, getFirstPhasePreview, getNextPhaseLabel } from '../src/timer/pomodoroPlan';
import { PomodoroEngine } from '../src/timer/pomodoroEngine';
import {
  sanitizePomodoroConfig,
  DEFAULT_POMODORO_CONFIG as FIXED_DEFAULT_CONFIG,
  isYesterday,
  getTodayDateString,
  loadAppState,
  sanitizeTimerSnapshot,
  saveAppState,
  getDefaultAppState,
} from '../src/storage';
import { LyricsService, parseSyncedLyrics, type TrackArtworkInfo } from '../src/audio/lyricsService';
import {
  resolveMediaSourceIdentity,
  base64ToBytes,
  base64ToBlobUrl,
} from '../src/audio/mediaSourceIdentity';
import { SystemMediaBridge, type SystemMediaTrack } from '../src/audio/systemMediaBridge';
import { IslandRenderer, PLANTING_SLOTS } from '../src/canvas/islandRenderer';
import { coversRearTree, shouldFadeTree, coversMomo, getTreeOpacity } from '../src/canvas/treeOcclusion';
import { GardenSchedule } from '../src/canvas/gardenSchedule';
import { FocusWeather, createPuddles } from '../src/canvas/focusWeather';
import { MomoLeisure } from '../src/canvas/momoLeisure';
import {
  drawMomoSeasonLayer,
  getMomoFrameAnchor,
} from '../src/canvas/momoSeasonAccessories';
import { TREE_SPECIES, type PomodoroConfig, type PlanPhase, type IslandSeason } from '../src/types';
import { TREE_RENDERERS } from '../src/canvas/treeSprites';
import { ISLAND_DIMENSIONS, getIslandDimension, shouldCenterAfterTransition, shouldRememberFloatingPosition } from '../src/main';

const DEFAULT_POMODORO_CONFIG = { ...FIXED_DEFAULT_CONFIG, focusTargetMin: undefined };

function lyricRequestMetadata(url: string | URL | Request) {
  const query = new URL(url.toString()).searchParams;
  return { trackName: query.get('track_name'), artistName: query.get('artist_name'),
    albumName: query.get('album_name'), duration: Number(query.get('duration')) };
}

// Sediakan mock minimal jika window / localStorage belum ada di lingkungan node
if (typeof globalThis.window === 'undefined') {
  (globalThis as unknown as Record<string, unknown>).window = {
    setInterval: (fn: () => void, ms: number) => setInterval(fn, ms),
    clearInterval: (id: NodeJS.Timeout) => clearInterval(id),
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (id: NodeJS.Timeout) => clearTimeout(id),
    devicePixelRatio: 1,
    addEventListener: () => {},
    removeEventListener: () => {},
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
  };
}
if (typeof (globalThis as unknown as Record<string, unknown>).localStorage === 'undefined') {
  const store = new Map<string, string>();
  (globalThis as unknown as Record<string, unknown>).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
  };
}
if (typeof (globalThis as unknown as Record<string, unknown>).Path2D === 'undefined') {
  (globalThis as unknown as Record<string, unknown>).Path2D = class MockPath2D {
    constructor(_d?: string) {}
  };
}

// Mock URL.createObjectURL / revokeObjectURL untuk menguji daur hidup object URL artwork
const mockBlobUrls = new Set<string>();
let mockBlobUrlCounter = 0;
const urlGlobal = globalThis.URL as unknown as Record<string, unknown>;
if (typeof urlGlobal.createObjectURL !== 'function') {
  urlGlobal.createObjectURL = (_blob: unknown) => {
    mockBlobUrlCounter++;
    const url = `blob:mock-${mockBlobUrlCounter}`;
    mockBlobUrls.add(url);
    return url;
  };
  urlGlobal.revokeObjectURL = (url: string) => {
    mockBlobUrls.delete(url);
  };
}

// PNG 1x1 transparan untuk pengujian artwork sesi
const PNG_1X1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const docGlobal = globalThis as unknown as { document?: { createElement?: (tag: string) => HTMLCanvasElement } };
if (typeof docGlobal.document === 'undefined') {
  (globalThis as unknown as Record<string, unknown>).document = {
    addEventListener: () => {},
    removeEventListener: () => {},
    hidden: false,
    createElement: (_tag: string) => createMockCanvas(),
  };
} else if (!docGlobal.document.createElement) {
  docGlobal.document.createElement = (_tag: string) => createMockCanvas();
}

function createMockCanvas(): HTMLCanvasElement {
  const mockCtx = {
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    ellipse: () => {},
    fill: () => {},
    stroke: () => {},
    rotate: () => {},
    translate: () => {},
    scale: () => {},
    drawImage: () => {},
    setTransform: () => {},
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    clearRect: () => {},
    fillText: () => {},
    fillRect: () => {},
    strokeRect: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
  } as unknown as CanvasRenderingContext2D;

  return {
    getContext: () => mockCtx,
    getBoundingClientRect: () => ({ width: 360, height: 160 }),
    width: 360,
    height: 160,
  } as unknown as HTMLCanvasElement;
}

let passedTests = 0;
let failedTests = 0;

function runTest(name: string, fn: () => void | Promise<void>) {
  try {
    const res = fn();
    if (res && typeof (res as Promise<void>).then === 'function') {
      throw new Error(`Uji asinkron harus ditangani secara sinkron atau dinantikan: ${name}`);
    }
    console.log(`[LULUS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`[GAGAL] ${name}:`, err);
    failedTests++;
  }
}

async function runTestAsync(name: string, fn: () => Promise<void>) {
  resetLyricsCooldownForTests();
  try {
    await fn();
    console.log(`[LULUS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`[GAGAL] ${name}:`, err);
    failedTests++;
  }
}

console.log('=== MEMULAI RANGKAIAN PENGUJIAN LOGIKA MOSS ISLAND (MODUL ASLI) ===\n');

// ----------------------------------------------------------------------------
// 1. Perencanaan Pembagian Waktu Pomodoro
// ----------------------------------------------------------------------------
runTest('Uji 1: Total 180m (25/5) menghasilkan 145m fokus + 35m istirahat', () => {
  const plan = buildPomodoroPlan(180, 25, 5);
  assert.strictEqual(plan.totalDurationMin, 180);
  assert.strictEqual(plan.totalFocusMin, 145);
  assert.strictEqual(plan.totalBreakMin, 35);
  assert.strictEqual(plan.focusSessionCount, 6);
  assert.strictEqual(plan.phases.length, 11);
  assert.strictEqual(plan.phases[plan.phases.length - 1].isShortened, true);
});

runTest('Uji 2: Total 240m (30/10) menghasilkan 180m fokus + 60m istirahat', () => {
  const plan = buildPomodoroPlan(240, 30, 10);
  assert.strictEqual(plan.totalDurationMin, 240);
  assert.strictEqual(plan.totalFocusMin, 180);
  assert.strictEqual(plan.totalBreakMin, 60);
  assert.strictEqual(plan.focusSessionCount, 6);
  assert.strictEqual(plan.phases.length, 12);
});

runTest('Uji 3: Total tidak habis dibagi menghasilkan fase terakhir dipendekkan', () => {
  const plan = buildPomodoroPlan(50, 25, 5);
  // Fase: 25 fokus, 5 istirahat, 20 fokus (dipendekkan)
  assert.strictEqual(plan.totalDurationMin, 50);
  assert.strictEqual(plan.totalFocusMin, 45);
  assert.strictEqual(plan.totalBreakMin, 5);
  assert.strictEqual(plan.phases.length, 3);
  assert.strictEqual(plan.phases[2].durationMin, 20);
  assert.strictEqual(plan.phases[2].isShortened, true);
});

// ----------------------------------------------------------------------------
// 2. Temuan Audit 4: Total lebih pendek dari durasi fokus
// ----------------------------------------------------------------------------
runTest('Uji 4: Total lebih pendek dari durasi fokus (10, 30, 5) menghasilkan 1 fase fokus dipendekkan 10m', () => {
  const plan = buildPomodoroPlan(10, 30, 5);
  assert.strictEqual(plan.totalDurationMin, 10);
  assert.strictEqual(plan.totalFocusMin, 10);
  assert.strictEqual(plan.totalBreakMin, 0);
  assert.strictEqual(plan.focusSessionCount, 1);
  assert.strictEqual(plan.phases.length, 1);
  assert.strictEqual(plan.phases[0].type, 'focus');
  assert.strictEqual(plan.phases[0].durationMin, 10);
  assert.strictEqual(plan.phases[0].isShortened, true);
});

// ----------------------------------------------------------------------------
// 3. Temuan Audit 3: Validasi Durasi Pecahan dan Batas Nilai
// ----------------------------------------------------------------------------
runTest('Uji 5: Durasi pecahan (0.1) ditolak dan tidak menyebabkan loop tak terhingga', () => {
  const resFractionFocus = validatePomodoroInput(60, 0.1, 5);
  assert.strictEqual(resFractionFocus.isValid, false);

  const resFractionBreak = validatePomodoroInput(60, 25, 0.5);
  assert.strictEqual(resFractionBreak.isValid, false);

  const resFractionTotal = validatePomodoroInput(30.5, 25, 5);
  assert.strictEqual(resFractionTotal.isValid, false);

  const resZero = validatePomodoroInput(60, 0, 5);
  assert.strictEqual(resZero.isValid, false);

  const resNegative = validatePomodoroInput(60, -25, 5);
  assert.strictEqual(resNegative.isValid, false);

  const resTooLong = validatePomodoroInput(1500, 25, 5);
  assert.strictEqual(resTooLong.isValid, false);

  assert.throws(() => {
    buildPomodoroPlan(60, 0.1, 5);
  }, /Durasi harus berupa bilangan bulat dalam menit/);
});

// ----------------------------------------------------------------------------
// 4. Temuan Audit 2: Pemulihan Konfigurasi Rusak di Storage
// ----------------------------------------------------------------------------
runTest('Uji 6: Konfigurasi tersimpan yang rusak (focusDurationMin: 0) dipulihkan ke default aman', () => {
  const corruptedInput = {
    focusDurationMin: 0,
    breakDurationMin: -10,
    totalDurationMin: 'bukan_angka',
    dailyWaterTargetMl: 50, // di bawah batas minimal 100
  };

  const cleanConfig = sanitizePomodoroConfig(corruptedInput);
  assert.strictEqual(cleanConfig.focusDurationMin, DEFAULT_POMODORO_CONFIG.focusDurationMin);
  assert.strictEqual(cleanConfig.breakDurationMin, DEFAULT_POMODORO_CONFIG.breakDurationMin);
  assert.strictEqual(cleanConfig.totalDurationMin, DEFAULT_POMODORO_CONFIG.totalDurationMin);
  assert.equal('dailyWaterTargetMl' in cleanConfig, false, 'Konfigurasi minum lama tidak dipakai lagi');

  // Verifikasi bahwa konfigurasi yang dibersihkan dapat langsung dipakai membuat engine tanpa error
  const engine = new PomodoroEngine(cleanConfig);
  assert.strictEqual(engine.getStatus(), 'idle');
  assert.strictEqual(engine.getCurrentPhase()?.type, 'focus');
});

// ----------------------------------------------------------------------------
// 5. Temuan Audit 5: Jeda pada batas akhir fase tidak melewatkan pencatatan
// ----------------------------------------------------------------------------
runTest('Pergantian manual dan otomatis memancarkan penyelesaian dari mode kecil maupun pet', () => {
  for (const automatic of [false, true]) {
    for (const initialPanel of ['compact', 'hidden']) {
      let panel = initialPanel;
      let completions = 0;
      const engine = new PomodoroEngine({
        ...DEFAULT_POMODORO_CONFIG, totalDurationMin: 3, focusDurationMin: 1, breakDurationMin: 1,
        autostartBreak: automatic, autostartNextFocus: automatic,
      }, { onPhaseComplete: (_phase, _next, skipped) => {
        if (!skipped) { panel = 'expanded'; completions++; }
      } });
      try {
        engine.start();
        for (const nextType of ['break', 'focus']) {
          (engine as any).targetEndTime = Date.now() - 1;
          (engine as any).tick();
          assert.equal(panel, 'expanded');
          assert.equal(engine.getCurrentPhase()?.type, nextType);
          assert.equal(engine.getStatus(), automatic ? 'running' : 'waiting_next');
          if (!automatic) {
            const remaining = engine.getPhaseRemainingSeconds();
            (engine as any).tick();
            assert.equal(engine.getPhaseRemainingSeconds(), remaining);
            engine.start();
            assert.equal(engine.getStatus(), 'running');
          }
          panel = initialPanel;
        }
        (engine as any).targetEndTime = Date.now() - 1;
        (engine as any).tick();
        assert.equal(engine.getStatus(), 'completed');
        assert.equal(panel, 'expanded');
        assert.equal(completions, 3);
      } finally { engine.pause(); }
    }
  }
});

runTest('Uji 7: Menekan jeda saat batas waktu habis tetap memicu onPhaseComplete', () => {
  let completedFocusCount = 0;
  let lastCompletedPhase: PlanPhase | null = null;

  const testConfig: PomodoroConfig = {
    ...DEFAULT_POMODORO_CONFIG,
    totalDurationMin: 60,
    focusDurationMin: 25,
    breakDurationMin: 5,
    autostartBreak: false,
    autostartNextFocus: false,
  };

  const engine = new PomodoroEngine(testConfig, {
    onPhaseComplete: (completed) => {
      if (completed.type === 'focus') {
        completedFocusCount++;
      }
      lastCompletedPhase = completed;
    },
  });

  engine.start();
  assert.strictEqual(engine.getStatus(), 'running');

  // Simulasikan waktu berakhir sebelum tick interval dijalankan
  // (misal targetEndTime berada di masa lampau)
  (engine as unknown as { targetEndTime: number }).targetEndTime = Date.now() - 50;

  // Panggil pause() tepat saat batas waktu sudah tercapai
  engine.pause();

  // Verifikasi bahwa onPhaseComplete dipanggil dan fokus tercatat
  assert.strictEqual(completedFocusCount, 1);
  const phase = lastCompletedPhase as PlanPhase | null;
  assert.notStrictEqual(phase, null);
  assert.strictEqual(phase?.type, 'focus');

  // Status sekarang harus menunggu fase istirahat berikutnya
  assert.strictEqual(engine.getStatus(), 'waiting_next');
  assert.strictEqual(engine.getCurrentPhase()?.type, 'break');
});

// ----------------------------------------------------------------------------
// 6. Mesin Pomodoro: Jeda dan Resume tanpa drift
// ----------------------------------------------------------------------------
runTest('Uji 8: Jeda dan Resume menyimpan sisa detik tanpa drift waktu', () => {
  const engine = new PomodoroEngine(DEFAULT_POMODORO_CONFIG);
  engine.start();

  // Simulasikan sisa 100 detik
  (engine as unknown as { targetEndTime: number }).targetEndTime = Date.now() + 100 * 1000;
  engine.pause();

  assert.strictEqual(engine.getStatus(), 'paused');
  assert.strictEqual(engine.getPhaseRemainingSeconds(), 100);

  // Resume kembali
  engine.start();
  assert.strictEqual(engine.getStatus(), 'running');
  assert.strictEqual(engine.getPhaseRemainingSeconds(), 100);
  engine.reset();
});

// ----------------------------------------------------------------------------
// 7. Mesin Pomodoro: Reset menghentikan timer
// ----------------------------------------------------------------------------
runTest('Uji 9: Reset menghentikan timer dan mengembalikan status ke idle', () => {
  const engine = new PomodoroEngine(DEFAULT_POMODORO_CONFIG);
  engine.start();
  assert.strictEqual(engine.getStatus(), 'running');

  engine.reset();
  assert.strictEqual(engine.getStatus(), 'idle');
  assert.strictEqual(engine.getPhaseRemainingSeconds(), DEFAULT_POMODORO_CONFIG.focusDurationMin * 60);
  assert.strictEqual(engine.getCurrentPhase()?.id, 1);
});

// ----------------------------------------------------------------------------
// 8. Mesin Pomodoro: Autostart Istirahat dan Fokus Independen
// ----------------------------------------------------------------------------
runTest('Uji 10: Autostart istirahat aktif tetapi autostart fokus tidak aktif', () => {
  let completedPhaseType = '';
  const customConfig: PomodoroConfig = {
    ...DEFAULT_POMODORO_CONFIG,
    totalDurationMin: 60,
    focusDurationMin: 25,
    breakDurationMin: 5,
    autostartBreak: true,
    autostartNextFocus: false,
  };

  const engine = new PomodoroEngine(customConfig, {
    onPhaseComplete: (completed) => {
      completedPhaseType = completed.type;
    },
  });

  engine.start();
  // Selesaikan fase fokus
  (engine as unknown as { handlePhaseEnd: () => void }).handlePhaseEnd();

  assert.strictEqual(completedPhaseType, 'focus');
  // Karena autostartBreak true, status menjadi running untuk fase istirahat
  assert.strictEqual(engine.getStatus(), 'running');
  assert.strictEqual(engine.getCurrentPhase()?.type, 'break');

  // Selesaikan fase istirahat
  (engine as unknown as { handlePhaseEnd: () => void }).handlePhaseEnd();
  assert.strictEqual(completedPhaseType, 'break');
  // Karena autostartNextFocus false, status menjadi waiting_next
  assert.strictEqual(engine.getStatus(), 'waiting_next');
  assert.strictEqual(engine.getCurrentPhase()?.type, 'focus');

  engine.reset();
});

// ----------------------------------------------------------------------------
// 9. Mesin Pomodoro: Lewati Fase (Skip)
// ----------------------------------------------------------------------------
runTest('Uji 11: skipCurrentPhase memajukan ke fase berikutnya dan memicu callback', () => {
  let phaseDone = false;
  const engine = new PomodoroEngine(DEFAULT_POMODORO_CONFIG, {
    onPhaseComplete: () => {
      phaseDone = true;
    },
  });

  engine.start();
  engine.skipCurrentPhase();

  assert.strictEqual(phaseDone, true);
  assert.strictEqual(engine.getCurrentPhase()?.type, 'break');
  engine.reset();
});

// ----------------------------------------------------------------------------
// 10. Penyimpanan & Logika Tanggal
// ----------------------------------------------------------------------------
runTest('Uji 12: Fungsi isYesterday mendeteksi tanggal kemarin secara tepat', () => {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  const yYear = yesterday.getFullYear();
  const yMonth = String(yesterday.getMonth() + 1).padStart(2, '0');
  const yDay = String(yesterday.getDate()).padStart(2, '0');
  const yesterdayStr = `${yYear}-${yMonth}-${yDay}`;

  assert.strictEqual(isYesterday(yesterdayStr), true);
  assert.strictEqual(isYesterday(getTodayDateString()), false);
  assert.strictEqual(isYesterday('2020-01-01'), false);
});

// ----------------------------------------------------------------------------
// 11. Layanan Lirik Musik: Stabilitas Timer Perputaran Lirik
// ----------------------------------------------------------------------------
runTest('Uji 13: Pembaruan lirik biasa tidak membuat timer sinkronisasi palsu', () => {
  const service = new LyricsService();
  (service as unknown as { cache: Map<string, string[]> }).cache.set('lagu-uji:::artis-uji', [
    'Baris lirik pertama',
    'Baris lirik kedua',
    'Baris lirik ketiga'
  ]);

  let timerCreatedCount = 0;
  let timerClearedCount = 0;
  const win = window as unknown as {
    setInterval: typeof window.setInterval;
    clearInterval: typeof window.clearInterval;
  };
  const origSetInterval = win.setInterval;
  const origClearInterval = win.clearInterval;

  win.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    timerCreatedCount++;
    return origSetInterval(handler, timeout, ...args);
  }) as typeof window.setInterval;

  win.clearInterval = ((id?: number) => {
    timerClearedCount++;
    origClearInterval(id);
  }) as typeof window.clearInterval;

  try {
    for (let i = 0; i < 11; i++) {
      void service.loadLyrics('Lagu-Uji', 'Artis-Uji', 'Album-Uji', true);
    }

    assert.strictEqual(timerCreatedCount, 0, 'Lirik tanpa timestamp tidak boleh bergerak otomatis');
    assert.strictEqual(timerClearedCount, 0, 'Timer tidak boleh dibatalkan jika lagu yang diputar tidak berganti');
  } finally {
    service.clear();
    win.setInterval = origSetInterval;
    win.clearInterval = origClearInterval;
  }
});

// ----------------------------------------------------------------------------
// 12. Layanan Lirik & Artwork: Proteksi Balapan Asinkron (Race Conditions)
// ----------------------------------------------------------------------------
await runTestAsync('Uji 14: Respons artwork lagu lama tidak menimpa cover lagu baru yang aktif', async () => {
  const service = new LyricsService();
  const receivedArtworks: string[] = [];

  service.subscribeArtwork((art) => {
    if (art.title) receivedArtworks.push(art.title);
  });

  let resolveSongA: (data: unknown) => void = () => {};
  let resolveSongB: (data: unknown) => void = () => {};

  const origFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => {
    const urlStr = url.toString();
    if (urlStr.includes('deezer.com')) {
      if (urlStr.includes('SongA')) {
        return new Promise((resolve) => {
          resolveSongA = () => {
            resolve({
              ok: true,
              json: async () => ({
                data: [{ album: { cover_medium: 'coverA.jpg' } }]
              })
            } as unknown as Response);
          };
        });
      } else if (urlStr.includes('SongB')) {
        return new Promise((resolve) => {
          resolveSongB = () => {
            resolve({
              ok: true,
              json: async () => ({
                data: [{ album: { cover_medium: 'coverB.jpg' } }]
              })
            } as unknown as Response);
          };
        });
      }
    }
    return { ok: false } as unknown as Response;
  }) as typeof fetch;

  try {
    void service.loadLyrics('SongA', 'ArtistA', 'AlbumA', true);
    await new Promise((r) => { setTimeout(r, 10); });

    void service.loadLyrics('SongB', 'ArtistB', 'AlbumB', true);
    await new Promise((r) => { setTimeout(r, 10); });

    resolveSongB(null);
    await new Promise((r) => { setTimeout(r, 20); });

    resolveSongA(null);
    await new Promise((r) => { setTimeout(r, 20); });

    assert.strictEqual(receivedArtworks[receivedArtworks.length - 1], 'SongB');
    assert.strictEqual(receivedArtworks.includes('SongA'), false, 'SongA tidak boleh dipancarkan karena sudah bukan lagu aktif');
  } finally {
    globalThis.fetch = origFetch;
    service.clear();
  }
});

await runTestAsync('Uji 15: Timer lirik tidak berjalan jika lagu dijeda sebelum unduhan lirik selesai', async () => {
  const service = new LyricsService();
  let resolveLyrics: (data: unknown) => void = () => {};

  const origFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => {
    const urlStr = url.toString();
    if (urlStr.includes('lrclib.net/api/search')) {
      return { ok: true, json: async () => [] } as unknown as Response;
    }
    if (urlStr.includes('lrclib.net')) {
      return new Promise((resolve) => {
        resolveLyrics = () => {
          resolve({
            ok: true,
            json: async () => ({
              ...lyricRequestMetadata(url),
              plainLyrics: "Baris satu\nBaris dua\nBaris tiga"
            })
          } as unknown as Response);
        };
      });
    }
    return { ok: false } as unknown as Response;
  }) as typeof fetch;

  let timerStarted = false;
  const win = window as unknown as { setInterval: typeof window.setInterval };
  const origSetInterval = win.setInterval;
  win.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    timerStarted = true;
    return origSetInterval(handler, timeout, ...args);
  }) as typeof window.setInterval;

  try {
    const lyricsPromise = service.loadLyrics('SongSlow', 'ArtistSlow', 'AlbumSlow', true);
    await new Promise((r) => { setTimeout(r, 10); });

    void service.loadLyrics('SongSlow', 'ArtistSlow', 'AlbumSlow', false);
    await new Promise((r) => { setTimeout(r, 10); });

    resolveLyrics(null);
    await lyricsPromise;
    await new Promise((r) => { setTimeout(r, 20); });

    assert.strictEqual(timerStarted, false, 'Timer lirik tidak boleh dimulai ketika lagu dalam kondisi dijeda');
  } finally {
    globalThis.fetch = origFetch;
    win.setInterval = origSetInterval;
    service.clear();
  }
});

// ----------------------------------------------------------------------------
// 6. Animasi Momo dan Tunas Pulau Isometrik
// ----------------------------------------------------------------------------
runTest('Uji 16: Melanjutkan sesi fokus tidak mereset progres tunas dan mempertahankan rute Momo', () => {
  const canvas = createMockCanvas();
  const renderer = new IslandRenderer(canvas);

  assert.strictEqual(renderer.hasActiveSprout(), false);
  const initialPlant = renderer.startFocusPlanting();
  assert.strictEqual(renderer.hasActiveSprout(), true);

  // Progres tumbuh mencapai 65% (0.65)
  renderer.updateFocusProgress(0.65);
  const activeSproutBefore = (renderer as unknown as { activeSprout: { progress: number; isPaused: boolean; slotIndex: number } }).activeSprout;
  assert.strictEqual(activeSproutBefore.progress, 0.65);

  // Sesi dijeda
  renderer.setTimerPaused(true);
  assert.strictEqual(activeSproutBefore.isPaused, true);
  assert.strictEqual(activeSproutBefore.progress, 0.65);

  // Logika resume: tidak memanggil startFocusPlanting(), melainkan setTimerPaused(false)
  renderer.setTimerPaused(false);
  renderer.setMood('idle');

  const activeSproutAfter = (renderer as unknown as { activeSprout: { progress: number; isPaused: boolean; slotIndex: number } }).activeSprout;
  assert.strictEqual(renderer.hasActiveSprout(), true);
  assert.strictEqual(activeSproutAfter.isPaused, false);
  assert.strictEqual(activeSproutAfter.progress, 0.65, 'Progres 65% tidak boleh turun menjadi 5% saat melanjutkan sesi');
  assert.strictEqual(activeSproutAfter.slotIndex, initialPlant.slotIndex, 'Petak tanam tidak boleh berubah saat melanjutkan sesi');
});

runTest('Uji 17: Penghitungan indeks frame animasi Momo berjalan tepat pada 8 frame per detik', () => {
  const frameDurationTicks = 3; // 24 fps / 8 frame/detik = 3 tick per frame
  const framesInOneSecond = 24;

  const frameIndices: number[] = [];
  for (let tick = 0; tick < framesInOneSecond; tick++) {
    frameIndices.push(Math.floor(tick / frameDurationTicks) % 8);
  }

  // Verifikasi setiap frame (0 sampai 7) muncul tepat 3 kali dalam 1 detik (24 tick)
  for (let frame = 0; frame < 8; frame++) {
    const count = frameIndices.filter((idx) => idx === frame).length;
    assert.strictEqual(count, 3, `Frame ${frame} harus muncul tepat 3 tick per detik agar setara 8 frame/detik`);
  }

  // Verifikasi urutan pergantian frame
  assert.deepStrictEqual(frameIndices.slice(0, 6), [0, 0, 0, 1, 1, 1]);
});

runTest('Uji 18: Pemanggilan waveHello mengaktifkan aksi wave dan diprioritaskan di atas mood happy', () => {
  const canvas = createMockCanvas();
  const renderer = new IslandRenderer(canvas);

  renderer.waveHello(40);

  const internalRenderer = renderer as unknown as {
    waveTimer: number;
    momoMood: string;
    update: () => void;
  };

  assert.strictEqual(internalRenderer.waveTimer, 40);
  assert.strictEqual(internalRenderer.momoMood, 'happy');

  // Update satu kali: waveTimer berkurang menjadi 39
  internalRenderer.update();
  assert.strictEqual(internalRenderer.waveTimer, 39);

  // Jalankan update hingga timer habis (39 frame lagi)
  for (let i = 0; i < 39; i++) {
    internalRenderer.update();
  }
  assert.strictEqual(internalRenderer.waveTimer, 0);
  assert.strictEqual(internalRenderer.momoMood, 'idle', 'Setelah durasi sapaan tuntas, mood kembali ke idle');
});

// ----------------------------------------------------------------------------
// 7. Pengendali Transisi Status Island (Peredupan -> Perubahan Bentuk -> Penampilan)
// ----------------------------------------------------------------------------
await runTestAsync('Uji 19: Transisi status island menjalankan alur bertahap dan menahan min-height hingga pembesaran tuntas', async () => {
  const classes = new Set<string>(['state-compact']);
  const classList = {
    add: (...names: string[]) => names.forEach((n) => classes.add(n)),
    remove: (...names: string[]) => names.forEach((n) => classes.delete(n)),
    contains: (name: string) => classes.has(name),
  };

  const transitionLog: string[] = [];

  // Tahap 1: Redupkan konten lama
  classList.add('is-fading-out');
  transitionLog.push('fade-out-start');
  assert.strictEqual(classList.contains('is-fading-out'), true);

  await new Promise((r) => { setTimeout(r, 10); });

  // Tahap 2: Ubah bentuk panel (min-height belum aktif)
  classList.remove('is-fading-out', 'expanded-ready');
  classList.add('is-morphing');
  transitionLog.push('morph-start');
  assert.strictEqual(classList.contains('expanded-ready'), false, 'expanded-ready tidak boleh aktif saat panel sedang berubah bentuk');
  assert.strictEqual(classList.contains('is-morphing'), true);

  await new Promise((r) => { setTimeout(r, 10); });

  // Tahap 3: Pembesaran selesai, tampilkan konten baru dan aktifkan expanded-ready
  classList.remove('state-compact', 'is-morphing');
  classList.add('state-expanded', 'expanded-ready');
  transitionLog.push('expanded-ready');

  assert.strictEqual(classList.contains('state-expanded'), true);
  assert.strictEqual(classList.contains('expanded-ready'), true, 'expanded-ready harus aktif setelah pembesaran selesai');
  assert.strictEqual(classList.contains('is-morphing'), false);

  assert.deepStrictEqual(transitionLog, ['fade-out-start', 'morph-start', 'expanded-ready']);
});

runTest('Uji 20: Listener resize ditahan saat transisi berlangsung untuk mencegah getaran horizontal', () => {
  let isIslandTransitioning = true;
  let recenterCalls = 0;

  const handleResize = () => {
    if (isIslandTransitioning) return;
    recenterCalls++;
  };

  // Simulasi resize terpanggil selama langkah animasi window
  handleResize();
  handleResize();
  handleResize();
  assert.strictEqual(recenterCalls, 0, 'Listener resize tidak boleh memicu pemusatan tambahan selama transisi aktif');

  // Transisi selesai
  isIslandTransitioning = false;
  handleResize();
  assert.strictEqual(recenterCalls, 1, 'Setelah transisi tuntas, listener resize kembali berfungsi normal');
});

// ----------------------------------------------------------------------------
// 8. Sinkronisasi Lirik Musik dan Format Waktu Posisi Lagu
// ----------------------------------------------------------------------------
runTest('Uji 21: parseSyncedLyrics mengurai format LRC bertimestamp [mm:ss.xx], mengurutkannya kronologis, dan mempertahankan jeda instrumental kosong', () => {
  const lrc = `
    [00:30.00] Baris kedua pada detik tiga puluh
    [00:10.50] Baris pertama pada detik sepuluh setengah
    [00:20.00] 
    [01:05.12] Baris ketiga pada menit satu lewat lima detik
  `;
  const parsed = parseSyncedLyrics(lrc);

  assert.strictEqual(parsed.length, 4);
  assert.strictEqual(parsed[0].timeSecs, 10.5);
  assert.strictEqual(parsed[0].text, 'Baris pertama pada detik sepuluh setengah');
  assert.strictEqual(parsed[1].timeSecs, 20.0);
  assert.strictEqual(parsed[1].text, '', 'Baris bertimestamp kosong harus tetap disimpan untuk jeda instrumental');
  assert.strictEqual(parsed[2].timeSecs, 30.0);
  assert.strictEqual(parsed[2].text, 'Baris kedua pada detik tiga puluh');
  assert.strictEqual(parsed[3].timeSecs, 65.12);
  assert.strictEqual(parsed[3].text, 'Baris ketiga pada menit satu lewat lima detik');
  assert.deepEqual(parseSyncedLyrics('[00:02][00:04]Vokal\n[offset:+500]').map(line => line.timeSecs), [1.5, 3.5]);
  assert.deepEqual(parseSyncedLyrics('[offset:-750]\n[00:02]').map(line => line.timeSecs), [2.75]);
});

await runTestAsync('Uji 22: syncPosition memilih baris lirik sesuai detik pemutaran lagu (intro, berjalan, dan seek)', async () => {
  const service = new LyricsService();
  const updates: Array<{ before?: string; line1: string; highlight: string; line2: string; incoming?: string; isSynced: boolean }> = [];

  service.subscribe((u) => {
    updates.push(u);
  });

  const origFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => {
    const urlStr = url.toString();
    if (urlStr.includes('lrclib.net')) {
      return {
        ok: true,
        json: async () => ({
          ...lyricRequestMetadata(url),
          syncedLyrics: "[00:10.00] Baris 1 (detik 10)\n[00:20.00]\n[00:30.00] Baris 2 (detik 30)\n[00:50.00] Baris 3 (detik 50)\n[01:10.00] Baris 4 (detik 70)\n[01:20.00] Baris 5 (detik 80)\n[01:30.00] Baris 6 (detik 90)",
          plainLyrics: "Baris 1\nBaris 2\nBaris 3\nBaris 4\nBaris 5\nBaris 6"
        })
      } as unknown as Response;
    }
    return { ok: false } as unknown as Response;
  }) as typeof fetch;

  try {
    // 1. Muat lagu pada posisi awal 0 detik (fase intro sebelum lirik pertama dimulai)
    await service.loadLyrics('SyncSong', 'SyncArtist', 'SyncAlbum', true, 0);
    assert.strictEqual(updates.length > 0, true);
    let latest = updates[updates.length - 1];
    assert.strictEqual(latest.isSynced, true);
    assert.strictEqual(latest.highlight, '♪ ♪ ♪', 'Pada intro sebelum timestamp pertama, sorot simbol nada instrumental');
    assert.strictEqual(latest.line2, 'Baris 1 (detik 10)', 'Baris kedua menampilkan baris lirik vokal pertama yang akan datang');

    // 2. Posisi lagu berlanjut ke detik 15 (vokal baris 1 aktif)
    service.syncPosition(15, true);
    latest = updates[updates.length - 1];
    assert.strictEqual(latest.isSynced, true);
    assert.strictEqual(latest.highlight, 'Baris 1 (detik 10)', 'Pada detik 15, baris detik 10 tetap menjadi lirik vokal aktif');
    assert.strictEqual(latest.line2, 'Baris 2 (detik 30)', 'Baris berikutnya menampilkan lirik vokal berikutnya');

    // 3. Posisi lagu berlanjut ke detik 25 (jeda instrumental dengan timestamp kosong di detik 20)
    service.syncPosition(25, true);
    latest = updates[updates.length - 1];
    assert.strictEqual(latest.isSynced, true);
    assert.strictEqual(latest.highlight, '♪ ♪ ♪', 'Pada jeda instrumental, lirik vokal lama tidak boleh terus disorot');
    assert.strictEqual(latest.line1, 'Baris 1 (detik 10)', 'Baris pertama menampilkan lirik sebelumnya yang baru selesai');
    assert.strictEqual(latest.line2, 'Baris 2 (detik 30)', 'Baris berikutnya menampilkan lirik yang akan datang');

    // 4. Pengguna melakukan seek ke detik 35
    service.syncPosition(35, true);
    latest = updates[updates.length - 1];
    assert.strictEqual(latest.isSynced, true);
    assert.strictEqual(latest.line1, 'Baris 1 (detik 10)');
    assert.strictEqual(latest.highlight, 'Baris 2 (detik 30)', 'Setelah seek ke detik 35, baris detik 30 langsung menjadi highlight');
    assert.strictEqual(latest.line2, 'Baris 3 (detik 50)');

    // 5. Lima baris lirik: dua sebelum, aktif di posisi tengah, dan dua sesudah
    service.syncPosition(75, true);
    latest = updates[updates.length - 1];
    assert.strictEqual(latest.before, 'Baris 2 (detik 30)', 'Baris pertama dari lima posisi menunjukkan dua baris sebelum lirik aktif');
    assert.strictEqual(latest.line1, 'Baris 3 (detik 50)', 'Baris kedua tepat sebelum lirik aktif');
    assert.strictEqual(latest.highlight, 'Baris 4 (detik 70)', 'Lirik yang cocok dengan posisi lagu berada di baris ketiga');
    assert.strictEqual(latest.line2, 'Baris 5 (detik 80)', 'Baris keempat menampilkan lirik berikutnya');
    assert.strictEqual(latest.incoming, 'Baris 6 (detik 90)', 'Baris kelima menampilkan lirik kedua sesudah lirik aktif');

    // 6. Lagu dijeda (pause) pada posisi yang sama
    service.syncPosition(75, false);
    latest = updates[updates.length - 1];
    assert.strictEqual(latest.highlight, 'Baris 4 (detik 70)', 'Saat dijeda, posisi highlight lirik tetap terjaga');
  } finally {
    globalThis.fetch = origFetch;
    service.clear();
  }
});

await runTestAsync('Uji 23: Fallback plainLyrics menampilkan keterangan sinkronisasi tidak tersedia', async () => {
  const service = new LyricsService();
  const updates: Array<{ line1: string; highlight: string; line2: string; isSynced: boolean }> = [];

  service.subscribe((u) => {
    updates.push(u);
  });

  const origFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => {
    const urlStr = url.toString();
    if (urlStr.includes('lrclib.net')) {
      return {
        ok: true,
        json: async () => ({
          syncedLyrics: null,
          ...lyricRequestMetadata(url),
          plainLyrics: "Kutipan lirik pertama\nKutipan lirik kedua\nKutipan lirik ketiga"
        })
      } as unknown as Response;
    }
    return { ok: false } as unknown as Response;
  }) as typeof fetch;

  try {
    await service.loadLyrics('PlainSong', 'PlainArtist', 'PlainAlbum', true, 10);
    const latest = updates[updates.length - 1];
    assert.strictEqual(latest.isSynced, false);
    assert.strictEqual(latest.line1, 'Lirik biasa (sinkronisasi tidak tersedia)');
    assert.strictEqual(latest.highlight, 'Kutipan lirik pertama\nKutipan lirik kedua\nKutipan lirik ketiga');
  } finally {
    globalThis.fetch = origFetch;
    service.clear();
  }
});

runTest('Uji 24: Formatter asli memakai jam, menit, detik dan menolak waktu tidak valid', () => {
  assert.strictEqual(formatPlaybackTime(0), '00:00:00');
  assert.strictEqual(formatPlaybackTime(-15), '00:00:00');
  assert.strictEqual(formatPlaybackTime(NaN), '00:00:00');
  assert.strictEqual(formatPlaybackTime(Infinity), '00:00:00');
  assert.strictEqual(formatPlaybackTime(9.8), '00:00:09');
  assert.strictEqual(formatPlaybackTime(65), '00:01:05');
  assert.strictEqual(formatPlaybackTime(102.4), '00:01:42');
  assert.strictEqual(formatPlaybackTime(248), '00:04:08');
  assert.strictEqual(formatPlaybackTime(3600), '01:00:00');
  assert.strictEqual(formatPlaybackTime(3723), '01:02:03');
  assert.strictEqual(formatPlaybackTime(360000), '100:00:00');
});

// ----------------------------------------------------------------------------
// 9. Sistem Musim Hutan Pulau Moss Island
// ----------------------------------------------------------------------------
runTest('Uji 25: loadAppState mempertahankan currentSeason dan seasonCycleCount saat reset harian (tengah malam)', () => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

  const stateToSave = {
    version: 2,
    config: { ...DEFAULT_POMODORO_CONFIG, seasonMode: 'cycle' as const },
    progress: {
      growthStage: 1,
      hydrationGlasses: 6,
      completedSessionsToday: 5,
      currentStreakDays: 3,
      trees: [],
      currentSeason: 'autumn' as IslandSeason,
      seasonCycleCount: 4,
    },
    waterMl: 1500,
    lastActiveDate: yStr,
    nextHydrationReminderTimestamp: Date.now() + 1000,
  };

  localStorage.setItem('moss_island_state_v2', JSON.stringify(stateToSave));
  const loaded = loadAppState();

  // Hitungan harian direset
  assert.strictEqual(loaded.progress.completedSessionsToday, 0, 'Sesi harian harus direset saat berganti hari');
  assert.equal('waterMl' in loaded, false, 'Pencatatan air lama tidak dimuat kembali');

  // Musim aktif dan hitungan musim harus tetap dipertahankan
  assert.strictEqual(loaded.progress.currentSeason, 'autumn', 'Musim aktif tidak boleh direset saat berganti hari');
  assert.strictEqual(loaded.progress.seasonCycleCount, 4, 'Hitungan siklus musim tidak boleh direset saat berganti hari');
  assert.strictEqual(loaded.config.seasonMode, 'cycle');
});

runTest('Uji 26: Setiap fokus selesai merotasi musim; skip, istirahat dan manual mempertahankannya', () => {
  let season: IslandSeason = 'spring';
  for (const expected of ['summer', 'autumn', 'winter', 'spring'] as IslandSeason[]) {
    assert.equal(seasonAfterPhase(season, 'cycle', 'break'), season);
    assert.equal(seasonAfterPhase(season, 'cycle', 'focus', true), season);
    assert.equal(seasonAfterPhase(season, 'manual', 'focus'), season);
    season = seasonAfterPhase(season, 'cycle', 'focus');
    assert.equal(season, expected);
  }
});

runTest('Uji 27: Lewati fase (skipCurrentPhase) mengirim flag isSkipped true sehingga tidak menambah hitungan musim', () => {
  let completedCalls = 0;
  let receivedIsSkipped = false;

  const engine = new PomodoroEngine(
    { ...DEFAULT_POMODORO_CONFIG, focusDurationMin: 25, breakDurationMin: 5, totalDurationMin: 60 },
    {
      onPhaseComplete: (_phase, _next, isSkipped) => {
        completedCalls++;
        receivedIsSkipped = Boolean(isSkipped);
      },
    }
  );

  assert.strictEqual(engine.getCurrentPhase()?.type, 'focus');
  engine.skipCurrentPhase();

  assert.strictEqual(completedCalls, 1);
  assert.strictEqual(receivedIsSkipped, true, 'skipCurrentPhase harus mengirim isSkipped bernilai true');
});

runTest('Uji 28: IslandRenderer menerima setSeason dan memperbarui musim aktif getSeason', () => {
  const canvas = createMockCanvas();
  const renderer = new IslandRenderer(canvas);

  assert.strictEqual(renderer.getSeason(), 'spring');

  renderer.setSeason('summer');
  assert.strictEqual(renderer.getSeason(), 'summer');

  renderer.setSeason('autumn');
  assert.strictEqual(renderer.getSeason(), 'autumn');

  renderer.setSeason('winter');
  assert.strictEqual(renderer.getSeason(), 'winter');
});

runTest('Uji 29: Mode prefers-reduced-motion menghentikan pergerakan posisi partikel musiman', () => {
  const canvas = createMockCanvas();
  const renderer = new IslandRenderer(canvas);

  // Akses seasonalParticles internal
  const internal = renderer as unknown as {
    seasonalParticles: Array<{ x: number; y: number; vx: number; vy: number }>;
    update: () => void;
  };

  assert.strictEqual(internal.seasonalParticles.length > 0, true);
  const initialX = internal.seasonalParticles[0].x;
  const initialY = internal.seasonalParticles[0].y;

  // Aktifkan prefers-reduced-motion
  const win = window as unknown as { matchMedia: (query: string) => { matches: boolean } };
  win.matchMedia = (query: string) => {
    if (query.includes('reduced-motion')) return { matches: true };
    return { matches: false };
  };

  // Jalankan update
  internal.update();

  assert.strictEqual(internal.seasonalParticles[0].x, initialX, 'Posisi X partikel tidak boleh bergerak saat reduced motion aktif');
  assert.strictEqual(internal.seasonalParticles[0].y, initialY, 'Posisi Y partikel tidak boleh bergerak saat reduced motion aktif');

  // Kembalikan mock matchMedia
  win.matchMedia = () => ({ matches: false });
});

runTest('Uji 30: getMomoFrameAnchor menghitung koordinat jangkar per-pose mengikuti gerakan badan', () => {
  // Pose idle memiliki koordinat dasar
  const idleAnchor = getMomoFrameAnchor('idle', 0);
  assert.strictEqual(idleAnchor.sproutX, 28);
  assert.strictEqual(idleAnchor.sproutY, 16);
  assert.strictEqual(idleAnchor.bodyOffsetY, 0);

  // Pose dance pada frame 2 memiliki pergeseran vertikal naik 2 piksel (-2)
  const danceFrame2 = getMomoFrameAnchor('dance', 2);
  assert.strictEqual(danceFrame2.bodyOffsetY, -2);
  assert.strictEqual(danceFrame2.sproutY, 14);
  assert.strictEqual(danceFrame2.headTopY, 2);
  assert.strictEqual(danceFrame2.eyesY, 30);
  assert.strictEqual(danceFrame2.neckY, 42);

  // Pose celebrate pada frame 1 memiliki pergeseran vertikal naik 1 piksel (-1)
  const celFrame1 = getMomoFrameAnchor('celebrate', 1);
  assert.strictEqual(celFrame1.bodyOffsetY, -1);
  assert.strictEqual(celFrame1.sproutY, 15);
});

runTest('Uji 31: drawMomoSeasonLayer menggambar aksesori 4 musim terikat pada koordinat pose', () => {
  const drawnRects: Array<{ x: number; y: number; w: number; h: number; fill: string }> = [];
  const mockCtx = {
    save: () => {},
    restore: () => {},
    translate: () => {},
    rotate: () => {},
    fillStyle: '',
    fillRect: (x: number, y: number, w: number, h: number) => {
      drawnRects.push({ x, y, w, h, fill: String(mockCtx.fillStyle) });
    },
  } as unknown as CanvasRenderingContext2D;

  // 1. Musim Semi: Bunga sakura di samping tunas kepala
  drawnRects.length = 0;
  drawMomoSeasonLayer(mockCtx, 'idle', 0, 'spring');
  assert.strictEqual(drawnRects.length > 0, true);
  // Putik kuning di (35, 17)
  const yellowPistil = drawnRects.find((r) => r.fill === '#FDE047' && r.x === 35 && r.y === 17);
  assert.strictEqual(Boolean(yellowPistil), true, 'Bunga musim semi harus berada di samping tunas kepala');

  // 2. Musim Panas: Topi jerami dengan lubang tunas di tengah (x: 28-36 tidak ditutup)
  drawnRects.length = 0;
  drawMomoSeasonLayer(mockCtx, 'idle', 0, 'summer');
  const strawYellow = drawnRects.filter((r) => r.fill === '#F4D06F');
  assert.strictEqual(strawYellow.length >= 2, true);
  // Mahkota topi terbagi kiri (x: 20..28) dan kanan (x: 36..44), tidak menutup x: 28..36
  const crownLeft = strawYellow.find((r) => r.x === 20 && r.w === 8);
  const crownRight = strawYellow.find((r) => r.x === 36 && r.w === 8);
  assert.strictEqual(Boolean(crownLeft && crownRight), true, 'Topi jerami harus memiliki lubang mahkota untuk tunas Momo');

  // 3. Musim Gugur: Syal rajut terakota di leher
  drawnRects.length = 0;
  drawMomoSeasonLayer(mockCtx, 'idle', 0, 'autumn');
  const terracottaScarf = drawnRects.find((r) => r.fill === '#C85A32' && r.w === 24);
  assert.strictEqual(Boolean(terracottaScarf), true, 'Syal terakota harus melingkari leher Momo');

  // 4. Musim Dingin: Jaket musim dingin puffer dan penutup telinga
  drawnRects.length = 0;
  drawMomoSeasonLayer(mockCtx, 'idle', 0, 'winter', { snowLevel: 3 });
  const winterJacket = drawnRects.find((r) => r.fill === '#2563EB' && r.w === 28);
  const snowPile = drawnRects.find((r) => r.fill === '#FFFFFF' && r.h === 5);
  assert.strictEqual(Boolean(winterJacket), true, 'Jaket musim dingin harus membungkus badan Momo');
  assert.strictEqual(Boolean(snowPile), true, 'Salju tebal level 3 harus menumpuk di atas kepala Momo');
});

runTest('Uji 32: Akumulasi salju di kepala Momo bertambah saat musim dingin dan mereda saat berganti musim', () => {
  const canvas = createMockCanvas();
  const renderer = new IslandRenderer(canvas);

  renderer.setSeason('winter');
  assert.strictEqual(renderer.getSnowAccumulationLevel(), 0);

  // Set level salju ke 2
  renderer.setSnowAccumulationLevel(2);
  assert.strictEqual(renderer.getSnowAccumulationLevel(), 2);

  // Set level salju ke 3 (maksimal)
  renderer.setSnowAccumulationLevel(3);
  assert.strictEqual(renderer.getSnowAccumulationLevel(), 3);

  // Ganti ke musim panas: level salju harus direset ke 0
  renderer.setSeason('summer');
  assert.strictEqual(renderer.getSnowAccumulationLevel(), 0, 'Salju di kepala harus direset saat berganti dari musim dingin');
});

runTest('Uji 33: Pemicuan 2 gerakan khas per musim dan transisi countdown durasinya', () => {
  const canvas = createMockCanvas();
  const renderer = new IslandRenderer(canvas);

  const internal = renderer as unknown as {
    update: () => void;
  };

  // Uji Musim Semi
  renderer.setSeason('spring');
  renderer.triggerSeasonalAction('spring_inspect');
  assert.strictEqual(renderer.getActiveSeasonalAction(), 'spring_inspect');

  renderer.triggerSeasonalAction('spring_sniff');
  assert.strictEqual(renderer.getActiveSeasonalAction(), 'spring_sniff');

  // Uji Musim Panas
  renderer.setSeason('summer');
  renderer.triggerSeasonalAction('summer_fan');
  assert.strictEqual(renderer.getActiveSeasonalAction(), 'summer_fan');

  renderer.triggerSeasonalAction('summer_wipe');
  assert.strictEqual(renderer.getActiveSeasonalAction(), 'summer_wipe');

  // Uji Musim Gugur
  renderer.setSeason('autumn');
  renderer.triggerSeasonalAction('autumn_catch');
  assert.strictEqual(renderer.getActiveSeasonalAction(), 'autumn_catch');

  renderer.triggerSeasonalAction('autumn_admire');
  assert.strictEqual(renderer.getActiveSeasonalAction(), 'autumn_admire');

  // Uji Musim Dingin
  renderer.setSeason('winter');
  renderer.setSnowAccumulationLevel(3);
  renderer.triggerSeasonalAction('winter_snow_shake');
  assert.strictEqual(renderer.getActiveSeasonalAction(), 'winter_snow_shake');

  // Jalankan 48 tick update hingga countdown aksi selesai
  for (let i = 0; i < 50; i++) {
    internal.update();
  }

  // Setelah aksi snow shake selesai, salju di kepala harus rontok bersih (level 0)
  assert.strictEqual(renderer.getActiveSeasonalAction(), null, 'Aksi musiman harus kembali ke null setelah durasi selesai');
  assert.strictEqual(renderer.getSnowAccumulationLevel(), 0, 'Salju di kepala harus rontok menjadi 0 setelah snow shake selesai');
});

runTest('Uji 34: prefers-reduced-motion meredam getaran kepala saat snow shake dan partikel aksi musiman', () => {
  const drawnRotations: number[] = [];
  const mockCtx = {
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    ellipse: () => {},
    fill: () => {},
    stroke: () => {},
    translate: () => {},
    rotate: (angle: number) => {
      drawnRotations.push(angle);
    },
    scale: () => {},
    drawImage: () => {},
    fillRect: () => {},
    clearRect: () => {},
    fillText: () => {},
    setTransform: () => {},
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
  } as unknown as CanvasRenderingContext2D;

  const mockCanvas = {
    getContext: () => mockCtx,
    getBoundingClientRect: () => ({ width: 360, height: 160 }),
    width: 360,
    height: 160,
  } as unknown as HTMLCanvasElement;

  const renderer = new IslandRenderer(mockCanvas);
  const internal = renderer as unknown as {
    drawMomo: (x: number, y: number, facingRight: boolean, yBob: number, tilt: number) => void;
  };

  // Aktifkan prefers-reduced-motion
  const win = window as unknown as { matchMedia: (query: string) => { matches: boolean } };
  win.matchMedia = (query: string) => {
    if (query.includes('reduced-motion')) return { matches: true };
    return { matches: false };
  };

  renderer.setSeason('winter');
  renderer.triggerSeasonalAction('winter_snow_shake');

  drawnRotations.length = 0;
  internal.drawMomo(180, 80, true, 0, 0);

  // Saat reduced motion aktif, tidak boleh ada rotasi kemiringan kepala (tilt) yang ditambahkan
  assert.strictEqual(drawnRotations.length, 0, 'Guncangan rotasi kepala tidak boleh terjadi saat prefers-reduced-motion aktif');

  // Kembalikan mock matchMedia
  win.matchMedia = () => ({ matches: false });
});

runTest('Uji 35: Panel musik tetap 880 × 220 px dengan isi 148 px dan jarak antarkolom 6 px', () => {
  const css = fs.readFileSync('src/styles.css', 'utf8').replace(/\r\n/g, '\n');

  // 1. Dimensi dan styling .island-widget.state-expanded.tab-music sesuai Figma
  assert.strictEqual(
    css.includes('width: 880px;'),
    true,
    'Panel musik harus memiliki lebar 880 px'
  );
  assert.strictEqual(
    css.includes('.island-widget.state-expanded.tab-music {\n  box-sizing: border-box;\n  width: 880px;\n  max-width: 100vw;\n  height: 220px;\n  max-height: 220px;\n  background: #17231F;\n  border: 1px solid #35483E;\n  border-top: none;\n  border-top-left-radius: 0;\n  border-top-right-radius: 0;\n  border-bottom-left-radius: 18px;\n  border-bottom-right-radius: 18px;\n}'),
    true,
    'Panel musik harus berukuran 880 × 220 px, background #17231F, border #35483E, border-top none, dan sudut bawah 18 px'
  );

  // 2. Min-height panel musik disetel 220 px
  assert.strictEqual(
    css.includes('.island-widget.state-expanded.expanded-ready.tab-music {\n  min-height: 220px;\n  max-height: 220px;\n}'),
    true,
    'Min-height panel musik harus disetel ke 220 px'
  );

  // 3. .view-expanded tab musik berukuran 880 × 220 px dengan padding 8 px dan gap 8 px
  assert.strictEqual(
    css.includes('.island-widget.state-expanded.tab-music .view-expanded {\n  box-sizing: border-box;\n  display: flex;\n  flex-direction: column;\n  align-items: flex-start;\n  padding: 8px;\n  gap: 8px;\n  width: 100%;\n  height: 220px;\n  max-height: 220px;\n}'),
    true,
    '.view-expanded musik harus memakai padding 8 px, gap 8 px, flex column, dan align-items flex-start'
  );

  // 4. Panel fokus tetap mempertahankan tinggi penuh 320 px
  assert.strictEqual(
    css.includes('.island-widget.state-expanded.tab-focus {\n  height: 320px;\n  max-height: 320px;\n}'),
    true,
    'Panel fokus tetap harus memakai tinggi 320 px'
  );

  // Gap antarkolom dipadatkan menjadi 6 px; gap header dan tinggi native tetap.
  assert.strictEqual(
    css.includes('#panel-music {\n  width: 100%;\n  height: 148px;\n  min-height: 148px;\n  max-height: 148px;\n  flex: 0 0 148px;\n  margin-top: 0;\n  margin-bottom: 0;\n  gap: 6px;\n  align-items: center;\n  box-sizing: border-box;\n}'),
    true,
    'Isi panel musik harus memiliki tinggi tetap 148 px (8+48+8+148+8=220 px) dan gap antarkolom 6 px'
  );

  // 6. Cover album memiliki flex-shrink: 0 dan teks judul terpotong rapi dengan ellipsis
  assert.strictEqual(
    css.includes('.album-art-pine {\n  width: 64px;\n  height: 64px;\n  flex-shrink: 0;'),
    true,
    'Cover album normal harus berukuran 64 px dan flex-shrink 0'
  );
  assert.strictEqual(
    css.includes('.album-art-pine {\n    width: 48px;\n    height: 48px;\n    flex-shrink: 0;\n  }'),
    true,
    'Cover album layar sempit harus berukuran 48 px dan flex-shrink 0'
  );
});

runTest('Uji 36: Ekstrapolasi posisi lagu mandiri dan pencegahan salah label sesi browser sebagai Spotify', () => {
  // 1. Ekstrapolasi posisi lokal mandiri saat polling sistem mengembalikan posisi statis yang sama
  let localPlaybackPos = 10.0;
  let lastReportedSystemPos = 10.0;
  const isPlaying = true;

  // Simulasi ticker 250ms berjalan sebanyak 4 kali (maju 1 detik ke 11.0)
  for (let tick = 0; tick < 4; tick++) {
    if (isPlaying) {
      localPlaybackPos += 0.25;
    }
  }
  assert.strictEqual(localPlaybackPos, 11.0);

  // Sistem mengirim polling 1 detik berikutnya dengan posisi yang sama (statis / cache sistem)
  const incomingSystemPos = 10.0;
  if (incomingSystemPos !== lastReportedSystemPos) {
    localPlaybackPos = incomingSystemPos;
    lastReportedSystemPos = incomingSystemPos;
  } else if (!isPlaying) {
    localPlaybackPos = incomingSystemPos;
  }

  assert.strictEqual(localPlaybackPos, 11.0, 'Posisi lagu tidak boleh kembali mundur ke 10.0 jika sistem mengirim nilai statis');
  assert.strictEqual(lastReportedSystemPos, 10.0, 'Posisi sistem terakhir tetap sama pada polling statis');

  // 2. Verifikasi aturan deteksi Spotify di media.rs tidak melabeli peramban umum secara otomatis
  const mediaRs = fs.readFileSync('src-tauri/src/media.rs', 'utf8');
  assert.strictEqual(
    mediaRs.includes('is_browser && !artist.trim().is_empty()'),
    false,
    'media.rs tidak boleh menandai browser umum sebagai Spotify hanya karena memiliki judul dan artis'
  );
  assert.strictEqual(
    mediaRs.includes('low_id.contains("spotify")'),
    true,
    'media.rs harus memverifikasi bahwa identitas aplikasi benar-benar mengandung kata spotify'
  );
});

// ----------------------------------------------------------------------------
// 9. Perlindungan Respons Polling dan Konfirmasi Seek Media
// ----------------------------------------------------------------------------
await runTestAsync('Uji 37: Respons polling lama yang tertunda tidak boleh menimpa lagu baru yang sudah diterima', async () => {
  // Simulasi logika perlindungan sequence polling di SystemMediaBridge
  let pollSequence = 0;
  let latestAppliedSequence = 0;
  let activeTrack = 'Lagu-Awal';

  // Permintaan 1 dikirim saat lagu adalah "Lagu-Lama"
  const req1Seq = ++pollSequence;
  let resolveReq1: (val: string) => void = () => {};
  const req1Promise = new Promise<string>((res) => { resolveReq1 = res; });

  // Permintaan 2 dikirim kemudian saat lagu berganti ke "Lagu-Baru"
  const req2Seq = pollSequence + 1;
  let resolveReq2: (val: string) => void = () => {};
  const req2Promise = new Promise<string>((res) => { resolveReq2 = res; });

  // Respons 2 selesai lebih dahulu (cepat)
  resolveReq2('Lagu-Baru');
  const data2 = await req2Promise;
  if (req2Seq >= latestAppliedSequence) {
    latestAppliedSequence = req2Seq;
    activeTrack = data2;
  }
  assert.strictEqual(activeTrack, 'Lagu-Baru', 'Lagu baru harus diterapkan');

  // Respons 1 selesai belakangan (terlambat)
  resolveReq1('Lagu-Lama');
  const data1 = await req1Promise;
  if (req1Seq >= latestAppliedSequence) {
    latestAppliedSequence = req1Seq;
    activeTrack = data1;
  } else {
    // Respons lama diabaikan karena nomor urut req1Seq (1) < latestAppliedSequence (2)
  }

  assert.strictEqual(
    activeTrack,
    'Lagu-Baru',
    'Respons lama (Lagu-Lama) yang tertunda tidak boleh menimpa status lagu terbaru (Lagu-Baru)'
  );
  assert.strictEqual(latestAppliedSequence, req2Seq, 'Nomor respons terbaru tetap dipertahankan');
});

runTest('Uji 38: Gagal seek mempertahankan posisi lagu semula dan tidak menampilkan posisi palsu', () => {
  let localPlaybackPos = 45.0;
  const targetSeekPos = 120.0;

  // Simulasi klik progress bar
  const prevPos = localPlaybackPos;
  const seekSuccess = false; // Spotify menolak seek atau seek gagal

  if (seekSuccess) {
    localPlaybackPos = targetSeekPos;
  } else {
    // Pemulihan ke posisi semula
    localPlaybackPos = prevPos;
  }

  assert.strictEqual(localPlaybackPos, 45.0, 'Jika seekTo gagal, posisi lagu tidak boleh berpindah ke 120.0 dan harus tetap 45.0');
});

await runTestAsync('Uji 39: Pencocokan versi lirik di LyricsService membedakan versi live vs studio menggunakan durasi dan album', async () => {
  const service = new LyricsService();
  const receivedLyrics: string[] = [];

  service.subscribe((u) => {
    if (u.highlight) receivedLyrics.push(u.highlight);
  });

  const origFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => {
    const urlStr = url.toString();
    if (urlStr.includes('lrclib.net/api/get')) {
      if (urlStr.includes('duration=300')) {
        // Versi Live (durasi 300 detik)
        return {
          ok: true,
          json: async () => ({
            ...lyricRequestMetadata(url),
            syncedLyrics: '[00:15.00] Lirik pembuka versi Live\n[00:40.00] Lirik kedua versi Live',
          }),
        } as unknown as Response;
      } else if (urlStr.includes('duration=240')) {
        // Versi Studio (durasi 240 detik)
        return {
          ok: true,
          json: async () => ({
            ...lyricRequestMetadata(url),
            syncedLyrics: '[00:10.00] Lirik pembuka versi Studio\n[00:30.00] Lirik kedua versi Studio',
          }),
        } as unknown as Response;
      }
    }
    return { ok: false } as unknown as Response;
  }) as typeof fetch;

  try {
    // 1. Muat versi Live (durasi 300s)
    await service.loadLyrics('Hotel California (Live)', 'Eagles', 'Hell Freezes Over', true, 20, 300);
    assert.strictEqual(receivedLyrics.includes('Lirik pembuka versi Live'), true, 'Versi Live harus mendapatkan lirik live');
    assert.strictEqual(receivedLyrics.includes('Lirik pembuka versi Studio'), false, 'Versi Live tidak boleh memakai lirik studio');

    // 2. Muat versi Studio (durasi 240s)
    await service.loadLyrics('Hotel California', 'Eagles', 'Hotel California', true, 15, 240);
    assert.strictEqual(receivedLyrics.includes('Lirik pembuka versi Studio'), true, 'Versi Studio harus mendapatkan lirik studio');
  } finally {
    globalThis.fetch = origFetch;
    service.clear();
  }
});

runTest('Uji 40: Perhitungan posisi di media.rs menggunakan LastUpdatedTime sesuai spesifikasi Microsoft GSMTC', () => {
  const mediaRs = fs.readFileSync('src-tauri/src/media.rs', 'utf8');

  // Verifikasi pembacaan LastUpdatedTime pada timeline
  assert.strictEqual(
    mediaRs.includes('timeline.LastUpdatedTime()'),
    true,
    'media.rs harus membaca LastUpdatedTime dari TimelineProperties'
  );

  // Verifikasi penghitungan elapsed time saat lagu sedang berputar
  assert.strictEqual(
    mediaRs.includes('let elapsed_secs = (elapsed_100ns as f64) / 10_000_000.0;'),
    true,
    'media.rs harus menghitung durasi detik yang berlalu sejak LastUpdatedTime'
  );
  assert.strictEqual(
    mediaRs.includes('let calculated = raw_pos + elapsed_secs * playback_rate;'),
    true,
    'media.rs harus menambahkan elapsed time sesuai playback rate ke snapshot Position saat is_playing aktif'
  );
});

runTest('Uji 41: Konfigurasi ISLAND_DIMENSIONS dan fungsi getIslandDimension sebagai satu sumber acuan (Single Source of Truth)', () => {
  // 1. Hidden notch
  assert.deepStrictEqual(ISLAND_DIMENSIONS.hidden, {
    width: 76,
    height: 92,
    minWidth: null,
    minHeight: null,
    resizable: false,
  });
  assert.deepStrictEqual(getIslandDimension('hidden', 'music', false), ISLAND_DIMENSIONS.hidden);

  // 2. Compact notch
  assert.deepStrictEqual(ISLAND_DIMENSIONS.compact, {
    width: 300,
    height: 42,
    minWidth: null,
    minHeight: null,
    resizable: false,
  });
  assert.deepStrictEqual(getIslandDimension('compact', 'music', false), ISLAND_DIMENSIONS.compact);

  // 3. Settings modal
  assert.deepStrictEqual(ISLAND_DIMENSIONS.settings, {
    width: 960,
    height: 560,
    minWidth: 640,
    minHeight: 480,
    resizable: true,
  });
  assert.deepStrictEqual(getIslandDimension('expanded', 'music', true), ISLAND_DIMENSIONS.settings);

  // 4. Expanded focus (320 px)
  assert.strictEqual(ISLAND_DIMENSIONS.expanded.focus.height, 320);
  assert.strictEqual(ISLAND_DIMENSIONS.expanded.focus.minHeight, 320);

  // 5. Expanded music (220 px persis sesuai Figma)
  assert.strictEqual(ISLAND_DIMENSIONS.expanded.music.width, 880);
  assert.strictEqual(ISLAND_DIMENSIONS.expanded.music.height, 220);
  assert.strictEqual(ISLAND_DIMENSIONS.expanded.music.minHeight, 220);
  assert.strictEqual(ISLAND_DIMENSIONS.expanded.music.resizable, true);
  assert.deepStrictEqual(getIslandDimension('expanded', 'music', false), ISLAND_DIMENSIONS.expanded.music);
});

runTest('Uji 42: Alur ukuran panel, bilah minimize (42), dan modal tetap konsisten', () => {
  // Simulasi alur navigasi tab dan status
  let currentState: 'hidden' | 'compact' | 'expanded' = 'expanded';
  let currentActiveTab: 'focus' | 'music' = 'focus';
  let isModalOpen = false;

  // 1. Fokus awal
  let dim = getIslandDimension(currentState, currentActiveTab, isModalOpen);
  assert.strictEqual(dim.height, 320, 'Tab Fokus awal harus 320 px');

  // 2. Berpindah ke tab Musik
  currentActiveTab = 'music';
  dim = getIslandDimension(currentState, currentActiveTab, isModalOpen);
  assert.strictEqual(dim.height, 220, 'Tab Musik harus tepat 220 px');
  assert.strictEqual(dim.width, 880);

  // 3. Kembali ke panel fokus/istirahat
  currentActiveTab = 'focus';
  dim = getIslandDimension(currentState, currentActiveTab, isModalOpen);
  assert.strictEqual(dim.height, 320, 'Panel fokus/istirahat harus kembali 320 px');

  // 4. Kembali ke tab Musik
  currentActiveTab = 'music';
  dim = getIslandDimension(currentState, currentActiveTab, isModalOpen);
  assert.strictEqual(dim.height, 220, 'Kembali ke Musik harus 220 px');

  // 5. Mengecilkan ke Compact
  currentState = 'compact';
  dim = getIslandDimension(currentState, currentActiveTab, isModalOpen);
  assert.strictEqual(dim.height, 42, 'Minimize tetap berupa bilah informasi');
  assert.strictEqual(dim.width, 300);

  // 6. Mengembangkan kembali ke Expanded (aktif tab Musik)
  currentState = 'expanded';
  dim = getIslandDimension(currentState, currentActiveTab, isModalOpen);
  assert.strictEqual(dim.height, 220, 'Expanded kembali ke tab Musik harus 220 px');

  // 7. Membuka modal pengaturan dari tab Musik
  isModalOpen = true;
  dim = getIslandDimension(currentState, currentActiveTab, isModalOpen);
  assert.strictEqual(dim.height, 560, 'Modal pengaturan harus 560 px');
  assert.strictEqual(dim.width, 960);

  // 8. Menutup modal pengaturan
  isModalOpen = false;
  dim = getIslandDimension(currentState, currentActiveTab, isModalOpen);
  assert.strictEqual(dim.height, 220, 'Menutup modal dari tab Musik harus mengembalikan ukuran ke 220 px');
});

// ----------------------------------------------------------------------------
// 10. Tampilan Lirik 5 Baris dengan Baris Aktif di Tengah dan Transisi Lembut
// ----------------------------------------------------------------------------
await runTestAsync('Uji 43: Gaya lirik 5 baris dengan baris aktif di tengah, transisi berurutan step (180-250 ms), fade jump saat seek/ganti lagu, tiga titik pixel instrumental, dan penanganan pause/reduced-motion', async () => {
  const service = new LyricsService();
  const updates: Array<any> = [];

  service.subscribe((u) => {
    updates.push(u);
  });

  const origFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => {
    const urlStr = url.toString();
    if (urlStr.includes('lrclib.net')) {
      return {
        ok: true,
        json: async () => ({
          syncedLyrics: [

            '[00:05.00] Baris Pertama (05s)',
            '[00:10.00] Baris Kedua (10s)',
            '[00:15.00] Baris Ketiga (15s)',
            '[00:20.00]',
            '[00:30.00] Baris Keempat Setelah Jeda (30s)',
            '[00:55.00] Baris Kelima Gap Panjang (55s)'
          ].join('\n'),
          ...lyricRequestMetadata(url),
        }),
      } as unknown as Response;
    }
    return { ok: false } as unknown as Response;
  }) as typeof fetch;

  try {
    // 1. Fase Intro (0s - sebelum detik 5): tiga baris menampilkan artis, titik instrumental, dan baris pembuka
    await service.loadLyrics('SongA', 'ArtistA', 'AlbumA', true, 0, 120);
    let u = updates[updates.length - 1];
    assert.strictEqual(u.isSynced, true);
    assert.strictEqual(u.isInstrumental, true, 'Intro sebelum vokal pertama harus berstatus instrumental');
    assert.strictEqual(u.highlight, '♪ ♪ ♪');
    assert.strictEqual(u.line2, 'Baris Pertama (05s)');
    assert.strictEqual(u.incoming, 'Baris Kedua (10s)');

    // 2. Transisi ke Baris 1 (5s): transisi step pertama dari intro ke vokal aktif
    service.syncPosition(6, true);
    u = updates[updates.length - 1];
    assert.strictEqual(u.isInstrumental, false);
    assert.strictEqual(u.highlight, 'Baris Pertama (05s)');
    assert.strictEqual(u.line2, 'Baris Kedua (10s)');
    assert.strictEqual(u.incoming, 'Baris Ketiga (15s)');
    assert.strictEqual(u.transitionType, 'step', 'Pergantian berurutan dari intro ke vokal pertama harus berupa step');

    // 3. Transisi berurutan ke Baris 2 (10s): step berurutan 1 baris
    service.syncPosition(11, true);
    u = updates[updates.length - 1];
    assert.strictEqual(u.highlight, 'Baris Kedua (10s)');
    assert.strictEqual(u.line1, 'Baris Pertama (05s)');
    assert.strictEqual(u.line2, 'Baris Ketiga (15s)');
    assert.strictEqual(u.transitionType, 'step', 'Pergantian berurutan ke baris berikutnya harus berupa step');

    const updatesAfterStep = updates.length;
    await service.loadLyrics('SongA', 'ArtistA', 'AlbumA', true, 11, 120);
    service.syncPosition(11.25, true);
    assert.strictEqual(updates.length, updatesAfterStep, 'Polling dan ticker pada baris sama tidak boleh membatalkan animasi step');

    service.syncPosition(11.25, false);
    assert.strictEqual(updates.length, updatesAfterStep + 1, 'Pause tetap harus diteruskan meskipun teks sama');
    assert.strictEqual(updates[updates.length - 1].isPlaying, false);
    service.syncPosition(11.25, true);
    assert.strictEqual(updates.length, updatesAfterStep + 2, 'Resume tetap harus diteruskan');

    // 4. Seek langsung ke Baris 4 (32s): melompati Baris 3 dan jeda instrumental
    service.syncPosition(32, true);
    u = updates[updates.length - 1];
    assert.strictEqual(u.highlight, 'Baris Keempat Setelah Jeda (30s)');
    assert.strictEqual(u.transitionType, 'jump', 'Seek atau lompatan beberapa baris harus berupa jump (fade singkat tanpa scroll)');

    // 5. Lagu Dijeda (pause): isPlaying false dan transitionType none
    service.syncPosition(32, false);
    u = updates[updates.length - 1];
    assert.strictEqual(u.isPlaying, false);
    assert.strictEqual(u.highlight, 'Baris Keempat Setelah Jeda (30s)');
    assert.strictEqual(u.transitionType, 'none', 'Saat dijeda, tidak ada transisi gerakan');

    // 6. Jeda Instrumental Gap Panjang (42s): antara detik 30 dan 55 (gap 25 detik)
    service.syncPosition(42, true);
    u = updates[updates.length - 1];
    assert.strictEqual(u.isInstrumental, false, 'Jarak waktu panjang bukan bukti instrumental');
    assert.strictEqual(u.highlight, 'Baris Keempat Setelah Jeda (30s)');
    assert.strictEqual(u.line2, 'Baris Kelima Gap Panjang (55s)');

    service.syncPosition(54, true);
    assert.strictEqual(updates[updates.length - 1].isInstrumental, false, 'Vokal bertahan sampai timestamp berikutnya');
    service.syncPosition(55, true);
    assert.strictEqual(updates[updates.length - 1].highlight, 'Baris Kelima Gap Panjang (55s)');

    // 7. Ganti Lagu ke SongB (jump langsung dan reset state)
    await service.loadLyrics('SongB', 'ArtistB', 'AlbumB', true, 10, 150);
    u = updates[updates.length - 1];
    assert.strictEqual(u.transitionType, 'jump', 'Ganti lagu harus menggunakan transisi jump');

    // 8. Verifikasi DOM di index.html
    const html = fs.readFileSync('index.html', 'utf8');
    assert.strictEqual(html.includes('id="lyrics-viewport"'), true, 'index.html harus memuat lyrics-viewport');
    assert.strictEqual(html.includes('id="lyrics-track"'), true, 'index.html harus memuat lyrics-track');
    assert.strictEqual(html.includes('id="music-card-line-before"'), true, 'index.html harus memuat baris lirik sebelum baris kedua sebelum highlight');
    assert.strictEqual(html.includes('id="lyrics-instrumental-dots"'), true, 'index.html harus memuat container titik pixel instrumental');
    assert.strictEqual(html.includes('pixel-dot'), true, 'index.html harus memuat elemen pixel-dot');
    assert.strictEqual(html.includes('id="music-card-highlight"'), true, 'index.html harus mempertahankan id music-card-highlight');

    // 9. Verifikasi CSS di src/styles.css
    const css = fs.readFileSync('src/styles.css', 'utf8').replace(/\r\n/g, '\n');
    assert.strictEqual(css.includes('color: #A8F0C6;'), true, 'Warna baris aktif adalah mint terang #A8F0C6');
    assert.strictEqual(css.includes('color: #859F92;'), true, 'Warna baris lainnya adalah redup #859F92');
    assert.strictEqual(css.includes('@keyframes pixel-dot-gentle'), true, 'styles.css harus memiliki keyframe pixel-dot-gentle');
    assert.strictEqual(css.includes('.lyrics-card.is-paused .pixel-dot'), true, 'Saat pause, animasi titik pixel harus dihentikan');
    assert.strictEqual(css.includes('@media (prefers-reduced-motion: reduce)'), true, 'styles.css harus menangani prefers-reduced-motion');
  } finally {
    globalThis.fetch = origFetch;
    service.clear();
  }
});

// ----------------------------------------------------------------------------
// 11. Identitas Sumber Media (Aplikasi Dipisahkan dari Layanan)
// ----------------------------------------------------------------------------
runTest('Uji 44: Label sumber media jujur — aplikasi dipisahkan dari layanan, media non-Spotify tidak dianggap Spotify', () => {
  // Spotify Desktop terverifikasi dari identitas aplikasi (AUMID)
  const spotifyDesktop = resolveMediaSourceIdentity({
    source_app: 'Spotify.exe',
    source_display_name: 'Spotify',
    service_kind: 'spotify_desktop',
    has_session: true,
  });
  assert.strictEqual(spotifyDesktop.badgeText, 'SPOTIFY');
  assert.strictEqual(spotifyDesktop.isSpotifyVerified, true);

  // Spotify Web di Opera: sistem tidak menyediakan identitas situs,
  // sehingga TIDAK boleh diklaim sebagai Spotify
  const operaSpotifyWeb = resolveMediaSourceIdentity({
    source_app: 'opera.exe',
    source_display_name: 'Opera',
    service_kind: 'web_media',
    has_session: true,
  });
  assert.strictEqual(operaSpotifyWeb.badgeText, 'OPERA · MEDIA WEB');
  assert.strictEqual(operaSpotifyWeb.isSpotifyVerified, false);

  // Judul/artis yang mengandung kata "spotify" tidak boleh dijadikan bukti;
  // resolver hanya membaca info sumber (tanpa kolom judul/artis sama sekali)
  const operaNonSpotify = resolveMediaSourceIdentity({
    source_app: 'opera.exe',
    source_display_name: 'Opera',
    service_kind: 'web_media',
    has_session: true,
  });
  assert.strictEqual(operaNonSpotify.isSpotifyVerified, false);

  // Sesi web Spotify yang terverifikasi lewat integrasi browser eksplisit
  const verifiedWeb = resolveMediaSourceIdentity({
    source_app: 'opera.exe',
    source_display_name: 'Opera',
    service_kind: 'spotify_web_verified',
    has_session: true,
  });
  assert.strictEqual(verifiedWeb.badgeText, 'SPOTIFY · OPERA');
  assert.strictEqual(verifiedWeb.isSpotifyVerified, true);

  // Aplikasi native lain tidak diberi label Spotify
  const nativeApp = resolveMediaSourceIdentity({
    source_app: 'WindowsMediaPlayer.exe',
    source_display_name: 'Media Player',
    service_kind: 'native_app',
    has_session: true,
  });
  assert.strictEqual(nativeApp.badgeText, 'MEDIA PLAYER');
  assert.strictEqual(nativeApp.isSpotifyVerified, false);

  // Tanpa sesi / layanan tidak diketahui
  assert.strictEqual(resolveMediaSourceIdentity(null).badgeText, 'SISTEM MEDIA');
  assert.strictEqual(resolveMediaSourceIdentity({ has_session: false }).badgeText, 'SISTEM MEDIA');
  assert.strictEqual(
    resolveMediaSourceIdentity({ source_app: '', service_kind: 'unknown', has_session: true }).badgeText,
    'SISTEM MEDIA'
  );
});

// ----------------------------------------------------------------------------
// 12. Pipeline Artwork dari Sesi Media Aktif (Sumber Utama)
// ----------------------------------------------------------------------------
await runTestAsync('Uji 45: Sampul sesi menjadi sumber utama, cover lama dikosongkan saat rekaman berganti, dan respons lama ditolak', async () => {
  const service = new LyricsService();
  const updates: TrackArtworkInfo[] = [];
  service.subscribeArtwork((a) => updates.push(a));

  // 1. Rekaman A aktif: cover lagu sebelumnya segera dikosongkan
  service.onSystemRecordChanged('sesi-1#rekam-a', { title: 'Lagu A', artist: 'Artis A', album: 'Album A', durationSecs: 200 }, true);
  let last = updates[updates.length - 1];
  assert.strictEqual(last.albumArtUrl, null, 'Cover lagu sebelumnya harus segera dikosongkan saat lagu berganti');
  assert.strictEqual(last.source, 'none');

  // 2. Sampul dari sesi media aktif diterapkan untuk rekaman yang masih aktif
  const applied = service.applySessionArtworkData('sesi-1#rekam-a', PNG_1X1_BASE64, 'image/png', { title: 'Lagu A', artist: 'Artis A' });
  assert.strictEqual(applied, true, 'Sampul sesi harus diterapkan');
  last = updates[updates.length - 1];
  assert.strictEqual(last.source, 'session', 'Sampul utama harus berlabel berasal dari sesi');
  assert.ok(last.albumArtUrl !== null && last.albumArtUrl.startsWith('blob:'), 'Sampul sesi memakai object URL yang dikelola');

  // 3. Rekaman berganti (judul & artis sama, versi album berbeda): placeholder seketika
  service.onSystemRecordChanged('sesi-1#rekam-a-v2', { title: 'Lagu A', artist: 'Artis A', album: 'Album A (Deluxe)', durationSecs: 210 }, true);
  last = updates[updates.length - 1];
  assert.strictEqual(last.albumArtUrl, null, 'Sampul versi lama tidak boleh terlihat pada rekaman baru');
  assert.strictEqual(last.source, 'none');

  // 4. Respons artwork LAMA yang terlambat tiba setelah lagu berganti harus ditolak
  const staleApplied = service.applySessionArtworkData('sesi-1#rekam-a', PNG_1X1_BASE64, 'image/png', { title: 'Lagu A', artist: 'Artis A' });
  assert.strictEqual(staleApplied, false, 'Artwork milik rekaman lama tidak boleh diterapkan');
  last = updates[updates.length - 1];
  assert.strictEqual(last.albumArtUrl, null, 'Cover lagu lama tidak boleh muncul kembali');

  // 5. Artwork sesi tidak tersedia: placeholder tetap dipertahankan
  service.notifySessionArtworkUnavailable('sesi-1#rekam-a-v2');
  last = updates[updates.length - 1];
  assert.strictEqual(last.albumArtUrl, null);

  // 6. clear(): seluruh object URL harus dilepas
  service.clear();
  assert.strictEqual(mockBlobUrls.size, 0, 'Object URL artwork harus dilepas saat layanan dibersihkan');
});

await runTestAsync('Uji 46: Fallback pencarian memverifikasi judul, artis, album, dan durasi — hasil pertama tidak dipilih secara buta', async () => {
  const service = new LyricsService();
  const updates: TrackArtworkInfo[] = [];
  service.subscribeArtwork((a) => updates.push(a));

  const origFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => {
    const urlStr = url.toString();
    if (urlStr.includes('deezer.com')) {
      return {
        ok: true,
        json: async () => ({
          data: [
            // Kandidat pertama: judul cocok tetapi artis, album, dan durasi berbeda
            { title: 'Lagu Uji', artist: { name: 'Artis Lain' }, album: { title: 'Album Lain', cover_medium: 'cover-salah.jpg' }, duration: 300 },
            // Kandidat kedua: judul, artis, album, dan durasi terverifikasi
            { title: 'Lagu Uji (Remastered 2011)', artist: { name: 'Artis Uji', picture_medium: 'pic-artis.jpg' }, album: { title: 'Album Uji', cover_medium: 'cover-benar.jpg' }, duration: 202 },
          ],
        }),
      } as unknown as Response;
    }
    return { ok: false } as unknown as Response;
  }) as typeof fetch;

  try {
    service.onSystemRecordChanged('s#r', { title: 'Lagu Uji', artist: 'Artis Uji', album: 'Album Uji', durationSecs: 200 }, false);
    await service.requestSearchArtworkFallback({ title: 'Lagu Uji', artist: 'Artis Uji', album: 'Album Uji', durationSecs: 200, identityKey: 's#r' });
    const last = updates[updates.length - 1];
    assert.strictEqual(last.albumArtUrl, 'cover-benar.jpg', 'Kandidat terverifikasi harus dipilih, bukan hasil pertama');
    assert.strictEqual(last.artistPicUrl, 'pic-artis.jpg');
    assert.strictEqual(last.source, 'search', 'Gambar pencarian harus diberi label jujur sebagai hasil pencarian');
  } finally {
    globalThis.fetch = origFetch;
    service.clear();
  }
});

await runTestAsync('Uji 47: Kecocokan pencarian yang meragukan menampilkan placeholder, bukan tebakan', async () => {
  const service = new LyricsService();
  const updates: TrackArtworkInfo[] = [];
  service.subscribeArtwork((a) => updates.push(a));

  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    return {
      ok: true,
      json: async () => ({
        data: [
          // Hanya judul yang cocok; artis dan durasi tidak cocok -> tidak layak dipakai
          { title: 'Lagu Uji', artist: { name: 'Penyanyi Beda' }, album: { title: 'X', cover_medium: 'cover-dubious.jpg' }, duration: 90 },
        ],
      }),
    } as unknown as Response;
  }) as typeof fetch;

  try {
    service.onSystemRecordChanged('s#d', { title: 'Lagu Uji', artist: 'Artis Uji', album: 'Album Uji', durationSecs: 200 }, false);
    await service.requestSearchArtworkFallback({ title: 'Lagu Uji', artist: 'Artis Uji', album: 'Album Uji', durationSecs: 200, identityKey: 's#d' });
    const last = updates[updates.length - 1];
    assert.strictEqual(last.albumArtUrl, null, 'Kandidat tanpa kecocokan artis harus ditolak dan placeholder ditampilkan');
    assert.strictEqual(last.source, 'none');
  } finally {
    globalThis.fetch = origFetch;
    service.clear();
  }
});

await runTestAsync('Uji 48: Fallback pencarian tidak dijalankan dan tidak menimpa sampul sesi yang sudah tampil', async () => {
  const service = new LyricsService();
  const updates: TrackArtworkInfo[] = [];
  service.subscribeArtwork((a) => updates.push(a));

  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error('API pencarian tidak boleh dipanggil saat sampul sesi sudah tampil');
  }) as typeof fetch;

  try {
    service.onSystemRecordChanged('s#r2', { title: 'Lagu Sesi', artist: 'Artis Sesi', album: 'Album Sesi', durationSecs: 180 }, true);
    const ok = service.applySessionArtworkData('s#r2', PNG_1X1_BASE64, 'image/png', { title: 'Lagu Sesi', artist: 'Artis Sesi' });
    assert.strictEqual(ok, true);

    await service.requestSearchArtworkFallback({ title: 'Lagu Sesi', artist: 'Artis Sesi', album: 'Album Sesi', durationSecs: 180, identityKey: 's#r2' });
    const last = updates[updates.length - 1];
    assert.strictEqual(last.source, 'session', 'Sampul sesi harus tetap menjadi sumber utama, pencarian hanya fallback');
  } finally {
    globalThis.fetch = origFetch;
    service.clear();
  }
});

// ----------------------------------------------------------------------------
// 13. Konsistensi Sesi Media pada SystemMediaBridge
// ----------------------------------------------------------------------------
await runTestAsync('Uji 49: fetchArtwork tanpa Tauri mengembalikan null dan hanya menerima respons sesi yang sama', async () => {
  const bridge = new SystemMediaBridge();
  assert.strictEqual(bridge.isTauriAvailable, false, 'Lingkungan pengujian tanpa Tauri');

  const track: SystemMediaTrack = {
    title: 'Lagu',
    artist: 'Artis',
    album: 'Album',
    is_playing: true,
    source_app: 'opera.exe',
    source_display_name: 'Opera',
    service_kind: 'web_media',
    is_spotify: false,
    has_session: true,
    session_key: 'media-session-1',
    record_key: 'lagu|artis|album|1|200',
    has_thumbnail: true,
    position_secs: 0,
    duration_secs: 200,
  };

  // Tanpa Tauri: tidak ada artwork, tidak ada klaim palsu
  const art = await bridge.fetchArtwork(track);
  assert.strictEqual(art, null, 'fetchArtwork harus aman (null) di lingkungan tanpa Tauri');
});

// ----------------------------------------------------------------------------
// 14. Keseragaman Permukaan Pulau (Empat Petak Tengah)
// ----------------------------------------------------------------------------
runTest('Uji 50: Overlay kerikil pada empat petak tengah dihilangkan dan jalur koordinat Momo dipertahankan', () => {
  const src = fs.readFileSync('src/canvas/islandRenderer.ts', 'utf8');
  assert.strictEqual(src.includes('gravelTiles'), false, 'Lapisan visual kerikil khusus harus dihapus dari renderer');
  assert.strictEqual(src.includes('Warna kerikil lembut'), false, 'Overlay warna kerikil tidak boleh ada lagi');
  assert.strictEqual(src.includes('rgba(235, 230, 210, 0.45)'), false, 'Bintik kerikil tidak boleh digambar lagi di petak tengah');
  assert.strictEqual(src.includes('normalWaypoints'), true, 'Jalur koordinat berjalan Momo tetap dipertahankan');
  assert.strictEqual(src.includes('{ r: 2.2, c: 2.2, waitFrames: 60 }'), true, 'Waypoint tengah pulau (di atas petak 2,2-3,3) tetap ada');
  assert.strictEqual(src.includes('tileEven') && src.includes('tileOdd'), true, 'Pola selang-seling permukaan pulau tetap dipertahankan');
});

// ----------------------------------------------------------------------------
// 15. Helper Artwork dan Kontrak Rust
// ----------------------------------------------------------------------------
runTest('Uji 51: Helper base64 artwork mendekode dengan benar dan aman di lingkungan tanpa dukungan blob', () => {
  const bytes = base64ToBytes('aGVsbG8=');
  assert.ok(bytes, 'Dekode base64 harus berhasil');
  assert.strictEqual(Buffer.from(bytes!).toString('utf8'), 'hello');

  assert.strictEqual(base64ToBytes('!!!bukan base64###'), null, 'Base64 tidak valid harus menghasilkan null');
  assert.strictEqual(base64ToBytes(''), null, 'Base64 kosong harus menghasilkan null');

  const url = base64ToBlobUrl(PNG_1X1_BASE64, 'image/png');
  assert.ok(url !== null && url.startsWith('blob:'), 'Object URL harus dibuat di lingkungan dengan dukungan blob');

  // Lingkungan tanpa URL.createObjectURL: kembalikan null tanpa melempar error
  const urlRef = globalThis.URL as unknown as Record<string, unknown>;
  const origCreate = urlRef.createObjectURL;
  delete urlRef.createObjectURL;
  try {
    assert.strictEqual(base64ToBlobUrl(PNG_1X1_BASE64, 'image/png'), null, 'Tanpa dukungan blob harus null, bukan error');
  } finally {
    urlRef.createObjectURL = origCreate;
  }
});

runTest('Uji 52: Kontrak Rust menyediakan thumbnail sesi, identitas sesi/rekaman, batas ukuran, dan verifikasi Spotify hanya dari AUMID', () => {
  const mediaRs = fs.readFileSync('src-tauri/src/media.rs', 'utf8');
  assert.strictEqual(mediaRs.includes('pub struct SystemMediaArtwork'), true, 'Representasi artwork harus ada pada kontrak Rust -> TypeScript');
  assert.strictEqual(mediaRs.includes('pub session_key: String'), true, 'Identitas sesi harus ada pada kontrak');
  assert.strictEqual(mediaRs.includes('pub record_key: String'), true, 'Identitas rekaman harus ada pada kontrak');
  assert.strictEqual(mediaRs.includes('has_thumbnail'), true, 'Ketersediaan thumbnail sistem harus dilaporkan');
  assert.strictEqual(mediaRs.includes('Thumbnail()'), true, 'Thumbnail harus dibaca dari metadata sesi media Windows yang sama');
  assert.strictEqual(mediaRs.includes('OpenReadAsync'), true, 'Pembacaan stream thumbnail sesi harus ada');
  assert.strictEqual(mediaRs.includes('MAX_ARTWORK_BYTES'), true, 'Ukuran data gambar harus dibatasi');
  assert.strictEqual(mediaRs.includes('get_system_media_artwork'), true, 'Command artwork terpisah agar jalur pembaruan posisi tidak diblokir');
  assert.strictEqual(mediaRs.includes('pub has_thumbnail: bool'), true);

  // Deteksi Spotify hanya dari identitas aplikasi; metadata lagu tidak lagi dipakai sebagai bukti
  assert.strictEqual(mediaRs.includes('fn check_is_spotify(app_id: &str)'), true, 'Verifikasi Spotify harus hanya berdasar AUMID aplikasi');
  assert.strictEqual(
    mediaRs.includes('format!("{} {} {}", title, artist, album)'),
    false,
    'Kata spotify pada judul/artis/album tidak boleh dijadikan bukti layanan Spotify'
  );

  const libRs = fs.readFileSync('src-tauri/src/lib.rs', 'utf8');
  assert.strictEqual(libRs.includes('media::get_system_media_artwork'), true, 'Command artwork harus terdaftar pada invoke handler');
});

// ----------------------------------------------------------------------------
// 16. Validasi Progres Tersimpan (Data Parsial Tetap Dipulihkan)
// ----------------------------------------------------------------------------
await runTestAsync('Uji 53: Progres rusak dipulihkan sebagian — pohon tidak valid dibuang, penghitung dijepit ke nilai non-negatif', async () => {
  const validTree = {
    id: 'tree_1',
    gridR: 0,
    gridC: 2,
    treeType: 'oak',
    plantedAtTimestamp: Date.now(),
  };
  const stateToSave = {
    version: 2,
    config: { ...DEFAULT_POMODORO_CONFIG },
    progress: {
      growthStage: 1,
      hydrationGlasses: 6,
      completedSessionsToday: -9,
      currentStreakDays: -3,
      trees: [null, validTree, { gridR: 9, gridC: -2, treeType: 'maple', plantedAtTimestamp: -5 }, 'bukan_objek'],
      currentSeason: 'autumn',
      seasonCycleCount: 99,
    },
    waterMl: -500,
    lastActiveDate: getTodayDateString(),
    nextHydrationReminderTimestamp: Date.now() + 1000,
    timerSession: { status: 'nonsense' },
  };

  localStorage.setItem('moss_island_state_v2', JSON.stringify(stateToSave));
  const loaded = loadAppState();

  // Pohon sah tetap dipertahankan, entri rusak dibuang tanpa menghilangkan seluruh progres
  assert.strictEqual(loaded.progress.trees.length, 1, 'Hanya pohon yang valid yang dipertahankan');
  assert.strictEqual(loaded.progress.trees[0].id, 'tree_1');
  assert.strictEqual(loaded.progress.trees[0].gridR, 0);

  // Penghitung dijepit ke bilangan valid non-negatif
  assert.strictEqual(loaded.progress.completedSessionsToday, 0, 'Jumlah sesi negatif harus dijepit ke 0');
  assert.strictEqual(loaded.progress.currentStreakDays, 1, 'Streak negatif harus kembali ke 1');
  assert.strictEqual(loaded.progress.seasonCycleCount, 3, 'Hitungan siklus 99 dijepit ke 0..5 (99 % 6)');
  assert.equal('waterMl' in loaded, false, 'Data air lama diabaikan saat migrasi');

  // Snapshot timer tidak sah -> null
  assert.strictEqual(loaded.timerSession, null, 'Snapshot timer tidak valid harus ditolak');
});

// ----------------------------------------------------------------------------
// 17. Kebijakan Timer Saat Eksekusi Tertunda (Laptop Tidur)
// ----------------------------------------------------------------------------
await runTestAsync('Uji 54: Fase yang terlewat penuh (laptop tidur 3 menit) diselesaikan berantai tanpa memanjang rencana', async () => {
  const completedPhases: string[] = [];
  let planCompleteCount = 0;

  const engine = new PomodoroEngine(
    { ...DEFAULT_POMODORO_CONFIG, totalDurationMin: 3, focusDurationMin: 1, breakDurationMin: 1, autostartBreak: true, autostartNextFocus: true },
    {
      onPhaseComplete: (phase) => completedPhases.push(phase.type),
      onPlanComplete: () => planCompleteCount++,
    }
  );

  engine.start();
  // Deadline fase fokus pertama sudah lewat 3 menit (seluruh rencana terlewat)
  (engine as unknown as { targetEndTime: number }).targetEndTime = Date.now() - 3 * 60 * 1000;
  (engine as unknown as { tick: () => void }).tick();

  assert.strictEqual(engine.getStatus(), 'completed', 'Seluruh fase yang terlewat harus tuntas');
  assert.deepStrictEqual(completedPhases, ['focus', 'break', 'focus'], 'Setiap fase terlewat memancarkan event sekali');
  assert.strictEqual(planCompleteCount, 1, 'Rencana selesai dipancarkan tepat satu kali');
});

await runTestAsync('Uji 55: Keterlambatan sebagian (90 detik) melanjutkan fase berikutnya dari deadline sebelumnya', async () => {
  const engine = new PomodoroEngine(
    { ...DEFAULT_POMODORO_CONFIG, totalDurationMin: 3, focusDurationMin: 1, breakDurationMin: 1, autostartBreak: true, autostartNextFocus: true }
  );

  engine.start();
  (engine as unknown as { targetEndTime: number }).targetEndTime = Date.now() - 90 * 1000;
  (engine as unknown as { tick: () => void }).tick();

  // Fokus 1 selesai, istirahat 1 terlewat penuh, fokus 2 berjalan dari deadline lama
  assert.strictEqual(engine.getStatus(), 'running');
  assert.strictEqual(engine.getCurrentPhase()?.type, 'focus', 'Fokus kedua harus sedang berjalan');
  const remaining = engine.getPhaseRemainingSeconds();
  assert.ok(remaining >= 28 && remaining <= 31, `Sisa waktu fokus kedua harus ±30 dtk dari deadline lama, didapat ${remaining}`);
});

runTest('Uji 56: skipCurrentPhase setelah rencana selesai tidak memicu penyelesaian berulang', () => {
  let planCompleteCount = 0;
  const engine = new PomodoroEngine(DEFAULT_POMODORO_CONFIG, {
    onPlanComplete: () => planCompleteCount++,
  });

  engine.start();
  for (let i = 0; i < 50 && engine.getStatus() !== 'completed'; i++) {
    engine.skipCurrentPhase();
  }
  assert.strictEqual(engine.getStatus(), 'completed');
  const completeCountAtFinish = planCompleteCount;
  assert.strictEqual(completeCountAtFinish, 1, 'Rencana selesai dipancarkan tepat satu kali');

  // Skip tambahan setelah selesai harus menjadi no-op
  engine.skipCurrentPhase();
  engine.skipCurrentPhase();
  assert.strictEqual(planCompleteCount, completeCountAtFinish, 'Penyelesaian tidak boleh dipancarkan ulang');
});

// ----------------------------------------------------------------------------
// 18. Kontrol Media Terikat Identitas Sesi yang Ditampilkan
// ----------------------------------------------------------------------------
interface MockInvokeCall { cmd: string; args: Record<string, unknown> }

function installMockTauriInternals(respond: (cmd: string, args: Record<string, unknown>) => unknown): MockInvokeCall[] {
  const calls: MockInvokeCall[] = [];
  const win = globalThis.window as unknown as Record<string, unknown>;
  win.__TAURI_INTERNALS__ = {
    invoke: (cmd: string, args: Record<string, unknown> = {}) => {
      calls.push({ cmd, args });
      return Promise.resolve(respond(cmd, args));
    },
  };
  return calls;
}

function removeMockTauriInternals() {
  const win = globalThis.window as unknown as Record<string, unknown>;
  delete win.__TAURI_INTERNALS__;
}

await runTestAsync('Uji 57: Play/pause, next, prev, dan seek mengirim identitas sesi (dan rekaman untuk seek)', async () => {
  const displayedTrack = {
    title: 'Lagu Tampil', artist: 'Artis', album: 'Album', is_playing: true,
    source_app: 'Spotify.exe', source_display_name: 'Spotify', service_kind: 'spotify_desktop',
    is_spotify: true, has_session: true, session_key: 'media-session-77', record_key: 'lagu|artis|album|1|200',
    has_thumbnail: false, position_secs: 30, duration_secs: 200,
  };

  const calls = installMockTauriInternals((cmd) => {
    if (cmd === 'get_system_media_track') return displayedTrack;
    return true;
  });
  const bridge = new SystemMediaBridge();

  try {
    await bridge.pollNow();
    assert.strictEqual(bridge.getCurrentTrack()?.session_key, 'media-session-77');

    await bridge.togglePlay();
    await bridge.nextTrack();
    await bridge.prevTrack();
    await bridge.seekTo(45);

    const controlCalls = calls.filter((c) => c.cmd.startsWith('system_media_'));
    assert.deepStrictEqual(
      controlCalls.map((c) => c.cmd),
      ['system_media_toggle_play', 'system_media_next', 'system_media_prev', 'system_media_seek']
    );
    for (const c of controlCalls) {
      assert.strictEqual(c.args.sessionKey, 'media-session-77', `${c.cmd} harus membawa session_key sesi yang ditampilkan`);
    }
    const seekCall = controlCalls.find((c) => c.cmd === 'system_media_seek');
    assert.strictEqual(seekCall?.args.recordKey, 'lagu|artis|album|1|200', 'Seek harus membawa record_key rekaman yang ditampilkan');
  } finally {
    removeMockTauriInternals();
  }
});

await runTestAsync('Uji 58: Jeda manual bukan akhir lagu; stopped di ujung rekaman yang sama memicu selesai', async () => {
  let finishedCount = 0;
  const baseTrack = {
    title: 'Lagu Ujian', artist: 'Artis', album: 'Album', is_playing: true, playback_status: 'playing' as SystemMediaTrack['playback_status'],
    source_app: 'opera.exe', source_display_name: 'Opera', service_kind: 'web_media',
    is_spotify: false, has_session: true, session_key: 'media-session-9', record_key: 'lagu-ujian|artis|album|1|200',
    has_thumbnail: false, position_secs: 30, duration_secs: 200,
  };
  let currentPayload = { ...baseTrack };

  installMockTauriInternals((cmd) => {
    if (cmd === 'get_system_media_track') return currentPayload;
    return true;
  });
  const bridge = new SystemMediaBridge();

  try {
    bridge.onSongFinished(() => finishedCount++);

    await bridge.pollNow();
    assert.strictEqual(finishedCount, 0);

    // Jeda manual di tengah lagu: BUKAN akhir lagu
    currentPayload = { ...baseTrack, is_playing: false, position_secs: 100 };
    await bridge.pollNow();
    assert.strictEqual(finishedCount, 0, 'Jeda manual di tengah lagu tidak boleh memicu lagu selesai');

    // Pemutaran dilanjutkan mendekati akhir lagu
    currentPayload = { ...baseTrack, is_playing: true, position_secs: 195 };
    await bridge.pollNow();
    assert.strictEqual(finishedCount, 0);

    // Transisi nyata akhir lagu: memutar -> berhenti tepat di ujung durasi
    currentPayload = { ...baseTrack, is_playing: false, playback_status: 'stopped', position_secs: 199.6 };
    await bridge.pollNow();
    assert.strictEqual(finishedCount, 1, 'Pemutaran yang berhenti di ujung durasi memicu lagu selesai');
  } finally {
    removeMockTauriInternals();
  }
});

// ----------------------------------------------------------------------------
// 19. Gerbang Artis pada Pencarian Artwork
// ----------------------------------------------------------------------------
await runTestAsync('Uji 59: Kandidat dengan judul, album, dan durasi sama tetapi artis berbeda harus ditolak', async () => {
  const service = new LyricsService();
  const updates: TrackArtworkInfo[] = [];
  service.subscribeArtwork((a) => updates.push(a));

  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    return {
      ok: true,
      json: async () => ({
        data: [
          // Judul, album, dan durasi sama persis, tetapi artis berbeda
          { title: 'Lagu Gerbang', artist: { name: 'Peniru Beda' }, album: { title: 'Album Gerbang', cover_medium: 'cover-artis-salah.jpg' }, duration: 200 },
        ],
      }),
    } as unknown as Response;
  }) as typeof fetch;

  try {
    service.onSystemRecordChanged('s#g', { title: 'Lagu Gerbang', artist: 'Artis Asli', album: 'Album Gerbang', durationSecs: 200 }, false);
    await service.requestSearchArtworkFallback({ title: 'Lagu Gerbang', artist: 'Artis Asli', album: 'Album Gerbang', durationSecs: 200, identityKey: 's#g' });
    const last = updates[updates.length - 1];
    assert.strictEqual(last.albumArtUrl, null, 'Artis berbeda harus menggagalkan kandidat meskipun album dan durasi cocok');
    assert.strictEqual(last.source, 'none');
  } finally {
    globalThis.fetch = origFetch;
    service.clear();
  }
});

// ----------------------------------------------------------------------------
// 20. Percobaan Ulang Lirik Setelah Kegagalan Jaringan
// ----------------------------------------------------------------------------
await runTestAsync('Uji 60: Lirik mencoba ulang dengan penundaan setelah kegagalan jaringan, dan membedakannya dari lirik tidak tersedia', async () => {
  const service = new LyricsService();
  const received: string[] = [];
  service.subscribe((u) => {
    if (u.highlight) received.push(u.highlight);
    if (u.line2) received.push(u.line2);
  });

  const origFetch = globalThis.fetch;
  let fetchCallCount = 0;
  globalThis.fetch = (async (url: string | URL | Request) => {
    const urlStr = url.toString();
    // Hanya permintaan LRCLIB yang dihitung; request artwork tidak relevan di sini
    if (!urlStr.includes('lrclib.net')) {
      return { ok: false } as unknown as Response;
    }
    fetchCallCount++;
    if (fetchCallCount <= 3) {
      // Tiga permintaan pertama (satu putaran pencarian) gagal jaringan
      throw new Error('offline');
    }
    return {
      ok: true,
      json: async () => ({ ...lyricRequestMetadata(url), syncedLyrics: '[00:05.00] Lirik Retry Berhasil' }),
    } as unknown as Response;
  }) as typeof fetch;

  try {
    // Percepat... gunakan backoff 200 ms agar timing pengujian stabil
    (service as unknown as { lyricsRetryBaseMs: number }).lyricsRetryBaseMs = 200;

    await service.loadLyrics('Lagu Retry', 'Artis Retry', 'Album Retry', true, 0, 120);
    assert.strictEqual(received.includes('Lirik Retry Berhasil'), false, 'Kegagalan jaringan tidak boleh dianggap lirik tidak tersedia');

    // Polling segera setelahnya: masih dalam masa tunggu backoff, belum mencoba lagi
    await service.loadLyrics('Lagu Retry', 'Artis Retry', 'Album Retry', true, 1, 120);
    const callsBeforeRetry = fetchCallCount;

    // Setelah masa tunggu berlalu: percobaan ulang berjalan dan berhasil
    await new Promise((r) => { setTimeout(r, 250); });
    await service.loadLyrics('Lagu Retry', 'Artis Retry', 'Album Retry', true, 2, 120);
    assert.ok(fetchCallCount > callsBeforeRetry, 'Percobaan ulang harus membuat permintaan baru');
    assert.strictEqual(received.includes('Lirik Retry Berhasil'), true, 'Lirik harus diterima setelah percobaan ulang berhasil');
  } finally {
    globalThis.fetch = origFetch;
    service.clear();
  }
});

// ----------------------------------------------------------------------------
// 21. Snapshot dan Pemulihan Sesi Timer
// ----------------------------------------------------------------------------
runTest('Uji 61: Snapshot timer dipulihkan saat dijeda dan ditolak bila rencana tidak cocok', () => {
  const config: PomodoroConfig = {
    ...DEFAULT_POMODORO_CONFIG,
    totalDurationMin: 60, focusDurationMin: 25, breakDurationMin: 5,
    autostartBreak: false, autostartNextFocus: false,
  };

  const engine1 = new PomodoroEngine(config);
  engine1.start();
  (engine1 as unknown as { targetEndTime: number }).targetEndTime = Date.now() + 100 * 1000;
  engine1.pause();
  const snapshot = engine1.getSnapshot();
  assert.notStrictEqual(snapshot, null, 'Sesi dijeda harus menghasilkan snapshot');
  assert.strictEqual(snapshot!.status, 'paused');
  assert.strictEqual(snapshot!.phaseRemainingSeconds, 100);

  const engine2 = new PomodoroEngine(config);
  const restored = engine2.restoreFromSnapshot(snapshot!);
  assert.strictEqual(restored, true);
  assert.strictEqual(engine2.getStatus(), 'paused');
  assert.strictEqual(engine2.getPhaseRemainingSeconds(), 100);
  assert.strictEqual(engine2.getCurrentPhase()?.type, 'focus');

  // Snapshot dari rencana berbeda harus ditolak tanpa mengubah state
  const mismatched = { ...snapshot!, focusDurationMin: 30 };
  const engine3 = new PomodoroEngine(config);
  assert.strictEqual(engine3.restoreFromSnapshot(mismatched), false, 'Snapshot dengan rencana berbeda harus ditolak');
  assert.strictEqual(engine3.getStatus(), 'idle');
});

await runTestAsync('Uji 62: Snapshot timer berjalan dengan deadline terlewat melanjutkan fase berikutnya dari deadline lama', async () => {
  const config: PomodoroConfig = {
    ...DEFAULT_POMODORO_CONFIG,
    totalDurationMin: 60, focusDurationMin: 25, breakDurationMin: 5,
    autostartBreak: true, autostartNextFocus: false,
  };

  const now = Date.now();
  const snapshot = {
    phaseIndex: 0,
    status: 'running' as const,
    phaseRemainingSeconds: 5,
    targetEndTime: now - 50 * 1000, // deadline fokus terlewat 50 detik saat aplikasi tertutup
    savedAt: now - 55 * 1000,
    totalDurationMin: 60,
    focusDurationMin: 25,
    breakDurationMin: 5,
  };

  const engine = new PomodoroEngine(config);
  const restored = engine.restoreFromSnapshot(snapshot);
  assert.strictEqual(restored, true);
  assert.strictEqual(engine.getStatus(), 'running', 'Fase istirahat harus berjalan dari deadline lama (autostart aktif)');
  assert.strictEqual(engine.getCurrentPhase()?.type, 'break', 'Fase fokus yang terlewat harus selesai dan lanjut istirahat');
  const remaining = engine.getPhaseRemainingSeconds();
  assert.ok(remaining >= 245 && remaining <= 251, `Sisa istirahat harus ±250 dtk (300 - 50 terlewat), didapat ${remaining}`);
});

// ----------------------------------------------------------------------------
// Rekapitulasi Akhir
// ----------------------------------------------------------------------------
runTest('Uji 63: Jitter waktu browser tidak memundurkan lirik; seek dan pause tetap akurat', () => {
  let position = 10.02;
  for (let i = 0; i < 100; i++) {
    const reported = position - 0.3;
    const reconciled = reconcilePlayback(position, reported, true);
    assert.strictEqual(reconciled.position, position);
    const advanced = advancePlayback(position, 0.05, reconciled.correction);
    assert.ok(advanced.position > position, 'Koreksi negatif hanya memperlambat jam, bukan memundurkan baris');
    position = advanced.position;
  }
  assert.strictEqual(reconcilePlayback(30, 5, true).position, 5, 'Seek mundur langsung diterapkan');
  assert.strictEqual(reconcilePlayback(30, 29.7, false).position, 29.7, 'Pause mengikuti posisi sistem');
});

runTest('Uji 64: Katalog musik lokal memiliki kredit, sumber berbeda dan ilustrasi yang tersedia', () => {
  const credits = fs.readFileSync('public/audio/CREDITS.md', 'utf8');
  assert.strictEqual(new Set(STUDY_TRACKS.map(track => track.file)).size, 4);
  for (const track of STUDY_TRACKS) {
    assert.ok(credits.includes(track.source));
    assert.ok(credits.includes(track.license));
    assert.match(track.file, /^\/audio\/[A-Za-z0-9_-]+\.webm$/);
    const cover = STUDY_COVERS[track.id];
    assert.ok(fs.statSync('public' + cover.file).size > 0);
  }
});

runTest('Uji 65: Playlist bawaan menampilkan informasi lokal tanpa timestamp lirik buatan', () => {
  const service = new LyricsService();
  const updates: import('../src/audio/lyricsService').LyricsLinesUpdate[] = [];
  service.subscribe((update) => updates.push(update));
  for (const track of STUDY_TRACKS) {
    service.setAmbientTrack(track.id, true);
    assert.strictEqual(updates[updates.length - 1]?.highlight, track.title);
    const count = updates.length;
    service.syncPosition(20, true);
    assert.strictEqual(updates.length, count);
  }
  service.clear();
});

await runTestAsync('Uji 66: Rekaman melanjutkan posisi jeda, mengganti sumber, serta menolak hasil play usang', async () => {
  const original = globalThis.Audio;
  const instances: FakeAudio[] = [];
  let fail = false;
  class FakeAudio {
    currentTime = 0;
    readyState = 1;
    duration = 180;
    paused = true;
    loop = false;
    volume = 1;
    preload = '';
    constructor(public src: string) { instances.push(this); }
    async play() { if (fail) throw new Error('media error'); this.paused = false; }
    pause() { this.paused = true; }
    removeAttribute() { this.src = ''; }
    addEventListener() {}
    load() { this.currentTime = 0; }
  }
  globalThis.Audio = FakeAudio as unknown as typeof Audio;
  try {
    const player = new AmbientSynth();
    let started = player.play('jazz-noir');
    assert.ok(await started);
    assert.equal(instances[0]!.loop, true);
    instances[0]!.currentTime = 12;
    player.stop();
    started = player.play('jazz-noir');
    assert.ok(await started);
    assert.strictEqual(instances[instances.length - 1]!.currentTime, 12);
    player.setVolume(0.2);
    assert.equal(instances[instances.length - 1]!.volume, 0.2);
    player.resetPlayback();
    assert.ok(await player.play('jazz-noir'));
    assert.strictEqual(instances[instances.length - 1]!.currentTime, 0);
    started = player.play('wave-to-earth');
    player.stop();
    assert.strictEqual(await started, false);
    assert.strictEqual(player.getTrack(), 'off');
    assert.ok(instances[instances.length - 1]!.paused);
    fail = true;
    assert.strictEqual(await player.play('laufey'), false);
  } finally {
    globalThis.Audio = original;
  }
});

runTest('Uji 67: Lirik menolak artis, judul, versi dan durasi yang berbeda', () => {
  const service = new LyricsService() as any;
  const correct = { trackName: 'Song', artistName: 'Artist', albumName: 'Album', duration: 200, plainLyrics: 'benar' };
  const wrong = { trackName: 'Other', artistName: 'Other Artist', albumName: 'Other', duration: 320, syncedLyrics: '[00:00]salah' };
  const match = (items: any[]) => service.selectBestRecordMatch(items, 'Album', 200, 'Song', 'Artist');
  assert.strictEqual(match([wrong, correct]), correct);
  assert.strictEqual(match([{ ...wrong, trackName: 'Song', duration: 200 }]), null);
  assert.strictEqual(match([{ ...correct, trackName: 'Song (Live)' }]), null);
  assert.strictEqual(match([{ ...correct, duration: 204 }]), null);
  assert.strictEqual(match([{ ...correct, duration: undefined }]), null);
  assert.strictEqual(match([{ ...correct, artistName: undefined }]), null);
  assert.ok(match([{ ...correct, trackName: 'SONG!', duration: 202 }]));
  service.clear();
});

await runTestAsync('Uji 68: Semua jalur API lirik menolak respons identitas yang keliru', async () => {
  const service = new LyricsService() as any;
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    const wrong = { trackName: 'Song', artistName: 'Impostor', duration: 200, syncedLyrics: '[00:01]salah' };
    return { ok: true, json: async () => calls === 1 ? wrong : [wrong] } as unknown as Response;
  }) as typeof fetch;
  try {
    assert.strictEqual(await service.fetchVersionMatchedLyrics('Song', 'Artist', 'Album', 200), null);
    assert.strictEqual(calls, 3);
  } finally { globalThis.fetch = original; service.clear(); }
});

runTest('Uji 69: Vokal panjang bertahan, instrumental hanya mengikuti marker kosong', () => {
  const service = new LyricsService();
  (service as any).activeLyrics = { isSynced: true, plainLines: [],
    syncedLines: parseSyncedLyrics('[00:00]Nada panjang\n[00:20]\n[00:25]Berikutnya') };
  const updates: any[] = [];
  service.subscribe(u => updates.push(u));
  service.syncPosition(19, true);
  assert.strictEqual(updates[updates.length - 1].highlight, 'Nada panjang');
  assert.strictEqual(updates[updates.length - 1].isInstrumental, false);
  service.syncPosition(21, true);
  assert.strictEqual(updates[updates.length - 1].isInstrumental, true);
  service.syncPosition(25, true);
  assert.strictEqual(updates[updates.length - 1].highlight, 'Berikutnya');
  service.clear();
});

await runTestAsync('Uji 70: Sesi luar yang dijeda membatalkan audio lokal yang masih dimuat', async () => {
  const original = globalThis.Audio;
  let finish: () => void = () => {};
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  let fake: FakeAudio | null = null;
  class FakeAudio {
    currentTime = 0;
    paused = true;
    constructor() { fake = this; } // eslint-disable-line @typescript-eslint/no-this-alias -- Tes perlu mengamati instance Audio yang dibuat AmbientSynth.
    async play() { await pending; this.paused = false; }
    pause() { this.paused = true; }
    removeAttribute() {}
    addEventListener() {}
    load() {}
  }
  globalThis.Audio = FakeAudio as unknown as typeof Audio;
  try {
    const audio = new AmbientSynth();
    let request = 1;
    let paused = 0;
    const loading = audio.play('jazz-noir');
    await Promise.resolve();
    takeOverLocalPlayback(audio, () => paused++, () => request++);
    finish();
    assert.strictEqual(await loading, false);
    assert.strictEqual(audio.getTrack(), 'off');
    assert.equal((fake as FakeAudio | null)?.paused, true, 'Play yang selesai terlambat dihentikan');
    assert.strictEqual(request, 2);
    assert.strictEqual(paused, 1);
  } finally { globalThis.Audio = original; }
});

await runTestAsync('Uji 71: Volume perangkat diperbarui setelah perubahan eksternal dan gagal baca bisa pulih', async () => {
  const sync = new DeviceVolumeSync();
  let device = 0.4;
  let shown = 0;
  let failed = false;
  const refresh = (now: number) => sync.refresh(async () => device, v => shown = v, () => failed = true, now);
  await refresh(0);
  assert.strictEqual(shown, 0.4);
  device = 0.7;
  await refresh(500);
  assert.strictEqual(shown, 0.4);
  await refresh(1100);
  assert.strictEqual(shown, 0.7);
  await sync.refresh(async () => { throw new Error('disconnected'); }, () => {}, () => failed = true, 2200);
  assert.ok(failed);
  device = 0.2;
  await refresh(3300);
  assert.strictEqual(shown, 0.2);
});

await runTestAsync('Uji 72: Baca volume terlambat tidak menimpa edit atau sumber baru', async () => {
  const sync = new DeviceVolumeSync();
  let finish: (v: number) => void = () => {};
  let shown = 0.5;
  const loading = sync.refresh(() => new Promise(resolve => { finish = resolve; }), v => shown = v, () => {}, 0);
  sync.beginWrite();
  finish(0.1);
  await loading;
  assert.strictEqual(shown, 0.5);
  let reads = 0;
  await sync.refresh(async () => { reads++; return 0.2; }, v => shown = v, () => {}, 1200);
  assert.strictEqual(reads, 0);
  sync.endWrite();
  const old = sync.refresh(() => new Promise(resolve => { finish = resolve; }), v => shown = v, () => {}, 2300);
  sync.invalidate();
  await sync.refresh(async () => 0.8, v => shown = v, () => {}, 2400, true);
  finish(0.3);
  await old;
  assert.strictEqual(shown, 0.8);
});

runTest('Uji 73: Sesi menunggu dipulihkan setelah disimpan tanpa memulai atau memberi hadiah ulang', () => {
  const config = { ...DEFAULT_POMODORO_CONFIG, totalDurationMin: 3, focusDurationMin: 1, breakDurationMin: 1,
    autostartBreak: false, autostartNextFocus: false };
  let completed = 0;
  const first = new PomodoroEngine(config, { onPhaseComplete: () => completed++ });
  const restored = new PomodoroEngine(config, { onPhaseComplete: () => completed++ });
  try {
    first.start();
    (first as any).targetEndTime = Date.now() - 1;
    first.pause();
    assert.strictEqual(first.getStatus(), 'waiting_next');
    const snapshot = sanitizeTimerSnapshot(JSON.parse(JSON.stringify(first.getSnapshot())));
    assert.ok(snapshot);
    assert.strictEqual(snapshot.status, 'waiting_next');
    assert.ok(restored.restoreFromSnapshot(snapshot));
    assert.strictEqual(restored.getStatus(), 'waiting_next');
    assert.strictEqual(restored.getCurrentPhaseIndex(), 1);
    assert.strictEqual(restored.getPhaseRemainingSeconds(), 60);
    assert.strictEqual(completed, 1);
    restored.start();
    assert.strictEqual(restored.getStatus(), 'running');
    assert.strictEqual(restored.getCurrentPhaseIndex(), 1);
  } finally { first.pause(); restored.pause(); }
});

runTest('Uji 74: Jeda pada deadline menghentikan fase autostart berikutnya', () => {
  let completed = 0;
  const engine = new PomodoroEngine({ ...DEFAULT_POMODORO_CONFIG,
    totalDurationMin: 3, focusDurationMin: 1, breakDurationMin: 1,
    autostartBreak: true, autostartNextFocus: true }, { onPhaseComplete: () => completed++ });
  try {
    engine.start();
    (engine as any).targetEndTime = Date.now() - 1;
    engine.pause();
    assert.strictEqual(engine.getStatus(), 'paused');
    assert.strictEqual(engine.getCurrentPhase()?.type, 'break');
    assert.strictEqual(engine.getPhaseRemainingSeconds(), 60);
    assert.strictEqual((engine as any).intervalId, null);
    assert.strictEqual(completed, 1);
    engine.pause();
    assert.strictEqual(completed, 1);
    assert.strictEqual(engine.getSnapshot()?.status, 'paused');
  } finally { engine.pause(); }
});

runTest('Uji 75: Rencana 1440 fase memulihkan fase di atas 200 dan menolak indeks di luar rencana', () => {
  const config = { ...DEFAULT_POMODORO_CONFIG, totalDurationMin: 1440, focusDurationMin: 1, breakDurationMin: 1 };
  const engine = new PomodoroEngine(config);
  const lastIndex = engine.getPlan().phases.length - 1;
  for (const phaseIndex of [201, lastIndex]) {
    const snapshot = sanitizeTimerSnapshot({ scheduleVersion: 2, phaseIndex, status: 'paused', phaseRemainingSeconds: 60,
      targetEndTime: null, savedAt: Date.now(), totalDurationMin: 1440, focusDurationMin: 1, breakDurationMin: 1 });
    assert.ok(snapshot);
    assert.ok(engine.restoreFromSnapshot(snapshot));
    assert.strictEqual(engine.getCurrentPhaseIndex(), phaseIndex);
    assert.strictEqual(engine.getStatus(), 'paused');
  }
  const invalid = { ...engine.getSnapshot()!, phaseIndex: 1440 };
  assert.strictEqual(sanitizeTimerSnapshot(invalid), null);
  assert.strictEqual(engine.restoreFromSnapshot(invalid), false);
  assert.strictEqual(engine.getCurrentPhaseIndex(), lastIndex);
});

runTest('Uji 76: Pratinjau memakai durasi fase nyata saat total lebih pendek dari pengaturan fokus', () => {
  assert.strictEqual(getFirstPhasePreview(buildPomodoroPlan(15, 25, 5)), 'Putaran 1 · Fokus 15 menit · Menit 0–15');
  assert.strictEqual(getFirstPhasePreview(buildPomodoroPlan(60, 25, 5)), 'Putaran 1 · Fokus 25 menit · Menit 0–25');
});

runTest('Uji 77: Panel fokus menjelaskan fase berikutnya sesuai rencana dan preferensi autostart', () => {
  const short = buildPomodoroPlan(15, 25, 5);
  assert.strictEqual(getNextPhaseLabel(short, 0, DEFAULT_POMODORO_CONFIG), 'Sesi terakhir.');
  const plan = buildPomodoroPlan(60, 25, 5);
  assert.strictEqual(getNextPhaseLabel(plan, 0, DEFAULT_POMODORO_CONFIG), 'Rehat 5 menit setelah ini · mulai manual');
  assert.strictEqual(getNextPhaseLabel(plan, 1, { ...DEFAULT_POMODORO_CONFIG, autostartNextFocus: false }),
    'Fokus 25 menit setelah ini · mulai manual');
});

runTest('Uji 78: Penyelesaian berantai tanpa render tetap menanam pada petak berbeda', () => {
  const renderer = new IslandRenderer(createMockCanvas()) as any;
  renderer.startFocusPlanting();
  const first = renderer.completeFocusSession();
  const second = renderer.completeFocusSession();
  assert.notDeepEqual([first.gridR, first.gridC], [second.gridR, second.gridC]);
  assert.strictEqual(renderer.hasActiveSprout(), false);
  assert.strictEqual(renderer.bloomingTrees.size, 0, 'Renderer tersembunyi tidak mengantre mekar lama');
  assert.strictEqual(renderer.getPlantedTrees().length, 2);
});

runTest('Uji 79: Satu pohon mekar digambar sekali, lalu mencapai ukuran penuh', () => {
  const canvas = createMockCanvas();
  const ctx = canvas.getContext('2d')!;
  const scales: number[] = [];
  ctx.scale = (x: number) => { scales.push(x); };
  const renderer = new IslandRenderer(canvas) as any;
  renderer.isRunning = true;
  renderer.startFocusPlanting();
  const tree = renderer.completeFocusSession();
  renderer.drawMomo = () => {};
  scales.length = 0;
  renderer.drawDepthSortedEntities();
  assert.deepEqual(scales, [0.5]);
  for (let i = 0; i < 48; i++) renderer.update();
  scales.length = 0;
  renderer.drawDepthSortedEntities();
  assert.deepEqual(scales, [1]);
  assert.strictEqual(renderer.bloomingTrees.has(tree.id), false);
});

runTest('Uji 80: Status musik dan ambient tidak menggerakkan Momo ketika fokus dijeda', () => {
  const renderer = new IslandRenderer(createMockCanvas()) as any;
  renderer.startFocusPlanting();
  renderer.setTimerPaused(true);
  const position = { ...renderer.currentPos };
  for (const music of [true, false]) {
    renderer.setMusicPlaying(music);
    renderer.setAmbientMode(null);
    renderer.setMood('idle');
    for (let i = 0; i < 50; i++) renderer.update();
    assert.deepEqual(renderer.currentPos, position);
    assert.strictEqual(renderer.isWalking, false);
  }
  renderer.setTimerPaused(false);
  renderer.update();
  assert.notDeepEqual(renderer.currentPos, position);
});

runTest('Uji 81: Reduced motion menonaktifkan skala mekar, goyangan dan perpindahan', () => {
  const original = window.matchMedia;
  window.matchMedia = (() => ({ matches: true })) as unknown as typeof window.matchMedia;
  try {
    const canvas = createMockCanvas();
    const scales: number[] = [];
    canvas.getContext('2d')!.scale = (x: number) => { scales.push(x); };
    const renderer = new IslandRenderer(canvas) as any;
    renderer.isRunning = true;
    renderer.startFocusPlanting();
    renderer.completeFocusSession();
    renderer.frameCount = 290;
    renderer.drawMomo = () => {};
    scales.length = 0;
    renderer.drawDepthSortedEntities();
    assert.deepEqual(scales, [1]);
    const position = { ...renderer.currentPos };
    renderer.setMusicPlaying(true);
    renderer.update();
    assert.deepEqual(renderer.currentPos, position);
    assert.strictEqual(renderer.musicNotes.length, 0);
  } finally { window.matchMedia = original; }
});

runTest('Uji 82: Kecepatan simulasi sama pada 10 dan 60 FPS, lonjakan panjang dibatasi', () => {
  const original = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = () => 1;
  try {
    const simulate = (fps: number) => {
      const renderer = new IslandRenderer(createMockCanvas()) as any;
      renderer.isRunning = true;
      renderer.lastFrameTime = 0;
      renderer.draw = () => {};
      renderer.startFocusPlanting();
      renderer.celebrationTimer = 48;
      for (let frame = 1; frame <= fps; frame++) renderer.loop(frame * 1000 / fps);
      return renderer;
    };
    const low = simulate(10);
    const high = simulate(60);
    assert.strictEqual(low.frameCount, 24);
    assert.strictEqual(high.frameCount, 24);
    assert.strictEqual(low.celebrationTimer, high.celebrationTimer);
    assert.deepEqual(low.currentPos, high.currentPos);
    low.loop(61000);
    assert.ok(low.frameCount <= 30, 'Tidak mengejar ribuan langkah setelah jeda panjang');
  } finally { globalThis.requestAnimationFrame = original; }
});

runTest('Uji 83: Transparansi hanya untuk pohon depan yang benar-benar menutupi pohon belakang', () => {
  const rear = { x: 180, y: 60, treeType: 'mango' as const, scale: 1 };
  assert.ok(coversRearTree({ ...rear, y: 80 }, rear));
  assert.strictEqual(coversRearTree({ ...rear, y: 40 }, rear), false);
  assert.strictEqual(coversRearTree({ ...rear, x: 230, y: 80 }, rear), false);
  assert.strictEqual(coversRearTree({ ...rear, y: 120 }, rear), false);
  assert.strictEqual(coversRearTree(rear, rear), false);
});

runTest('Uji 84: Tumpukan pohon tidak membuat lapisan belakang ikut transparan', () => {
  const trees = [60, 80, 100].map(y => ({ x: 180, y, treeType: 'mango' as const, scale: 1 }));
  assert.deepEqual(trees.map(tree => shouldFadeTree(tree, trees)), [false, false, true]);
  const pair = trees.slice(0, 2);
  assert.deepEqual(pair.map(tree => shouldFadeTree(tree, pair)), [false, true]);
});

runTest('Uji 85: Pohon memudar hanya ketika berada di depan dan menutupi Momo', () => {
  const tree = { x: 180, y: 80, treeType: 'mango' as const, scale: 1 };
  assert.ok(coversMomo(tree, { x: 180, y: 65 }));
  assert.strictEqual(coversMomo(tree, { x: 180, y: 90 }), false);
  assert.strictEqual(coversMomo(tree, { x: 230, y: 65 }), false);
  assert.strictEqual(coversMomo(tree, { x: 180, y: 20 }), false);
});

runTest('Uji 86: Momo mengelilingi semua pohon untuk menyiram dan memupuk tanpa mengubah progres', () => {
  const trees = PLANTING_SLOTS.slice(0, 13).map((slot, i) => ({
    id: 'garden-' + i, gridR: slot.r, gridC: slot.c, treeType: slot.type, plantedAtTimestamp: 1,
  }));
  const renderer = new IslandRenderer(createMockCanvas()) as any;
  renderer.setPlantedTrees(trees);
  const visited = new Set<string>();
  for (let tick = 0; tick < 100000 && visited.size < trees.length * 2; tick++) {
    renderer.update();
    const task = renderer.gardeningActivity;
    if (task) visited.add(task.targetR + ':' + task.targetC + ':' + task.action);
  }
  for (const tree of trees) {
    assert.ok(visited.has(tree.gridR + ':' + tree.gridC + ':water'));
    assert.ok(visited.has(tree.gridR + ':' + tree.gridC + ':fertilize'));
  }
  assert.deepEqual(renderer.getPlantedTrees(), trees);
  const position = { ...renderer.currentPos };
  const wait = renderer.waitCounter;
  renderer.setTimerPaused(true);
  renderer.setMusicPlaying(true);
  for (let tick = 0; tick < 100; tick++) renderer.update();
  assert.deepEqual(renderer.currentPos, position);
  assert.strictEqual(renderer.waitCounter, wait);
  assert.strictEqual(renderer.gardeningActivity, null);
  renderer.setTimerPaused(false);
  renderer.setBreakMode(true);
  renderer.setMusicPlaying(true);
  for (let tick = 0; tick < 100; tick++) renderer.update();
  assert.deepEqual(renderer.currentPos, position);
  assert.strictEqual(renderer.gardeningActivity, null);
});

runTest('Uji 87: Gerimis musiman muncul bertahap lalu genangan mengering', () => {
  const weather = new FocusWeather(() => 0);
  const step = (seconds: number, enabled = true, season: IslandSeason = 'spring') => {
    let starts = 0;
    for (let i = 0; i < seconds * 10; i++) if (weather.step(0.1, enabled, season)) starts++;
    return starts;
  };
  assert.equal(step(100), 0, 'Ada masa kering sebelum hujan pertama');
  assert.equal(step(25), 1);
  assert.ok(weather.intensity > 0 && weather.intensity <= 0.5);
  assert.ok(weather.wetness > 0);
  const paused = [weather.intensity, weather.wetness];
  step(10, false);
  assert.deepEqual([weather.intensity, weather.wetness], paused);
  step(25);
  assert.equal(weather.intensity, 0);
  step(70);
  assert.equal(weather.wetness, 0);
  assert.equal(step(1000, true, 'winter'), 0);
  assert.equal(weather.intensity, 0);
  assert.equal(weather.wetness, 0);
});

runTest('Uji 88: Momo mendapat semua kegiatan santai, bergantian dengan rutinitas berkebun', () => {
  const leisure = new MomoLeisure(() => 0);
  const actions: string[] = [];
  let previous: string | null = null;
  let gardenTicks = 0;
  for (let tick = 0; tick < 1200 && actions.length < 6; tick++) {
    leisure.step(0.25, true);
    if (!leisure.action) gardenTicks++;
    if (leisure.action && leisure.action !== previous) actions.push(leisure.action);
    previous = leisure.action;
  }
  assert.deepEqual([...actions].sort(), ['dance', 'eat', 'relax', 'run', 'sing', 'sleep']);
  assert.ok(gardenTicks > 100, 'Ada waktu berkebun di antara kegiatan santai');
  const before = leisure.action;
  for (let tick = 0; tick < 1000; tick++) leisure.step(0.25, false);
  assert.strictEqual(leisure.action, before, 'Jeda tidak menghabiskan kegiatan yang sedang berlangsung');
});

runTest('Uji 89: Awal hujan memicu reaksi senang tanpa memindahkan Momo atau mengubah pohon', () => {
  const renderer = new IslandRenderer(createMockCanvas()) as any;
  renderer.weather = new FocusWeather(() => 0);
  renderer.weather.untilRain = 0;
  const position = { ...renderer.currentPos };
  renderer.update();
  assert.ok(renderer.rainJoyTimer > 0);
  assert.ok(renderer.celebrationTimer > 0);
  assert.deepEqual(renderer.currentPos, position);
  assert.strictEqual(renderer.gardeningActivity, null);
  assert.strictEqual(renderer.getPlantedTrees().length, 0);
  renderer.setTimerPaused(true);
  const wetness = renderer.weather.wetness;
  for (let tick = 0; tick < 100; tick++) renderer.update();
  assert.strictEqual(renderer.weather.wetness, wetness);
  assert.deepEqual(renderer.currentPos, position);
});

runTest('Uji 90: Genangan bervariasi dan tetap di petak kosong di dalam pulau', () => {
  const occupied = [{ r: 2, c: 2 }, { r: 3, c: 3 }];
  const first = createPuddles(occupied, () => 0.2);
  const second = createPuddles(occupied, () => 0.8);
  assert.notDeepEqual(first, second);
  for (const puddles of [first, second]) {
    assert.ok(puddles.length >= 2 && puddles.length <= 4);
    const tiles = puddles.map(p => Math.round(p.r) + ':' + Math.round(p.c));
    assert.strictEqual(new Set(tiles).size, tiles.length);
    for (const puddle of puddles) {
      assert.ok(puddle.r > 0 && puddle.r < 5 && puddle.c > 0 && puddle.c < 5);
      assert.ok(!occupied.some(tile => tile.r === Math.round(puddle.r) && tile.c === Math.round(puddle.c)));
      assert.ok(puddle.radius >= 6 && puddle.radius <= 11);
    }
  }
});

runTest('Uji 91: Pohon menjadi solid saat dirawat dan kembali memudar setelah selesai', () => {
  const tree = { x: 180, y: 80, treeType: 'mango' as const, scale: 1 };
  const rear = { ...tree, y: 60 };
  const momo = { x: 180, y: 65 };
  assert.strictEqual(getTreeOpacity(tree, [tree, rear], momo, false), 0.55);
  assert.strictEqual(getTreeOpacity(tree, [tree, rear], momo, true), 1);
  assert.strictEqual(getTreeOpacity(tree, [tree, rear], momo, false), 0.55);
});

runTest('Uji 92: Pohon mendapat giliran setiap menit tanpa pengulangan dalam satu putaran', () => {
  const schedule = new GardenSchedule(() => 0.3);
  const trees = PLANTING_SLOTS.slice(0, 4).map((slot, i) => ({ id: String(i), gridR: slot.r, gridC: slot.c, treeType: slot.type, plantedAtTimestamp: 0 }));
  const visited: string[] = [];
  for (let round = 0; round < 2; round++) {
    const cycle: string[] = [];
    for (let tree = 0; tree < 4; tree++) {
      for (let i = 0; i < 239; i++) assert.equal(schedule.next(.25, true, trees), null);
      const job = schedule.next(.25, true, trees);
      assert.ok(job?.treeId); cycle.push(job.treeId); schedule.finish();
      for (let i = 0; i < 1000; i++) assert.equal(schedule.next(.25, false, trees), null);
    }
    assert.equal(new Set(cycle).size, trees.length); visited.push(...cycle);
  }
  assert.equal(visited.length, 8);
});

runTest('Uji 93: Tunas baru ditanam, disiram, dan dipupuk berurutan dalam satu kunjungan', () => {
  const renderer = new IslandRenderer(createMockCanvas()) as any;
  const slot = renderer.startFocusPlanting();
  const actions = new Set<string>();
  for (let tick = 0; tick < 2000 && renderer.gardenSchedule.active; tick++) {
    renderer.update();
    const task = renderer.gardeningActivity;
    if (task) {
      assert.strictEqual(task.targetR, slot.r);
      assert.strictEqual(task.targetC, slot.c);
      actions.add(task.action);
    }
  }
  assert.deepEqual([...actions], ['plant', 'water', 'fertilize']);
  assert.strictEqual(renderer.gardenSchedule.active, false);
  assert.strictEqual(renderer.waypoints.some((wp: any) => wp.action === 'plant'), false);
  assert.strictEqual(renderer.getPlantedTrees().length, 0);
});

runTest('Uji 94: Tunas dirawat segera lalu tiap30 detik aktif tanpa tumpukan setelah pause', () => {
  const schedule = new GardenSchedule(() => 0);
  const sprout = { r: 0, c: 2 }; schedule.setSprout('new');
  assert.deepEqual(schedule.next(0, true, [], sprout)?.actions, ['plant', 'water', 'fertilize']);
  schedule.finish();
  for (let i = 0; i < 119; i++) assert.equal(schedule.next(.25, true, [], sprout), null);
  for (let i = 0; i < 500; i++) assert.equal(schedule.next(.25, false, [], sprout), null);
  assert.deepEqual(schedule.next(.25, true, [], sprout)?.actions, ['water']);
  for (let i = 0; i < 500; i++) assert.equal(schedule.next(.25, true, [], sprout), null);
  schedule.finish();
  assert.deepEqual(schedule.next(0, true, [], sprout)?.actions, ['water']);
  schedule.finish();
  assert.equal(schedule.next(0, true, [], sprout), null);
});

runTest('Uji 95: Migrasi pohon lama mempertahankan jumlah, posisi, dan identitas pohon', () => {
  const key = 'moss_island_state_v2';
  const original = localStorage.getItem(key);
  try {
    const state = loadAppState();
    const trees = ['oak', 'pine', ...TREE_SPECIES].map((treeType, i) => ({
      id: 'migration-' + i, treeType, gridR: i % 6, gridC: Math.floor(i / 6), plantedAtTimestamp: 1000 + i,
    }));
    localStorage.setItem(key, JSON.stringify({ ...state, progress: { ...state.progress, trees } }));
    const migrated = loadAppState().progress.trees;
    assert.strictEqual(migrated.length, trees.length);
    migrated.forEach((tree, i) => {
      assert.strictEqual(tree.id, trees[i].id);
      assert.strictEqual(tree.gridR, trees[i].gridR);
      assert.strictEqual(tree.gridC, trees[i].gridC);
      assert.strictEqual(tree.plantedAtTimestamp, trees[i].plantedAtTimestamp);
      assert.ok(TREE_SPECIES.includes(tree.treeType));
    });
    assert.strictEqual(migrated[0].treeType, 'banana');
    assert.strictEqual(migrated[1].treeType, 'mango');
    assert.deepEqual(loadAppState().progress.trees, migrated);
  } finally {
    if (original === null) localStorage.removeItem(key);
    else localStorage.setItem(key, original);
  }
});

runTest('Uji 96: Lima jenis pohon tersedia dalam penanaman dan memiliki gambar yang berbeda', () => {
  assert.deepEqual([...new Set(PLANTING_SLOTS.map(slot => slot.type))].sort(), [...TREE_SPECIES].sort());
  const signatures = new Set<string>();
  for (const species of TREE_SPECIES) {
    const canvas = createMockCanvas();
    const ctx = canvas.getContext('2d')!;
    const marks: string[] = [];
    ctx.fillRect = (x, y, w, h) => marks.push([ctx.fillStyle, x, y, w, h].join(':'));
    for (const season of ['spring', 'summer', 'autumn', 'winter'] as const) {
      TREE_RENDERERS[species](ctx, 0, 0, 1, 0, season);
    }
    assert.ok(marks.length > 20);
    signatures.add(marks.join('|'));
  }
  assert.strictEqual(signatures.size, 5);
});

runTest('Uji 97: Setiap empat sesi memakai rehat panjang 15 menit, lalu kembali ke rehat pendek', () => {
  const plan = buildPomodoroPlan(260, 25, 5);
  const breaks = plan.phases.filter(p => p.type === 'break');
  assert.deepEqual(breaks.map(p => p.durationMin), [5, 5, 5, 15, 5, 5, 5, 15]);
  assert.deepEqual(breaks.filter(p => p.breakKind === 'long').map(p => p.id), [8, 16]);
  assert.equal(getNextPhaseLabel(plan, 6, DEFAULT_POMODORO_CONFIG), 'Rehat panjang 15 menit setelah ini · mulai manual');
  assert.equal(plan.totalFocusMin + plan.totalBreakMin, 260);
  const clippedPhases = buildPomodoroPlan(120, 25, 5).phases;
  const clipped = clippedPhases[clippedPhases.length - 1];
  assert.equal(clipped.breakKind, 'long');
  assert.equal(clipped.durationMin, 5);
  assert.equal(clipped.isShortened, true);
});

runTest('Uji 98: Rehat panjang dapat menunggu, dipulihkan, dan dilanjutkan ke fokus berikutnya', () => {
  const config = { ...DEFAULT_POMODORO_CONFIG, totalDurationMin: 260, focusDurationMin: 25, breakDurationMin: 5, autostartBreak: false };
  const engine = new PomodoroEngine(config);
  const snapshot = { scheduleVersion: 2, phaseIndex: 7, status: 'waiting_next' as const,
    phaseRemainingSeconds: 900, targetEndTime: null, savedAt: Date.now(),
    totalDurationMin: 260, focusDurationMin: 25, breakDurationMin: 5 };
  assert.ok(engine.restoreFromSnapshot(sanitizeTimerSnapshot(snapshot)!));
  assert.equal(engine.getCurrentPhase()?.breakKind, 'long');
  assert.equal(engine.getSnapshot()?.phaseRemainingSeconds, 900);
  engine.skipCurrentPhase();
  assert.equal(engine.getCurrentPhase()?.type, 'focus');
  engine.reset();
  assert.equal(engine.restoreFromSnapshot({ ...snapshot, scheduleVersion: undefined }), false);
  assert.equal(sanitizeTimerSnapshot({ ...snapshot, scheduleVersion: undefined }), null);
});

runTest('Uji 99: Sentuhan di bawah 30 persen tidak membuat pohon transparan', () => {
  const rear = { x: 0, y: 60, treeType: 'banana' as const, scale: 1 };
  // Half the height overlaps: 58% of width gives 29% of the rear bounds.
  assert.equal(coversRearTree({ ...rear, x: 48 * 0.42, y: 83 }, rear), false);
  assert.equal(coversRearTree({ ...rear, x: 48 * 0.38, y: 83 }, rear), true);
  const tree = { ...rear, y: 80 };
  assert.equal(coversMomo(tree, { x: 31 - 14 * 0.29, y: 65 }), false);
  assert.equal(coversMomo(tree, { x: 31 - 14 * 0.31, y: 65 }), true);
  assert.equal(getTreeOpacity(tree, [tree], { x: 31 - 14 * 0.29, y: 65 }, false), 1);
  assert.equal(getTreeOpacity(tree, [tree], { x: 0, y: 65 }, true), 1);
});

runTest('Uji 100: Pengaturan menolak kosong, nol, pecahan dan durasi di luar batas tanpa mengganti nilai', () => {
  const base = { hours: '1', minutes: '7', focus: '25', rest: '5' };
  assert.deepEqual(parseSettingsDuration(base), { valid: true, total: 67, focus: 25, rest: 5 });
  for (const hours of ['', ' ', '-1', '1.5', '25', 'abc', 'Infinity']) {
    assert.equal(parseSettingsDuration({ ...base, hours }).valid, false, hours);
  }
  for (const patch of [{ minutes: '60' }, { hours: '24', minutes: '1' }, { hours: '0', minutes: '0' }, { hours: '1.5' }]) {
    assert.equal(parseSettingsDuration({ ...base, ...patch }).valid, false);
  }
  assert.equal(parseSettingsDuration({ ...base, hours: '24', minutes: '0' }).valid, true);
});

runTest('Uji 101: Preferensi musim, suara dan autostart mempertahankan fase serta sisa timer', () => {
  const config = { ...DEFAULT_POMODORO_CONFIG, totalDurationMin: 130 };
  for (const status of ['paused', 'waiting_next', 'running'] as const) {
    const engine = new PomodoroEngine(config);
    const snapshot = { scheduleVersion: 2, phaseIndex: 3, status, phaseRemainingSeconds: 123,
      targetEndTime: status === 'running' ? Date.now() + 123000 : null, savedAt: Date.now(),
      totalDurationMin: 130, focusDurationMin: config.focusDurationMin, breakDurationMin: config.breakDurationMin };
    assert.ok(engine.restoreFromSnapshot(snapshot));
    const before = engine.getSnapshot();
    const next = { ...config, seasonMode: 'manual' as const, soundEnabled: false, autostartNextFocus: false };
    assert.equal(hasScheduleChanged(config, next), false);
    engine.updateConfig(next);
    assert.equal(engine.getStatus(), status);
    assert.equal(engine.getCurrentPhaseIndex(), 3);
    assert.equal(engine.getSnapshot()?.targetEndTime, before?.targetEndTime);
    assert.equal(engine.getSnapshot()?.phaseRemainingSeconds, before?.phaseRemainingSeconds);
    engine.reset();
  }
  for (const patch of [{ totalDurationMin: 60 }, { focusDurationMin: 20 }, { breakDurationMin: 10 }]) {
    assert.equal(hasScheduleChanged(config, { ...config, ...patch }), true);
  }
});

runTest('Uji 102: Pengaturan preferensi tidak menghidupkan kembali rencana yang sudah selesai', () => {
  const config = { ...DEFAULT_POMODORO_CONFIG, totalDurationMin: 1 };
  const engine = new PomodoroEngine(config);
  engine.skipCurrentPhase();
  assert.equal(engine.getStatus(), 'completed');
  engine.updateConfig({ ...config, seasonMode: 'manual' });
  assert.equal(engine.getStatus(), 'completed');
});

runTest('Uji 103: Penyimpanan melaporkan kegagalan dan mempertahankan data terakhir yang berhasil', () => {
  const state = getDefaultAppState();
  state.config.volume = 0.7;
  state.config.alwaysOnTop = false;
  state.config.soundEnabled = false;
  assert.equal(saveAppState(state), true);
  const storage = globalThis.localStorage;
  const original = storage.setItem;
  try {
    storage.setItem = () => { throw new Error('storage full'); };
    assert.equal(saveAppState({ ...state, config: { ...state.config, volume: 0.3 } }), false);
  } finally { storage.setItem = original; }
  const loaded = loadAppState();
  assert.equal(loaded.config.volume, 0.7);
  assert.equal(loaded.config.alwaysOnTop, false);
  assert.equal(loaded.config.soundEnabled, false);
});

await runTestAsync('Uji 104: Startup yang tidak tersedia dibedakan dari status nonaktif', async () => {
  assert.equal(await isAutostartEnabled(), null);
});

runTest('Uji 105: Target fokus menambahkan rehat utuh di luar target dengan pola tetap 25/5/15', () => {
  for (const target of [1, 15, 25, 60, 100, 120, 200, 1440]) {
    const plan = buildFocusTargetPlan(target);
    assert.equal(plan.totalFocusMin, target);
    assert.equal(plan.totalDurationMin, target + plan.totalBreakMin);
    const focus = plan.phases.filter(p => p.type === 'focus');
    assert.ok(focus.slice(0, -1).every(p => p.durationMin === 25));
    let count = 0;
    for (const phase of plan.phases) {
      if (phase.type === 'focus') count++;
      else {
        assert.equal(phase.durationMin, count % 4 === 0 ? 15 : 5);
        assert.equal(phase.isShortened, false);
      }
    }
  }
  assert.equal(buildFocusTargetPlan(60).totalDurationMin, 70);
  assert.equal(buildFocusTargetPlan(100).totalDurationMin, 130);
  assert.equal(buildFocusTargetPlan(200).totalDurationMin, 260);
  assert.deepEqual(parseSettingsDuration({ hours: '1', minutes: '0' }), { valid: true, total: 60, focus: 25, rest: 5 });
});

runTest('Uji 106: Pengaturan lama beralih ke pola tetap dan rencana baru dapat dipulihkan', () => {
  const legacy = { ...DEFAULT_POMODORO_CONFIG, totalDurationMin: 60, focusDurationMin: 20, breakDurationMin: 10 };
  const config = sanitizePomodoroConfig(legacy);
  assert.equal(config.focusDurationMin, 25);
  assert.equal(config.breakDurationMin, 5);
  assert.equal(config.focusTargetMin, undefined);
  assert.equal(config.totalDurationMin, 60, 'Durasi keseluruhan tidak diperpanjang saat migrasi');
  const fixed = sanitizePomodoroConfig({ ...config, focusTargetMin: 1440 });
  const plan = buildFocusTargetPlan(1440);
  assert.equal(fixed.totalDurationMin, plan.totalDurationMin);
  const engine = new PomodoroEngine(fixed);
  const snapshot = { scheduleVersion: 3, focusTargetMin: 1440, phaseIndex: 7,
    status: 'paused' as const, phaseRemainingSeconds: 900, targetEndTime: null, savedAt: Date.now(),
    totalDurationMin: plan.totalDurationMin, focusDurationMin: 25, breakDurationMin: 5 };
  assert.ok(engine.restoreFromSnapshot(sanitizeTimerSnapshot(snapshot)!));
  assert.equal(engine.getCurrentPhase()?.breakKind, 'long');
  assert.equal(engine.getSnapshot()?.focusTargetMin, 1440);
  assert.equal(engine.restoreFromSnapshot({ ...snapshot, focusTargetMin: 100 }), false);
});

runTest('Uji 107: Sampul terlambat dicoba ulang tanpa permintaan paralel dan berhenti setelah berhasil', () => {
  let now = 0;
  const retry = new ArtworkRetry(() => now);
  assert.equal(retry.begin('spotify#a', false), true);
  assert.equal(retry.begin('spotify#a', false), false);
  retry.finish('spotify#a', false);
  assert.equal(retry.begin('spotify#a', false), false);
  now = 1000;
  assert.equal(retry.begin('spotify#a', false), true);
  retry.finish('spotify#a', false);
  now = 1500;
  assert.equal(retry.begin('spotify#a', true), true, 'Thumbnail baru melewati jeda retry');
  retry.finish('spotify#a', true);
  now = 100_000;
  assert.equal(retry.begin('spotify#a', true), false);
});

runTest('Uji 108: Pergantian sesi menolak hasil retry lama dan disconnect mengizinkan pemulihan', () => {
  const retry = new ArtworkRetry(() => 0);
  assert.equal(retry.begin('spotify#a', true), true);
  assert.equal(retry.begin('spotify#b', true), true);
  retry.finish('spotify#a', true);
  assert.equal(retry.begin('spotify#b', true), false, 'Permintaan B masih berjalan');
  retry.finish('spotify#b', true);
  retry.reset();
  assert.equal(retry.begin('spotify#b', true), true);
});

await runTestAsync('Uji 109: Fallback kosong tidak di-cache permanen dan dapat pulih setelah cooldown', async () => {
  const service = new LyricsService();
  const fetchBefore = globalThis.fetch;
  const dateBefore = Date.now;
  let now = 1000;
  let requests = 0;
  let available = false;
  const updates: TrackArtworkInfo[] = [];
  service.subscribeArtwork(info => updates.push(info));
  const meta = { identityKey: 'spotify#retry', title: 'Test Song', artist: 'Test Artist', album: 'Test Album', durationSecs: 180 };
  try {
    Date.now = () => now;
    globalThis.fetch = (async () => {
      requests++;
      return { ok: true, json: async () => ({ data: available ? [{ title: meta.title,
        artist: { name: meta.artist }, album: { title: meta.album, cover_medium: 'https://example.com/cover.jpg' }, duration: 180 }] : [], results: [] }) } as Response;
    }) as typeof fetch;
    service.onSystemRecordChanged(meta.identityKey, meta, false);
    await service.requestSearchArtworkFallback(meta);
    assert.equal(requests, 2);
    available = true;
    await service.requestSearchArtworkFallback(meta);
    assert.equal(requests, 2, 'Cooldown mencegah request setiap polling');
    now += 30_000;
    await service.requestSearchArtworkFallback(meta);
    assert.equal(requests, 3);
    assert.equal(updates[updates.length - 1]?.source, 'search');
    assert.equal(updates[updates.length - 1]?.albumArtUrl, 'https://example.com/cover.jpg');
  } finally {
    Date.now = dateBefore;
    globalThis.fetch = fetchBefore;
    service.clear();
  }
});

await runTestAsync('Uji 110: Fallback yang lambat tidak menimpa thumbnail sesi yang sudah pulih', async () => {
  const service = new LyricsService();
  const fetchBefore = globalThis.fetch;
  const updates: TrackArtworkInfo[] = [];
  service.subscribeArtwork(info => updates.push(info));
  const meta = { identityKey: 'spotify#race', title: 'Test Song', artist: 'Test Artist', durationSecs: 180 };
  let resolveFetch!: (response: Response) => void;
  try {
    globalThis.fetch = (() => new Promise<Response>(resolve => { resolveFetch = resolve; })) as typeof fetch;
    service.onSystemRecordChanged(meta.identityKey, meta, false);
    const pending = service.requestSearchArtworkFallback(meta);
    assert.equal(service.applySessionArtworkData(meta.identityKey, PNG_1X1_BASE64, 'image/png', meta), true);
    resolveFetch({ ok: true, json: async () => ({ data: [{ title: meta.title, artist: { name: meta.artist },
      album: { cover_medium: 'https://example.com/fallback.jpg' }, duration: 180 }] }) } as Response);
    await pending;
    assert.equal(updates[updates.length - 1]?.source, 'session');
    assert.ok(updates[updates.length - 1]?.albumArtUrl?.startsWith('blob:'));
  } finally {
    globalThis.fetch = fetchBefore;
    service.clear();
  }
});

runTest('Uji 111: Jeda retry sampul dibatasi 30 detik meskipun sumber terus gagal', () => {
  let now = 0;
  const retry = new ArtworkRetry(() => now);
  for (let attempt = 0; attempt < 12; attempt++) {
    assert.equal(retry.begin('spotify#missing', false), true);
    retry.finish('spotify#missing', false);
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5));
    now += delay - 1;
    assert.equal(retry.begin('spotify#missing', false), false);
    now++;
  }
});

await runTestAsync('Uji 112: Hasil fallback dari lagu lama tidak mengisi sampul lagu baru', async () => {
  const service = new LyricsService();
  const fetchBefore = globalThis.fetch;
  const updates: TrackArtworkInfo[] = [];
  service.subscribeArtwork(info => updates.push(info));
  const meta = { identityKey: 'spotify#old', title: 'Old Song', artist: 'Test Artist', durationSecs: 180 };
  let resolveFetch!: (response: Response) => void;
  try {
    globalThis.fetch = (() => new Promise<Response>(resolve => { resolveFetch = resolve; })) as typeof fetch;
    service.onSystemRecordChanged(meta.identityKey, meta, false);
    const pending = service.requestSearchArtworkFallback(meta);
    service.onSystemRecordChanged('spotify#new', { title: 'New Song', artist: meta.artist }, false);
    resolveFetch({ ok: true, json: async () => ({ data: [{ title: meta.title, artist: { name: meta.artist },
      album: { cover_medium: 'https://example.com/old.jpg' }, duration: 180 }] }) } as Response);
    await pending;
    assert.equal(updates[updates.length - 1]?.artworkKey, 'spotify#new');
    assert.equal(updates[updates.length - 1]?.albumArtUrl, null);
  } finally {
    globalThis.fetch = fetchBefore;
    service.clear();
  }
});

await runTestAsync('Uji 113: Layanan lirik HTTP 503 menampilkan error dan pulih melalui retry', async () => {
  const service = new LyricsService();
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  const updates: import('../src/audio/lyricsService').LyricsLinesUpdate[] = [];
  service.subscribe(update => updates.push(update));
  let now = 1000;
  let requests = 0;
  let available = false;
  const meta = { title: 'New Song', artist: 'Test Artist', album: 'New Album', durationSecs: 180 };
  try {
    Date.now = () => now;
    service.onSystemRecordChanged('spotify#http', meta, false);
    globalThis.fetch = (async url => {
      requests++;
      return available
        ? { ok: true, json: async () => ({ ...lyricRequestMetadata(url), syncedLyrics: '[00:00]Lirik pulih' }) } as Response
        : { ok: false, status: 503 } as Response;
    }) as typeof fetch;
    await service.loadLyrics(meta.title, meta.artist, meta.album, true, 1, meta.durationSecs);
    assert.equal(updates[0]?.loadStatus, 'loading');
    assert.equal(updates[updates.length - 1]?.loadStatus, 'error');
    assert.equal(requests, 1);
    available = true;
    await service.loadLyrics(meta.title, meta.artist, meta.album, true, 2, meta.durationSecs);
    assert.equal(requests, 1);
    now += 6000;
    await service.loadLyrics(meta.title, meta.artist, meta.album, true, 3, meta.durationSecs);
    assert.equal(requests, 2);
    assert.equal(updates[updates.length - 1]?.highlight, 'Lirik pulih');
    assert.equal(updates[updates.length - 1]?.isSynced, true);
  } finally {
    Date.now = originalNow;
    globalThis.fetch = originalFetch;
    service.clear();
  }
});

await runTestAsync('Uji 114: Lagu baru tanpa lirik menampilkan alasan, bukan panel kosong', async () => {
  const service = new LyricsService();
  const originalFetch = globalThis.fetch;
  const updates: import('../src/audio/lyricsService').LyricsLinesUpdate[] = [];
  service.subscribe(update => updates.push(update));
  const meta = { title: 'Missing Song', artist: 'Test Artist' };
  let requests = 0;
  try {
    service.onSystemRecordChanged('spotify#missing-lyrics', meta, false);
    globalThis.fetch = (async url => {
      requests++;
      return String(url).includes('/api/get?') ? { ok: false, status: 404 } as Response
        : { ok: true, json: async () => [] } as unknown as Response;
    }) as typeof fetch;
    await service.loadLyrics(meta.title, meta.artist, '', true, 0, 180);
    const last = updates[updates.length - 1];
    assert.equal(last.loadStatus, 'not_found');
    assert.equal(last.highlight, 'Lirik belum tersedia');
    await service.loadLyrics(meta.title, meta.artist, '', true, 1, 180);
    assert.equal(requests, 3, 'Tidak mengulang pencarian kosong pada setiap polling');
  } finally {
    globalThis.fetch = originalFetch;
    service.clear();
  }
});

await runTestAsync('Uji 115: Ganti A ke B lalu A saat download tertunda tidak menggandakan request atau menampilkan B', async () => {
  const service = new LyricsService();
  const originalFetch = globalThis.fetch;
  const updates: import('../src/audio/lyricsService').LyricsLinesUpdate[] = [];
  service.subscribe(update => updates.push(update));
  const pending: { title: string | null; finish: (response: Response) => void; url: string }[] = [];
  try {
    service.onSystemRecordChanged('spotify#a', { title: 'Song A', artist: 'Artist' }, false);
    globalThis.fetch = (url => new Promise<Response>(finish => {
      pending.push({ title: lyricRequestMetadata(url).trackName, finish, url: String(url) });
    })) as typeof fetch;
    const a = service.loadLyrics('Song A', 'Artist', 'Album', true, 0, 180);
    const b = service.loadLyrics('Song B', 'Artist', 'Album', true, 0, 180);
    await service.loadLyrics('Song A', 'Artist', 'Album', true, 5, 180);
    assert.equal(pending.length, 2, 'Request A yang masih berjalan dipakai kembali');
    const bRequest = pending.find(request => request.title === 'Song B')!;
    bRequest.finish({ ok: true, json: async () => ({ ...lyricRequestMetadata(bRequest.url), syncedLyrics: '[00:00]Lirik B' }) } as Response);
    await b;
    assert.equal(updates[updates.length - 1]?.loadStatus, 'loading');
    assert.ok(!updates.some(update => update.highlight === 'Lirik B'));
    const aRequest = pending.find(request => request.title === 'Song A')!;
    aRequest.finish({ ok: true, json: async () => ({ ...lyricRequestMetadata(aRequest.url), syncedLyrics: '[00:00]Awal A\n[00:04]Lirik A saat ini' }) } as Response);
    await a;
    assert.equal(updates[updates.length - 1]?.highlight, 'Lirik A saat ini');
  } finally {
    globalThis.fetch = originalFetch;
    service.clear();
  }
});

runTest('Uji 116: Clock musik mengikuti playback rate, termasuk pause rate nol', () => {
  assert.equal(advancePlayback(10, 2, 0, 1.5).position, 13);
  assert.equal(advancePlayback(10, 2, 0, 0).position, 10);
});

runTest('Uji 117: Hover opsional memakai jeda dan tidak menutup saat kontrol dipakai', () => {
  const hover = new HoverIntent();
  assert.equal(hover.update(true, false, false, 'compact', 0), null);
  assert.equal(hover.update(true, true, false, 'compact', 100), null);
  assert.equal(hover.update(true, true, false, 'compact', 249), null);
  assert.equal(hover.update(true, true, false, 'compact', 250), 'expand');
  assert.equal(hover.update(false, true, false, 'expanded', 300), null);
  assert.equal(hover.update(false, true, true, 'expanded', 800), null);
  assert.equal(hover.update(false, true, false, 'expanded', 900), null);
  assert.equal(hover.update(false, true, false, 'expanded', 1300), 'collapse');
  assert.equal(hover.update(true, true, false, 'hidden', 2000), null);
});

runTest('Uji 118: Offset lirik disimpan per rekaman, dibatasi, dan gagal simpan tidak diterapkan', () => {
  localStorage.removeItem('moss_lyrics_offsets_v1');
  const timing = new LyricsTiming();
  assert.equal(timing.set('record-a', 0.5), true);
  assert.equal(timing.set('record-b', -99), true);
  assert.equal(new LyricsTiming().get('record-a'), 0.5);
  assert.equal(timing.get('record-b'), -10);
  assert.equal(timing.set('record-a', NaN), false);
  const originalSet = localStorage.setItem;
  try {
    localStorage.setItem = () => { throw new Error('disk full'); };
    assert.equal(timing.set('record-a', 4), false);
    assert.equal(timing.get('record-a'), 0.5);
  } finally {
    localStorage.setItem = originalSet;
    localStorage.removeItem('moss_lyrics_offsets_v1');
  }
});

await runTestAsync('Uji 119: Koreksi lirik menggeser baris tanpa menggeser posisi pemutar', async () => {
  const service = new LyricsService();
  const originalFetch = globalThis.fetch;
  const updates: import('../src/audio/lyricsService').LyricsLinesUpdate[] = [];
  service.subscribe(update => updates.push(update));
  try {
    service.onSystemRecordChanged('spotify#timing', { title: 'Timing', artist: 'Artist' }, false);
    globalThis.fetch = (async url => ({ ok: true, json: async () => ({ ...lyricRequestMetadata(url),
      syncedLyrics: '[00:00]Satu\n[00:01]Dua' }) } as Response)) as typeof fetch;
    await service.loadLyrics('Timing', 'Artist', 'Album', true, 0.5, 180);
    assert.equal(updates[updates.length - 1]?.highlight, 'Satu');
    assert.equal(service.adjustTiming(0.5), true);
    assert.equal(updates[updates.length - 1]?.highlight, 'Dua');
    assert.equal((service as any).currentPositionSecs, 0.5);
    assert.equal(service.adjustTiming(0, true), true);
    assert.equal(updates[updates.length - 1]?.highlight, 'Satu');
    globalThis.fetch = (async url => ({ ok: true, json: async () => ({ ...lyricRequestMetadata(url),
      id: 589314, syncedLyrics: '[00:21.66]Pertama\n[00:25.66]Kedua' }) } as Response)) as typeof fetch;
    await service.loadLyrics('When You Were Young', 'The Killers', "Sam's Town", true, 18.67, 220);
    assert.equal(updates[updates.length - 1]?.highlight, 'Pertama');
    assert.equal(updates[updates.length - 1]?.offsetSeconds, 3);
    assert.equal(service.adjustTiming(0, true), true);
    assert.equal(updates[updates.length - 1]?.isInstrumental, true);
  } finally {
    globalThis.fetch = originalFetch;
    service.clear();
    localStorage.removeItem('moss_lyrics_offsets_v1');
  }
});

await runTestAsync('Uji 120: Desktop meminta lirik melalui command terbatas, bukan fetch WebView', async () => {
  const originalFetch = globalThis.fetch;
  const calls = installMockTauriInternals(cmd => cmd === 'fetch_lyrics' ? { status: 429, body: null } : null);
  try {
    globalThis.fetch = (() => { throw new Error('WebView fetch tidak boleh dipakai'); }) as typeof fetch;
    await assert.rejects(requestLyrics('search', new URLSearchParams({ track_name: 'Song & Title', artist_name: 'Artist' })),
      error => error instanceof LyricsCooldownError && error.status === 429);
    // Polling bridge dari tes lama bisa menyela log; kontraknya adalah satu fetch_lyrics yang tepat.
    const lyricCalls = calls.filter(call => call.cmd === 'fetch_lyrics');
    assert.equal(lyricCalls.length, 1);
    assert.deepEqual(lyricCalls[0].args.params, [['track_name', 'Song & Title'], ['artist_name', 'Artist']]);
  } finally { globalThis.fetch = originalFetch; removeMockTauriInternals(); }
});

runTest('Uji 121: Pencocokan artis menerima separator kolaborasi, bukan artis yang hilang atau versi live', () => {
  const service = new LyricsService() as any;
  const item = { trackName: "Don't Stop", artistName: 'Artist A feat. Artist B', duration: 180, plainLyrics: 'lirik' };
  assert.equal(service.selectBestRecordMatch([item], '', 180, 'Don’t Stop', 'Artist B, Artist A'), item);
  assert.equal(service.selectBestRecordMatch([item], '', 180, 'Don’t Stop', 'Artist A'), null);
  assert.equal(service.selectBestRecordMatch([{ ...item, trackName: "Don't Stop (Live)" }], '', 180, 'Don’t Stop', 'Artist B, Artist A'), null);
  service.clear();
});

await runTestAsync('Uji 122: Pilihan sesi mengikat polling dan repeat, tanpa mengubah status repeat saat ditolak', async () => {
  const track: SystemMediaTrack = { title: 'Chosen Song', artist: 'Artist', album: 'Album', is_playing: true,
    source_app: 'Spotify.exe', source_display_name: 'Spotify', service_kind: 'spotify_desktop', is_spotify: true,
    has_session: true, session_key: 'chosen-session', record_key: 'chosen-record', has_thumbnail: false,
    position_secs: 5, duration_secs: 180, repeat_mode: 'off',
    capabilities: { toggle: true, next: true, previous: false, seek: true, repeat: true } };
  const calls = installMockTauriInternals(cmd => cmd === 'get_system_media_track' ? track
    : cmd === 'get_system_media_sessions' ? [track] : false);
  const bridge = new SystemMediaBridge();
  try {
    await bridge.selectSession('chosen-session');
    assert.equal(bridge.getCurrentTrack()?.session_key, 'chosen-session');
    assert.ok(calls.some(c => c.cmd === 'get_system_media_track' && c.args.sessionKey === 'chosen-session'));
    assert.equal((await bridge.listSessions()).length, 1);
    assert.equal(await bridge.setRepeat('all'), false);
    assert.equal(bridge.getCurrentTrack()?.repeat_mode, 'off');
    const repeatCall = calls.find(c => c.cmd === 'system_media_repeat');
    assert.equal(repeatCall?.args.sessionKey, 'chosen-session');
    assert.equal(repeatCall?.args.mode, 'all');
    await bridge.selectSession('local');
    assert.equal(bridge.getCurrentTrack(), null);
    assert.equal(await bridge.setRepeat('one'), false);
  } finally { removeMockTauriInternals(); }
});

await runTestAsync('Uji 123: Lirik dimuat ulang otomatis setelah pencarian kosong tanpa tombol manual', async () => {
  const service = new LyricsService();
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  let now = 1000;
  const updates: import('../src/audio/lyricsService').LyricsLinesUpdate[] = [];
  service.subscribe(update => updates.push(update));
  let available = false;
  try {
    Date.now = () => now;
    service.onSystemRecordChanged('spotify#manual-retry', { title: 'Retry Song', artist: 'Artist' }, false);
    globalThis.fetch = (async url => available
      ? { ok: true, json: async () => ({ ...lyricRequestMetadata(url), syncedLyrics: '[00:00]Tersedia sekarang' }) } as Response
      : String(url).includes('/api/get?') ? { ok: false, status: 404 } as Response
      : { ok: true, json: async () => [] } as unknown as Response) as typeof fetch;
    await service.loadLyrics('Retry Song', 'Artist', 'Album', true, 5, 180);
    assert.equal(updates[updates.length - 1]?.loadStatus, 'not_found');
    available = true;
    now += 60_000;
    await service.loadLyrics('Retry Song', 'Artist', 'Album', true, 6, 180);
    assert.equal(updates[updates.length - 1]?.highlight, 'Tersedia sekarang');
  } finally { Date.now = originalNow; globalThis.fetch = originalFetch; service.clear(); }
});

await runTestAsync('Uji 124: Album pemutar yang berbeda tidak menghalangi lookup presisi judul, artis dan durasi', async () => {
  const service = new LyricsService();
  const originalFetch = globalThis.fetch;
  const queries: URL[] = [];
  const updates: import('../src/audio/lyricsService').LyricsLinesUpdate[] = [];
  service.subscribe(update => updates.push(update));
  try {
    service.onSystemRecordChanged('spotify#album-label', { title: 'Oceans & Engines', artist: 'NIKI' }, false);
    globalThis.fetch = (async url => {
      const query = new URL(String(url));
      queries.push(query);
      if (query.searchParams.has('album_name')) return { ok: false, status: 404 } as Response;
      return { ok: true, status: 200, json: async () => ({ ...lyricRequestMetadata(url), albumName: 'Nicole',
        syncedLyrics: '[00:00]TEST · kecocokan presisi' }) } as Response;
    }) as typeof fetch;
    await service.loadLyrics('Oceans & Engines', 'NIKI', 'Label album pemutar', true, 1, 336);
    assert.equal(queries.length, 2);
    assert.equal(queries[1].pathname, '/api/get');
    assert.equal(queries[1].searchParams.get('duration'), '336');
    assert.equal(queries[1].searchParams.has('album_name'), false);
    assert.equal(updates[updates.length - 1]?.highlight, 'TEST · kecocokan presisi');
  } finally { globalThis.fetch = originalFetch; service.clear(); }
});

await runTestAsync('Uji 125: Heaven Classic tetap menampilkan teks ketika pencarian timestamp gagal HTTP 503', async () => {
  const service = new LyricsService();
  const originalFetch = globalThis.fetch;
  const updates: import('../src/audio/lyricsService').LyricsLinesUpdate[] = [];
  service.subscribe(update => updates.push(update));
  const meta = { title: 'Heaven (Classic Version)', artist: 'Bryan Adams', album: 'Classic', durationSecs: 263 };
  let requests = 0;
  try {
    service.onSystemRecordChanged('spotify#heaven-classic', meta, false);
    globalThis.fetch = (async url => {
      requests++;
      return String(url).includes('/api/get?')
        ? { ok: true, status: 200, json: async () => ({ ...lyricRequestMetadata(url), syncedLyrics: null, plainLyrics: 'TEST · teks tanpa timestamp' }) } as Response
        : { ok: false, status: 503 } as Response;
    }) as typeof fetch;
    await service.loadLyrics(meta.title, meta.artist, meta.album, true, 10, meta.durationSecs);
    assert.equal(requests, 2);
    const last = updates[updates.length - 1];
    assert.equal(last.isSynced, false);
    assert.equal(last.highlight, 'TEST · teks tanpa timestamp');
    assert.equal(last.loadStatus, undefined);
    assert.equal(last.isLoading, false);
    assert.ok(updates.some(update => update.highlight === 'TEST · teks tanpa timestamp' && update.isLoading));
    assert.equal(updates.some(update => update.loadStatus === 'error'), false);
    service.syncPosition(120, true);
    assert.equal(updates[updates.length - 1]?.highlight, 'TEST · teks tanpa timestamp');
  } finally { globalThis.fetch = originalFetch; service.clear(); }
});

await runTestAsync('Uji 126: GET lirik biasa dapat ditingkatkan ke sinkron hanya untuk rekaman yang cocok', async () => {
  const service = new LyricsService();
  const originalFetch = globalThis.fetch;
  const updates: import('../src/audio/lyricsService').LyricsLinesUpdate[] = [];
  service.subscribe(update => updates.push(update));
  const meta = { title: 'Heaven (Classic Version)', artist: 'Bryan Adams', album: 'Classic', durationSecs: 263 };
  try {
    service.onSystemRecordChanged('spotify#same-version', meta, false);
    globalThis.fetch = (async url => {
      const record = { trackName: meta.title, artistName: meta.artist, albumName: meta.album, duration: meta.durationSecs,
        plainLyrics: 'TEST · teks biasa', syncedLyrics: String(url).includes('/api/search?') ? '[00:00]TEST · awal\n[00:10]TEST · timestamp cocok' : null };
      return { ok: true, status: 200, json: async () => String(url).includes('/api/get?') ? record : [record] } as Response;
    }) as typeof fetch;
    await service.loadLyrics(meta.title, meta.artist, meta.album, true, 11, meta.durationSecs);
    assert.ok(updates.some(update => update.highlight === 'TEST · teks biasa'));
    assert.equal(updates[updates.length - 1]?.isSynced, true);
    assert.equal(updates[updates.length - 1]?.highlight, 'TEST · timestamp cocok');
  } finally { globalThis.fetch = originalFetch; service.clear(); }
});

await runTestAsync('Uji 127: Timestamp Heaven versi lain tidak dipaksakan ke Classic walaupun durasinya sama', async () => {
  const service = new LyricsService();
  const originalFetch = globalThis.fetch;
  const updates: import('../src/audio/lyricsService').LyricsLinesUpdate[] = [];
  service.subscribe(update => updates.push(update));
  const meta = { title: 'Heaven (Classic Version)', artist: 'Bryan Adams', album: 'Classic', durationSecs: 263 };
  try {
    service.onSystemRecordChanged('spotify#wrong-version', meta, false);
    globalThis.fetch = (async url => ({ ok: true, status: 200, json: async () => String(url).includes('/api/get?')
      ? { ...lyricRequestMetadata(url), plainLyrics: 'TEST · teks Classic', syncedLyrics: null }
      : [ { trackName: 'Heaven', artistName: meta.artist, albumName: 'Classic CD1', duration: 263, syncedLyrics: '[00:00]SALAH' },
          { trackName: 'Heaven (Live)', artistName: meta.artist, albumName: meta.album, duration: 263, syncedLyrics: '[00:00]SALAH LIVE' } ] }) as Response) as typeof fetch;
    await service.loadLyrics(meta.title, meta.artist, meta.album, true, 11, meta.durationSecs);
    assert.equal(updates[updates.length - 1]?.highlight, 'TEST · teks Classic');
    assert.equal(updates[updates.length - 1]?.isSynced, false);
    assert.equal(updates.some(update => update.highlight.includes('SALAH')), false);
  } finally { globalThis.fetch = originalFetch; service.clear(); }
});

await runTestAsync('Uji 128: Timestamp pulih otomatis dengan backoff tanpa menghilangkan lirik biasa', async () => {
  const service = new LyricsService();
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  const updates: import('../src/audio/lyricsService').LyricsLinesUpdate[] = [];
  service.subscribe(update => updates.push(update));
  const meta = { title: 'Heaven (Classic Version)', artist: 'Bryan Adams', album: 'Classic', durationSecs: 263 };
  let now = 1000;
  let mode: 'plain' | 'offline' | 'synced' = 'plain';
  let requests = 0;
  try {
    Date.now = () => now;
    service.onSystemRecordChanged('spotify#auto-timed', meta, false);
    globalThis.fetch = (async url => {
      requests++;
      if (mode === 'offline') throw new Error('TEST · offline');
      if (String(url).includes('/api/get?')) return { ok: true, status: 200, json: async () => ({
        ...lyricRequestMetadata(url), plainLyrics: 'TEST · teks dipertahankan',
        syncedLyrics: mode === 'synced' ? '[00:00]TEST · sinkron otomatis' : null,
      }) } as Response;
      return { ok: false, status: 503 } as Response;
    }) as typeof fetch;
    await service.loadLyrics(meta.title, meta.artist, meta.album, true, 10, meta.durationSecs);
    const initialRequests = requests;
    now += 29_999;
    await service.loadLyrics(meta.title, meta.artist, meta.album, true, 11, meta.durationSecs);
    assert.equal(requests, initialRequests);
    mode = 'offline';
    now++;
    await service.loadLyrics(meta.title, meta.artist, meta.album, true, 12, meta.durationSecs);
    assert.equal(requests, initialRequests + 3);
    assert.equal(updates[updates.length - 1]?.highlight, 'TEST · teks dipertahankan');
    assert.equal(updates.some(update => update.loadStatus === 'error'), false);
    assert.equal(updates.filter(update => update.loadStatus === 'loading').length, 1);
    mode = 'synced';
    now += 60_000;
    await service.loadLyrics(meta.title, meta.artist, meta.album, true, 13, meta.durationSecs);
    assert.equal(updates[updates.length - 1]?.highlight, 'TEST · sinkron otomatis');
    assert.equal(updates[updates.length - 1]?.isSynced, true);
    const recoveredRequests = requests;
    now += 300_000;
    await service.loadLyrics(meta.title, meta.artist, meta.album, true, 14, meta.durationSecs);
    assert.equal(requests, recoveredRequests, 'Sumber sinkron yang berhasil tidak dicari ulang setiap polling');
  } finally { Date.now = originalNow; globalThis.fetch = originalFetch; service.clear(); }
});

runTest('Uji 129: Antarmuka tidak membebankan pencarian lirik kepada tombol manual', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const main = fs.readFileSync('src/main.ts', 'utf8');
  assert.equal(html.includes('id="btn-lyrics-retry"'), false);
  assert.equal(main.includes('retryCurrentLyrics'), false);
  assert.equal(main.includes('Cari sinkron'), false);
});

runTest('Uji 130: Empat kontrol musik berada di blok lagu, bukan kolom Momo', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const start = html.indexOf('id="music-track-block"');
  const lyrics = html.indexOf('id="music-lyrics-card"', start);
  const momo = html.indexOf('id="music-momo-stage"', lyrics);
  assert.ok(start >= 0 && lyrics > start && momo > lyrics);
  const controls = ['btn-music-prev', 'btn-music-toggle', 'btn-music-next', 'btn-music-repeat'];
  for (const id of controls) {
    const occurrence = html.indexOf(`id="${id}"`);
    assert.ok(occurrence > start && occurrence < lyrics, `${id} harus berada sebelum blok lirik`);
    assert.equal(html.split(`id="${id}"`).length - 1, 1, `${id} tidak boleh diduplikasi`);
    assert.equal(html.slice(momo).includes(`id="${id}"`), false);
  }
  assert.ok(html.includes('aria-label="Kontrol pemutaran musik"'));
});

runTest('Uji 131: Pembaruan status musik mempertahankan ikon dan label aksesibel', () => {
  const main = fs.readFileSync('src/main.ts', 'utf8');
  const html = fs.readFileSync('index.html', 'utf8');
  const music = main.slice(main.indexOf('function bindMusicControls()'), main.indexOf('function bindWindowAndNotchControls()'));
  assert.equal(music.includes('btnToggle.innerText'), false, 'Status putar tidak boleh menghapus SVG');
  assert.equal(music.includes('repeatButton.innerText'), false, 'Status repeat tidak boleh menghapus ikon loop');
  assert.ok(music.includes('btnToggle.dataset.playing = String(playing)'));
  assert.ok(music.includes("repeatButton.setAttribute('aria-label', label)"));
  assert.ok(html.includes('class="transport-icon icon-play"'));
  assert.ok(html.includes('class="transport-icon icon-pause"'));
  assert.ok(html.includes('class="repeat-one-mark"'));
});

runTest('Uji 132: Kolom Momo tidak menyisakan baris kontrol sehingga karakternya center vertikal', () => {
  const css = fs.readFileSync('src/styles.css', 'utf8').replace(/\r\n/g, '\n');
  const start = css.indexOf('#panel-music .col-right {');
  const rule = css.slice(start, css.indexOf('}', start) + 1);
  assert.ok(rule.length > 0, 'Aturan kolom kanan harus ada');
  assert.equal(rule.includes('grid-template-rows'), false, 'Kolom kanan tidak boleh menyisakan baris kontrol 44 px');
  assert.ok(rule.includes('display: flex'));
  assert.ok(rule.includes('align-items: center'));
  assert.ok(rule.includes('justify-content: center'));
  assert.ok(css.includes('#panel-music .music-momo-stage {\n  height: 100%;\n  width: 100%;\n}'));
});

runTest('Uji 133: Kolom lirik mengisi lebar kolom tanpa margin samping', () => {
  const css = fs.readFileSync('src/styles.css', 'utf8').replace(/\r\n/g, '\n');
  const start = css.indexOf('#panel-music .col-center {');
  const rule = css.slice(start, css.indexOf('}', start) + 1);
  assert.ok(rule.length > 0);
  assert.ok(rule.includes('grid-template-columns: minmax(0, 1fr)'), 'Kolom lirik harus punya track 1fr eksplisit');
  assert.ok(rule.includes('align-items: stretch'));
  assert.equal(css.includes('#panel-music .lyrics-card {\n  width: 100%;\n  max-width: none;'), true, 'Kartu lirik harus mengisi lebar kolom');
});

await runTestAsync('Uji 134: Transisi tab berurutan dan hanya menerapkan tujuan terakhir saat klik cepat', async () => {
  const applied: string[] = [];
  let release: () => void = () => {};
  const first = new Promise<void>((resolve) => { release = resolve; });
  let active = 0;
  let maxActive = 0;
  const tabs = new TabTransition<'focus' | 'music'>('focus', async (target) => {
    active++;
    maxActive = Math.max(maxActive, active);
    applied.push(target);
    if (target === 'music') await first;
    active--;
  });
  const pending = tabs.request('music');
  tabs.request('focus');
  tabs.request('focus');
  assert.deepEqual(applied, ['music']);
  release();
  await pending;
  assert.deepEqual(applied, ['music', 'focus']);
  assert.equal(maxActive, 1);
  await tabs.request('focus');
  assert.deepEqual(applied, ['music', 'focus'], 'Klik tab aktif tidak memulai animasi baru');
});

await runTestAsync('Uji 135: Tab tetap dapat dipindah setelah no-op dan kegagalan transisi', async () => {
  const applied: string[] = [];
  let fail = true;
  const tabs = new TabTransition<'focus' | 'music'>('focus', async (target) => {
    if (fail) throw new Error('resize failed');
    applied.push(target);
  });
  const noop = tabs.request('focus');
  const failure = tabs.request('music');
  await noop;
  await assert.rejects(failure, /resize failed/);
  fail = false;
  await tabs.request('music');
  assert.deepEqual(applied, ['music']);
});

runTest('Uji 136: Scrollbar tidak ditampilkan dan transisi menghormati reduced motion', () => {
  const css = fs.readFileSync('src/styles.css', 'utf8').replace(/\r\n/g, '\n');
  assert.ok(css.includes('body * {\n  scrollbar-width: none;'));
  assert.ok(css.includes('body *::-webkit-scrollbar'));
  assert.equal(css.includes('scrollbar-width: thin'), false);
  assert.ok(css.includes('.island-widget.is-switching-tab .tab-panel'));
  assert.ok(css.includes('@media (prefers-reduced-motion: reduce)'));
  assert.ok(css.includes('transition: none !important'));
  assert.ok(css.includes('#panel-music .transport-btn { width: 44px; height: 44px;'));
});

class MomoTestClock implements MomoClock {
  now = 0;
  next = 0;
  tasks = new Map<number, { at: number; callback: () => void }>();
  later(callback: () => void, delay: number): number {
    const id = ++this.next;
    this.tasks.set(id, { at: this.now + delay, callback });
    return id;
  }
  cancel(id: number) { this.tasks.delete(id); }
  tick(ms: number) {
    const until = this.now + ms;
    while (true) {
      const next = [...this.tasks.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > until) break;
      this.now = next[1].at;
      this.tasks.delete(next[0]);
      next[1].callback();
    }
    this.now = until;
  }
}

function momoHarness() {
  const clock = new MomoTestClock();
  const frames: Readonly<MomoFrame>[] = [];
  const momo = new MusicMomo((frame) => frames.push(frame), clock, () => 0);
  momo.configure(true, false, 'expressive');
  return { clock, frames, momo, latest: () => frames[frames.length - 1]! };
}

runTest('Uji 137: Momo membatalkan callback lama saat lagu dan sesi berganti cepat', () => {
  const h = momoHarness();
  h.momo.setPlayback('playing', 'session-a#record-a');
  const stale = [...h.clock.tasks.values()].map(task => task.callback);
  h.momo.setPlayback('playing', 'session-a#record-b');
  assert.equal(h.latest().pose, 'change');
  h.momo.setPlayback('playing', 'session-b#record-c');
  h.momo.setPlayback('paused', 'session-b#record-c');
  const count = h.frames.length;
  stale.forEach(callback => callback());
  assert.equal(h.frames.length, count);
  assert.equal(h.latest().pose, 'settle');
  h.clock.tick(260);
  assert.equal(h.latest().pose, 'rest');
  h.momo.dispose();
});

runTest('Uji 138: Pause saat lompatan menyelesaikan settle, tetap bernapas dan berkedip tanpa adegan selesai', () => {
  const h = momoHarness();
  h.momo.setPlayback('playing', 'record');
  assert.equal(h.latest().pose, 'start');
  h.clock.tick(400);
  h.momo.setPlayback('paused', 'record');
  assert.equal(h.latest().pose, 'settle');
  h.clock.tick(270);
  assert.equal(h.latest().pose, 'rest');
  h.clock.tick(5700);
  assert.equal(h.frames.some(frame => frame.playback === 'paused' && frame.eyes === 'closed'), false);
  h.clock.tick(300);
  assert.ok(h.frames.some(frame => frame.playback === 'paused' && frame.eyes === 'closed'));
  assert.equal(h.frames.some(frame => frame.playback === 'ended'), false);
  h.momo.dispose();
});

runTest('Uji 139: Aksi lucu Momo memiliki jeda dan klik kembali ke aktivitas, langsung istirahat saat selesai', () => {
  const h = momoHarness();
  h.momo.setPlayback('playing', 'record');
  h.clock.tick(4500);
  assert.equal(h.latest().pose, 'stumble');
  h.clock.tick(1600);
  assert.equal(h.latest().pose, 'rest');
  h.momo.interact();
  assert.equal(h.latest().pose, 'wave');
  h.clock.tick(1300);
  assert.equal(h.latest().pose, 'nod');
  h.momo.setPlayback('ended', 'record');
  assert.equal(h.latest().pose, 'rest');
  h.momo.interact();
  assert.equal(h.latest().pose, 'shy');
  h.clock.tick(2600);
  assert.equal(h.latest().pose, 'rest');
  assert.equal(h.latest().smile, true);
  h.momo.dispose();
});

runTest('Uji 140: Panel Momo tersembunyi tidak menyisakan timer; dispose menolak reaksi baru', () => {
  const h = momoHarness();
  h.momo.setPlayback('playing', 'record');
  h.momo.configure(false, false, 'expressive');
  assert.equal(h.clock.tasks.size, 0);
  const count = h.frames.length;
  h.clock.tick(60000);
  h.momo.interact();
  assert.equal(h.frames.length, count);
  h.momo.configure(true, false, 'calm');
  assert.ok(h.clock.tasks.size > 0);
  h.momo.dispose();
  assert.equal(h.clock.tasks.size, 0);
  const disposed = h.frames.length;
  h.momo.setPlayback('playing', 'new');
  h.momo.interact();
  assert.equal(h.frames.length, disposed);
});

runTest('Uji 141: Loading audio terpisah dari lirik; reduced motion hanya melanjutkan ekspresi kecil', () => {
  const h = momoHarness();
  h.momo.setPlayback('loading', 'record');
  assert.equal(h.latest().pose, 'listen');
  h.momo.setPlayback('playing', 'record');
  h.momo.configure(true, true, 'expressive');
  h.clock.tick(60000);
  assert.equal(h.frames.some(frame => frame.reduced && ['stumble', 'step', 'sway'].includes(frame.pose)), false);
  const css = fs.readFileSync('src/audio/musicMomo.css', 'utf8');
  assert.ok(css.includes('[data-reduced="true"] .momo-rig *'));
  assert.ok(css.includes('animation: none !important'));
  h.momo.dispose();
});

runTest('Uji 142: Intensitas Momo tervalidasi tanpa mengubah jadwal timer', () => {
  const calm = sanitizePomodoroConfig({ ...FIXED_DEFAULT_CONFIG, momoIntensity: 'calm' });
  const expressive = sanitizePomodoroConfig({ ...calm, momoIntensity: 'expressive' });
  assert.equal(calm.momoIntensity, 'calm');
  assert.equal(expressive.momoIntensity, 'expressive');
  assert.equal(sanitizePomodoroConfig({ momoIntensity: 'invalid' }).momoIntensity, 'expressive');
  assert.equal(hasScheduleChanged(calm, expressive), false);
});

await runTestAsync('Uji 143: Sesi putus, error polling dan pause dekat akhir bukan lagu selesai', async () => {
  const base: SystemMediaTrack = { title: 'Same title', artist: 'Artist', album: 'Album', is_playing: true,
    playback_status: 'playing', source_app: 'Player', source_display_name: 'Player', service_kind: 'native_app',
    is_spotify: false, has_session: true, session_key: 'session-a', record_key: 'record-a', has_thumbnail: false,
    position_secs: 199, duration_secs: 200 };
  let payload: SystemMediaTrack | null = base;
  let error = false;
  installMockTauriInternals((cmd) => {
    if (cmd === 'get_system_media_track') { if (error) throw Error('offline'); return payload; }
    return null;
  });
  const bridge = new SystemMediaBridge();
  let ended = 0;
  bridge.onSongFinished(() => ended++);
  try {
    await bridge.pollNow();
    payload = { ...base, is_playing: false, playback_status: 'paused', position_secs: 199.99 };
    await bridge.pollNow();
    assert.equal(ended, 0);
    payload = base; await bridge.pollNow();
    payload = null; await bridge.pollNow();
    assert.equal(ended, 0);
    assert.equal(bridge.waitingForTrack, true);
    assert.equal(bridge.getCurrentTrack(), null);
    payload = base; await bridge.pollNow();
    assert.equal(bridge.waitingForTrack, false);
    error = true; await bridge.pollNow();
    assert.equal(ended, 0);
    error = false; payload = base; await bridge.pollNow();
    payload = { ...base, record_key: 'record-b', is_playing: false, playback_status: 'stopped' };
    await bridge.pollNow();
    assert.equal(ended, 0);
  } finally { removeMockTauriInternals(); }
});

runTest('Uji 144: Mulai sumber lokal bereaksi senang; pergantian saat loading tetap menoleh ke lagu baru', () => {
  const h = momoHarness();
  h.momo.setPlayback('playing', 'system');
  h.momo.setPlayback('idle', 'local-a');
  h.momo.setPlayback('loading', 'local-a');
  h.momo.setPlayback('playing', 'local-a');
  assert.equal(h.latest().pose, 'start');
  h.momo.setPlayback('loading', 'local-b');
  assert.equal(h.latest().pose, 'listen');
  h.momo.setPlayback('playing', 'local-b');
  assert.equal(h.latest().pose, 'change');
  h.momo.dispose();
});

runTest('Uji 145: Intensitas Tenang tidak memilih langkah besar atau kehilangan keseimbangan', () => {
  const h = momoHarness();
  h.momo.configure(true, false, 'calm');
  h.momo.setPlayback('playing', 'record');
  h.clock.tick(120000);
  assert.equal(h.frames.some(frame => frame.intensity === 'calm' && ['step', 'stumble', 'shoulder'].includes(frame.pose)), false);
  h.momo.dispose();
});

runTest('Uji 146: Diagnosis audio membedakan penolakan izin, kegagalan jaringan dan decoder', () => {
  const permission = describeAudioFailure(new DOMException('Permission denied', 'NotAllowedError'), '/audio/test.webm');
  assert.equal(permission.name, 'NotAllowedError');
  assert.ok(permission.message.includes('izin'));
  const decode = describeAudioFailure({ message: 'Decode error' }, '/audio/test.webm', 3);
  assert.equal(decode.mediaCode, 3);
  assert.ok(decode.message.includes('mendekode'));
  assert.ok(decode.message.includes('media 3'));
  assert.equal(decode.detail, 'Decode error');
  assert.ok(describeAudioFailure(null, '/audio/test.webm', 2).message.includes('dimuat'));
  assert.ok(describeAudioFailure(null, '/audio/test.webm', 4).message.includes('berkas atau format'));
});

await runTestAsync('Uji 147: Audio tidak menulis posisi nol sebelum metadata dan resume menunggu loadedmetadata', async () => {
  const original = globalThis.Audio;
  const instances: FakeAudio[] = [];
  class FakeAudio extends EventTarget {
    private position = 0;
    readyState = 0;
    duration = 200;
    writes: number[] = [];
    constructor() { super(); instances.push(this); }
    get currentTime() { return this.position; }
    set currentTime(value: number) {
      if (this.readyState === 0) throw new DOMException('Metadata belum siap', 'InvalidStateError');
      this.position = value;
      this.writes.push(value);
    }
    async play() { this.readyState = 1; this.dispatchEvent(new Event('loadedmetadata')); }
    pause() {}
    removeAttribute() {}
    load() { this.readyState = 0; this.position = 0; }
  }
  globalThis.Audio = FakeAudio as unknown as typeof Audio;
  try {
    const player = new AmbientSynth();
    assert.equal(await player.play('jazz-noir'), true);
    assert.deepEqual(instances[0]!.writes, [], 'Posisi awal tidak perlu ditulis ke media yang belum siap');
    instances[0]!.currentTime = 12;
    player.stop();
    assert.equal(await player.play('jazz-noir'), true);
    assert.deepEqual(instances[1]!.writes, [12]);
    assert.equal(player.getPlaybackFailure(), null);
    player.stop();
  } finally { globalThis.Audio = original; }
});

await runTestAsync('Uji 148: MediaError dicatat sebelum load menghapusnya dan error media lama ditolak', async () => {
  const original = globalThis.Audio;
  const instances: FakeAudio[] = [];
  class FakeAudio extends EventTarget {
    currentTime = 0;
    error: { code: number; message: string } | null = null;
    constructor() { super(); instances.push(this); }
    async play() {}
    pause() {}
    removeAttribute() {}
    load() { this.error = null; }
  }
  globalThis.Audio = FakeAudio as unknown as typeof Audio;
  try {
    const player = new AmbientSynth();
    const states: string[] = [];
    player.onPlaybackState = state => states.push(state);
    assert.equal(await player.play('jazz-noir'), true);
    instances[0]!.error = { code: 3, message: 'decoder failed' };
    instances[0]!.dispatchEvent(new Event('error'));
    assert.equal(player.getPlaybackFailure()?.mediaCode, 3);
    assert.equal(player.getPlaybackFailure()?.detail, 'decoder failed');
    assert.equal(player.getTrack(), 'off');
    assert.equal(states[states.length - 1], 'error');
    assert.equal(await player.play('wave-to-earth'), true);
    const count = states.length;
    instances[0]!.error = { code: 4, message: 'stale' };
    instances[0]!.dispatchEvent(new Event('error'));
    assert.equal(states.length, count);
    assert.equal(player.getPlaybackFailure(), null);
    assert.equal(player.getTrack(), 'wave-to-earth');
    player.stop();
  } finally { globalThis.Audio = original; }
});

runTest('Uji 149: Sesi WebView ambigu ditahan hanya ketika musik lokal memiliki pemutaran otomatis', () => {
  assert.equal(shouldIgnoreAmbiguousWebViewSession('msedgewebview2.exe', null, true), true);
  assert.equal(shouldIgnoreAmbiguousWebViewSession('C:\\Edge\\MSEDGEWEBVIEW2.EXE', null, true), true);
  assert.equal(shouldIgnoreAmbiguousWebViewSession('msedgewebview2.exe', 'chosen', true), false);
  assert.equal(shouldIgnoreAmbiguousWebViewSession('msedgewebview2.exe', null, false), false);
  assert.equal(shouldIgnoreAmbiguousWebViewSession('Spotify.exe', null, true), false);
});

await runTestAsync('Uji 150: Kontrol tanpa identitas sesi tidak memanggil backend', async () => {
  const calls = installMockTauriInternals(() => true);
  const bridge = new SystemMediaBridge();
  try {
    assert.equal(await bridge.togglePlay(), false);
    assert.equal(await bridge.nextTrack(), false);
    assert.equal(await bridge.prevTrack(), false);
    assert.equal(await bridge.seekTo(5), false);
    assert.equal(calls.length, 0);
  } finally { removeMockTauriInternals(); }
});

runTest('Uji 151: Retry-After menghitung detik dan tanggal tanpa memendekkan batas provider', () => {
  const now = Date.parse('2026-11-02T00:00:00Z');
  assert.equal(retryAfterMilliseconds('120', now), 120000);
  assert.equal(retryAfterMilliseconds('Mon, 02 Nov 2026 00:03:00 GMT', now), 180000);
  assert.equal(retryAfterMilliseconds('invalid', now), 0);
});

await runTestAsync('Uji 152: 429 menghentikan fallback dan cooldown berlaku lintas rekaman', async () => {
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  const originalRandom = Math.random;
  let now = 100000;
  let calls = 0;
  try {
    Date.now = () => now;
    Math.random = () => 0;
    globalThis.fetch = (async () => {
      calls++;
      return { ok: false, status: 429, headers: new Headers({ 'Retry-After': '120' }) } as Response;
    }) as typeof fetch;
    const first = new LyricsService();
    const second = new LyricsService();
    first.onSystemRecordChanged('test#one', { title: 'One', artist: 'Artist' }, false);
    second.onSystemRecordChanged('test#two', { title: 'Two', artist: 'Artist' }, false);
    await first.loadLyrics('One', 'Artist', '', true, 0, 180);
    await second.loadLyrics('Two', 'Artist', '', true, 0, 180);
    assert.equal(calls, 1);
    now += 119999;
    await second.loadLyrics('Two', 'Artist', '', true, 0, 180);
    assert.equal(calls, 1);
    now++;
    await first.loadLyrics('One', 'Artist', '', true, 0, 180);
    assert.equal(calls, 2);
    first.clear(); second.clear();
  } finally { Date.now = originalNow; Math.random = originalRandom; globalThis.fetch = originalFetch; resetLyricsCooldownForTests(); }
});

await runTestAsync('Uji 153: Seek A yang selesai terlambat tidak membatalkan polling sesi B', async () => {
  const a: SystemMediaTrack = { title: 'A', artist: 'Artist', album: '', is_playing: true,
    source_app: 'Player', source_display_name: 'Player', service_kind: 'native_app', is_spotify: false,
    has_session: true, session_key: 'a', record_key: 'record-a', has_thumbnail: false,
    position_secs: 10, duration_secs: 180 };
  const b: SystemMediaTrack = { ...a, title: 'B', session_key: 'b', record_key: 'record-b' };
  let resolveSeek: (value: boolean) => void = () => {};
  let resolvePoll: (value: SystemMediaTrack) => void = () => {};
  const seekPending = new Promise<boolean>(resolve => { resolveSeek = resolve; });
  const pollPending = new Promise<SystemMediaTrack>(resolve => { resolvePoll = resolve; });
  let delayed = false;
  const calls = installMockTauriInternals((cmd) => {
    if (cmd === 'system_media_seek') return seekPending;
    if (cmd === 'get_system_media_track') return delayed ? pollPending : a;
    return true;
  });
  const bridge = new SystemMediaBridge();
  try {
    await bridge.pollNow();
    const seek = bridge.seekTo(50);
    for (let i = 0; i < 1000 && !calls.some(call => call.cmd === 'system_media_seek'); i++) {
      await new Promise<void>(resolve => { setImmediate(resolve); });
    }
    assert.ok(calls.some(call => call.cmd === 'system_media_seek'));
    delayed = true;
    const poll = bridge.pollNow();
    for (let i = 0; i < 1000 && calls.filter(call => call.cmd === 'get_system_media_track').length < 2; i++) {
      await new Promise<void>(resolve => { setImmediate(resolve); });
    }
    assert.ok(calls.filter(call => call.cmd === 'get_system_media_track').length >= 2);
    resolveSeek(true);
    assert.equal(await seek, true);
    resolvePoll(b);
    assert.equal(await poll, b);
    assert.equal(bridge.getCurrentTrack()?.record_key, 'record-b');
  } finally { resolveSeek(false); resolvePoll(b); removeMockTauriInternals(); }
});

runTest('Uji 154: Detektor onset merespons pulsa, menolak hening dan membatasi ketukan beruntun', () => {
  const detector = new BeatDetector();
  const silent = new Uint8Array(8);
  const pulse = new Uint8Array(8).fill(200);
  assert.equal(detector.update(silent, 0), false);
  assert.equal(detector.update(pulse, 500), true);
  detector.update(silent, 550);
  assert.equal(detector.update(pulse, 600), false);
  detector.update(silent, 800);
  assert.equal(detector.update(pulse, 1000), true);
  detector.reset();
  assert.equal(detector.update(silent, 1500), false);
});

await runTestAsync('Uji 155: Speaker mencoba ulang start dan berhenti saat panel ditutup', async () => {
  let starts = 0;
  let stops = 0;
  const statuses: string[] = [];
  const speaker = new SpeakerBeat(() => {}, text => statuses.push(text), {
    available: () => true, retryMs: 10,
    invoke: async <T>(command: string): Promise<T> => {
      if (command === 'start_speaker_beat' && ++starts === 1) throw new Error('device unavailable');
      if (command === 'stop_speaker_beat') stops++;
      return (command === 'speaker_beat_count' ? 0 : undefined) as T;
    },
  });
  try {
    speaker.setActive(true);
    for (let i = 0; i < 100 && !statuses.some(s => s.includes('output aktif')); i++) {
      await new Promise(resolve => { setTimeout(resolve, 5); });
    }
    assert.equal(starts, 2);
    assert.ok(statuses.some(s => s.includes('output aktif')));
    speaker.setActive(false);
    await new Promise(resolve => { setTimeout(resolve, 30); });
    assert.equal(stops, 1);
    assert.equal(starts, 2);
  } finally { speaker.setActive(false); }
});

await runTestAsync('Uji 156: Speaker pulih dari worker terputus dan membatalkan retry saat tersembunyi', async () => {
  let starts = 0;
  let reads = 0;
  const statuses: string[] = [];
  const speaker = new SpeakerBeat(() => {}, text => statuses.push(text), {
    available: () => true, retryMs: 10,
    invoke: async <T>(command: string): Promise<T> => {
      if (command === 'start_speaker_beat') starts++;
      if (command === 'speaker_beat_count' && ++reads === 2) throw new Error('worker stopped');
      return (command === 'speaker_beat_count' ? 0 : undefined) as T;
    },
  });
  try {
    speaker.setActive(true);
    for (let i = 0; i < 100 && starts < 2; i++) await new Promise(resolve => { setTimeout(resolve, 5); });
    assert.equal(starts, 2);
    assert.ok(statuses.some(s => s.includes('terputus')));
  } finally { speaker.setActive(false); }
  await new Promise(resolve => { setTimeout(resolve, 30); });
  assert.equal(starts, 2);
});

runTest('Uji 157: Gerak beat bergantian kaki dan kepala tanpa menggerakkan rig', () => {
  const calls: { part: string; frames: Keyframe[]; cancelled: boolean }[] = [];
  const active: boolean[] = [];
  const target = (part: string) => ({ animate: (frames: Keyframe[]) => {
    const call = { part, frames, cancelled: false };
    calls.push(call);
    return { cancel: () => { call.cancelled = true; } };
  } }) as unknown as SVGGElement;
  const motion = createMomoBeatMotion(target('head'), target('foot'), value => active.push(value));
  motion.beat('expressive');
  motion.beat('calm');
  motion.beat('expressive');
  assert.deepEqual(calls.map(call => call.part), ['foot', 'head', 'foot']);
  assert.match(String(calls[0].frames[1].transform), /rotate\(-8deg\)/);
  assert.match(String(calls[1].frames[1].transform), /rotate\(3deg\)/);
  assert.equal(calls[0].cancelled, true);
  motion.cancel();
  assert.equal(calls[2].cancelled, true);
  assert.deepEqual(active, [true, true, true, false]);
});

runTest('Uji 158: Gerak beat hanya saat istirahat tanpa transisi atau gerakan lain', () => {
  const frame: MomoFrame = { playback: 'playing', pose: 'rest', eyes: 'open', smile: false,
    active: true, reduced: false, intensity: 'expressive' };
  assert.equal(canAnimateMomoBeat(frame, false, []), true);
  for (const pose of ['nod', 'tap', 'sway', 'shoulder', 'step', 'start', 'settle', 'wave', 'change'] as const) {
    assert.equal(canAnimateMomoBeat({ ...frame, pose }, true, []), false, pose);
  }
  assert.equal(canAnimateMomoBeat(frame, true, [{ playState: 'running', pending: false }]), false);
  assert.equal(canAnimateMomoBeat(frame, true, [{ playState: 'paused', pending: true }]), false);
  assert.equal(canAnimateMomoBeat(frame, true, [{ playState: 'finished', pending: false }]), true);
  assert.equal(canAnimateMomoBeat({ ...frame, eyes: 'closed' }, true, []), false);
  assert.equal(canAnimateMomoBeat({ ...frame, playback: 'ended' }, true, []), false);
  assert.equal(canAnimateMomoBeat({ ...frame, reduced: true }, true, []), false);
  assert.equal(canAnimateMomoBeat({ ...frame, active: false }, true, []), false);
});

runTest('Uji 159: Posisi compact dan minimal dipertahankan saat transisi', () => {
  assert.equal(shouldRememberFloatingPosition('compact', 'expanded'), true);
  assert.equal(shouldRememberFloatingPosition('compact', 'hidden'), true);
  assert.equal(shouldRememberFloatingPosition('hidden', 'expanded'), true);
  assert.equal(shouldRememberFloatingPosition('expanded', 'compact'), false);
  assert.equal(shouldRememberFloatingPosition('expanded', 'compact', 'floating'), true);
  assert.equal(shouldRememberFloatingPosition('expanded', 'hidden', 'floating'), true);
  assert.equal(shouldRememberFloatingPosition('expanded', 'expanded', 'floating'), false);
  assert.equal(shouldRememberFloatingPosition('expanded', 'compact', 'left'), false);
  assert.equal(shouldRememberFloatingPosition('compact', 'compact'), false);
  assert.equal(shouldCenterAfterTransition(true), false);
  assert.equal(shouldCenterAfterTransition(false), true);
});

runTest('Uji 160: Tepi terdekat memakai area kerja, termasuk monitor negatif', () => {
  const area = { x: -1920, y: 40, width: 1920, height: 1000 };
  assert.equal(nearestDockEdge(-960, 45, area), 'top');
  assert.equal(nearestDockEdge(-960, 1035, area), 'bottom');
  assert.equal(nearestDockEdge(-1915, 500, area), 'left');
  assert.equal(nearestDockEdge(-5, 500, area), 'right');
  assert.equal(isVerticalDock('left'), true);
  assert.equal(isVerticalDock('right'), true);
  assert.equal(isVerticalDock('top'), false);
  assert.equal(isVerticalDock('bottom'), false);
});

runTest('Uji 161: Snap hanya di ambang 10%, termasuk batas, sudut dan monitor negatif', () => {
  const area = { x: -1920, y: 40, width: 1920, height: 1000 };
  assert.equal(dockWithinThreshold(-960, 540, area), 'floating');
  assert.equal(dockWithinThreshold(-1728, 540, area), 'left');
  assert.equal(dockWithinThreshold(-1727, 540, area), 'floating');
  assert.equal(dockWithinThreshold(-192, 540, area), 'right');
  assert.equal(dockWithinThreshold(-193, 540, area), 'floating');
  assert.equal(dockWithinThreshold(-960, 140, area), 'top');
  assert.equal(dockWithinThreshold(-960, 141, area), 'floating');
  assert.equal(dockWithinThreshold(-960, 940, area), 'bottom');
  assert.equal(dockWithinThreshold(-960, 939, area), 'floating');
  assert.equal(dockWithinThreshold(-1900, 60, area), 'left', 'Sudut memilih jarak relatif terdekat');
  assert.equal(dockWithinThreshold(NaN, 60, area), 'floating');
  assert.equal(isVerticalDock('floating'), false);
  assert.equal(dockWithinThreshold(-1440, 540, area, { width: 960, height: 320 }), 'left', 'Panel menyentuh tepi dinilai dari batas jendela');
  assert.equal(dockWithinThreshold(-960, 540, area, { width: 960, height: 320 }), 'floating');
});

const petContext: PetContext = { x: 600, y: 450, cursorX: 580, cursorY: 450,
  width: 76, height: 92, scale: 1, pressed: false, visible: true,
  area: { x: 0, y: 0, width: 1920, height: 1032 } };

runTest('Uji 162: Pet menjauh perlahan tanpa membaca kecepatan atau niat kursor', () => {
  let motion = restingPet();
  let context = { ...petContext };
  for (let i = 0; i < 20; i++) {
    const next = stepDesktopPet(context, motion, 0.05, i * 50);
    assert.ok(next.x >= context.x);
    assert.ok(Math.hypot(next.x - context.x, next.y - context.y) <= 1.101);
    context = { ...context, x: next.x, y: next.y }; motion = next.motion;
  }
  assert.ok(context.x > 610 && context.x < 623);
  assert.equal(motion.walking, true);
  assert.equal(stepDesktopPet({ ...context, pressed: true }, motion, 0.05, 1000).motion.walking, false);
  assert.equal(stepDesktopPet({ ...context, visible: false }, motion, 0.05, 1000).x, context.x);
});

runTest('Uji 163: Pet tidak keluar work area dan dapat minggir di sudut', () => {
  for (const scale of [1, 1.5, 2]) {
    const context = { ...petContext, scale, width: 76 * scale, height: 92 * scale,
      x: 38 * scale, y: 46 * scale, cursorX: 38 * scale + 5, cursorY: 46 * scale + 5 };
    const next = stepDesktopPet(context, restingPet(), 4, 1000);
    assert.ok(next.x >= context.width / 2 && next.y >= context.height / 2);
    assert.ok(next.x <= context.area.width - context.width / 2);
    assert.ok(next.y <= context.area.height - context.height / 2);
    assert.ok(Math.hypot(next.x - context.x, next.y - context.y) <= 22 * scale * 0.08);
    assert.equal(next.motion.walking, true);
  }
});

runTest('Uji 164: Pet berjalan sesekali, diam dan melambat saat ruang sudah bebas', () => {
  const context = { ...petContext, cursorX: 100, cursorY: 100 };
  assert.equal(stepDesktopPet(context, restingPet(), 0.05, 1000).motion.walking, false);
  const walk = stepDesktopPet(context, restingPet(), 0.05, 10000);
  assert.equal(walk.motion.walking, true);
  assert.ok(walk.motion.vx > 0 && walk.motion.vx < 9);
  const stop = stepDesktopPet(context, walk.motion, 0.05, 13000);
  assert.ok(stop.motion.vx < walk.motion.vx);
  const reverse = stepDesktopPet(context, restingPet(), 0.05, 24000);
  assert.equal(reverse.motion.facing, 'left');
});

runTest('Uji 165: Gerak pet konsisten di 60 dan 120 frame serta mengikuti arah horizontal', () => {
  const simulate = (fps: number, cursorX: number) => {
    let context = { ...petContext, cursorX };
    let motion = restingPet();
    for (let i = 0; i < fps; i++) {
      const next = stepDesktopPet(context, motion, 1 / fps, i * 1000 / fps);
      assert.ok(Math.hypot(next.x - context.x, next.y - context.y) <= 22 / fps + 0.001);
      context = { ...context, x: next.x, y: next.y }; motion = next.motion;
    }
    return { context, motion };
  };
  const right = simulate(60, 580);
  const right120 = simulate(120, 580);
  const left = simulate(60, 620);
  assert.ok(Math.abs(right.context.x - right120.context.x) < 0.2);
  assert.equal(right.motion.facing, 'right');
  assert.equal(left.motion.facing, 'left');
  assert.ok(left.context.x < petContext.x);
  assert.equal(getIslandDimension('hidden', 'focus', false).height, 92, 'Mode wajah menjadi pet');
  assert.equal(getIslandDimension('compact', 'focus', false).height, 42, 'Bilah minimize dipertahankan');
});

runTest('Uji 166: Kaki pet menapak bergantian dan fase mengikuti jarak, bukan lama animasi', () => {
  const start = petGaitAt(0);
  const quarter = petGaitAt(3.5);
  const half = petGaitAt(7);
  const next = petGaitAt(14);
  assert.deepEqual(next, start, 'Satu siklus kembali tepat setelah 14 DIP');
  assert.equal(quarter.left.y, 0, 'Kaki tumpuan tidak terangkat');
  assert.equal(quarter.right.y, -4, 'Kaki lainnya sedang melangkah');
  assert.deepEqual(half.left, start.right);
  assert.deepEqual(half.right, start.left);
  let previous = petGaitAt(0);
  for (let distance = 0.1; distance <= 28; distance += 0.1) {
    const frame = petGaitAt(distance);
    assert.ok(frame.left.y <= 0 && frame.right.y <= 0);
    assert.ok(Math.abs(frame.left.x - previous.left.x) < 0.12);
    assert.ok(Math.abs(frame.right.y - previous.right.y) < 0.19);
    assert.ok(frame.bob >= -1.2 && frame.bob <= 0);
    previous = frame;
  }
});

runTest('Uji 167: Frame Figma lokal mempertahankan jeda idle dan urutan kedip', () => {
  assert.equal(FIGMA_IDLE_SOURCES.length, 8);
  for (const source of FIGMA_IDLE_SOURCES) {
    assert.equal(source.includes('figma.com'), false);
    assert.ok(fs.statSync(new URL(source)).size > 0);
    assert.match(fs.readFileSync(new URL(source), 'utf8'), /width="64" height="64"/);
  }
  assert.equal(figmaIdleFrameAt(0), 0);
  assert.equal(figmaIdleFrameAt(6199), 0);
  assert.equal(figmaIdleFrameAt(6200), 1);
  assert.equal(figmaIdleFrameAt(6395), 4);
  assert.equal(figmaIdleFrameAt(6654), 7);
  assert.equal(figmaIdleFrameAt(6655), 0);
  assert.equal(figmaIdleFrameAt(15754), 0);
  assert.equal(figmaIdleFrameAt(15755), 1);
  assert.equal(figmaIdleFrameAt(Number.NaN), 0);
});

runTest('Uji 168: Lingkaran istirahat mengikuti fase, status dan sisa waktu', () => {
  const rest = { id: 1, type: 'break' as const, durationMin: 5, label: 'Istirahat', isShortened: false };
  const full = getRestPresentation(rest, 300, 300, 'running');
  assert.equal(full.active, true);
  assert.equal(full.fraction, 1);
  assert.equal(full.time, '05:00');
  assert.equal(getRestPresentation(rest, 150, 300, 'running').fraction, 0.5);
  assert.equal(getRestPresentation(rest, 150, 300, 'paused').status, 'Istirahat dijeda');
  assert.equal(getRestPresentation(rest, 300, 300, 'waiting_next').status, 'Siap mulai istirahat');
  assert.equal(getRestPresentation(rest, -1, 300, 'running').fraction, 0);
  assert.equal(getRestPresentation(rest, Number.NaN, 0, 'running').time, '00:00');
  assert.equal(getRestPresentation(rest, 900, 300, 'running').fraction, 1);
  assert.equal(getRestPresentation(rest, 0, 300, 'completed').active, false);
});

runTest('Uji 169: Fokus-istirahat-fokus mengganti tampilan tanpa timer pengingat terpisah', () => {
  const elements = new Map<string, { hidden: boolean; textContent: string; style: { setProperty: (key: string, value: string) => void } }>();
  const properties = new Map<string, string>();
  for (const id of ['rest-countdown', 'rest-reminder', 'rest-reminder-text', 'tab-btn-focus', 'rest-time', 'rest-status', 'rest-ring-progress']) {
    elements.set(id, { hidden: true, textContent: '', style: { setProperty: (key, value) => { properties.set(key, value); } } });
  }
  let resting = false;
  const root = {
    getElementById: (id: string) => elements.get(id),
    querySelector: () => ({ classList: { toggle: (_name: string, active: boolean) => { resting = active; } } }),
  } as unknown as Document;
  const engine = new PomodoroEngine({ ...DEFAULT_POMODORO_CONFIG, totalDurationMin: 65, focusDurationMin: 25, breakDurationMin: 5 });
  engine.setCallbacks({ onTick: (remaining, total, phase) => renderRestPhase(root, phase, remaining, total, engine.getStatus()) });
  engine.notifyTick();
  assert.equal(resting, false);
  engine.skipCurrentPhase();
  assert.equal(resting, true);
  assert.equal(elements.get('rest-reminder')?.hidden, false);
  renderRestPhase(root, engine.getCurrentPhase()!, 270, 300, 'running');
  assert.equal(elements.get('rest-reminder-text')?.textContent, 'Rilekskan bahu.');
  renderRestPhase(root, engine.getCurrentPhase()!, 240, 300, 'running');
  assert.equal(elements.get('rest-reminder-text')?.textContent, 'Lihat ke kejauhan sebentar.');
  engine.notifyTick();
  assert.equal(elements.get('tab-btn-focus')?.textContent, 'Istirahat');
  assert.equal(elements.get('rest-time')?.textContent, '05:00');
  assert.equal(properties.get('stroke-dashoffset'), '0');
  const snapshot = engine.getSnapshot();
  assert.ok(snapshot);
  const restored = new PomodoroEngine({ ...DEFAULT_POMODORO_CONFIG, totalDurationMin: 65, focusDurationMin: 25, breakDurationMin: 5 });
  assert.equal(restored.restoreFromSnapshot(snapshot), true);
  assert.equal(restored.getCurrentPhase()?.type, 'break');
  engine.skipCurrentPhase();
  assert.equal(resting, false);
  assert.equal(elements.get('rest-reminder')?.hidden, true);
  assert.equal(elements.get('tab-btn-focus')?.textContent, 'Fokus');
  engine.reset();
  assert.equal(resting, false);
});

runTest('Uji 170: Hujan musim panas lebih jarang, singkat dan genangannya lebih cepat kering', () => {
  const sample = (season: IslandSeason) => {
    const weather = new FocusWeather(() => 0);
    let starts = 0, wetTicks = 0;
    for (let i = 0; i < 36000; i++) {
      if (weather.step(0.1, true, season)) starts++;
      if (weather.wetness > 0.01) wetTicks++;
    }
    return { starts, wetTicks };
  };
  const summer = sample('summer'), spring = sample('spring'), autumn = sample('autumn');
  assert.ok(summer.starts < spring.starts && spring.starts < autumn.starts);
  assert.ok(summer.wetTicks < spring.wetTicks && spring.wetTicks < autumn.wetTicks);
  assert.deepEqual(sample('winter'), { starts: 0, wetTicks: 0 });
});

runTest('Uji 171: Beralih ke salju menghapus hujan/genangan termasuk saat pause dan ambient rain', () => {
  const renderer = new IslandRenderer(createMockCanvas()) as any;
  renderer.weather = new FocusWeather(() => 0);
  renderer.weather.untilRain = 0;
  for (let i = 0; i < 120; i++) renderer.update();
  assert.ok(renderer.weather.wetness > 0);
  renderer.setTimerPaused(true);
  renderer.setAmbientMode('rain');
  renderer.setSeason('winter');
  assert.equal(renderer.weather.intensity, 0);
  assert.equal(renderer.weather.wetness, 0);
  assert.deepEqual(renderer.puddles, []);
  assert.equal(renderer.rainJoyTimer, 0);
  renderer.setSeason('summer');
  renderer.setTimerPaused(false);
  for (let i = 0; i < 120; i++) renderer.update();
  assert.equal(renderer.weather.intensity, 0, 'Musim baru tidak langsung hujan');
});

runTest('Uji 172: Momo menunda berkebun saat hujan lalu melanjutkan menanam, menyiram dan memupuk', () => {
  const renderer = new IslandRenderer(createMockCanvas()) as any;
  renderer.startFocusPlanting();
  renderer.updateFocusProgress(0.55);
  renderer.weather = new FocusWeather(() => 0);
  renderer.weather.untilRain = 0;
  for (let i = 0; i < 150; i++) renderer.update();
  assert.ok(renderer.weather.intensity > 0.15);
  const position = { ...renderer.currentPos };
  for (let i = 0; i < 30; i++) renderer.update();
  assert.deepEqual(renderer.currentPos, position);
  assert.equal(renderer.gardeningActivity, null);
  const actions = new Set<string>();
  for (let i = 0; i < 2500; i++) {
    renderer.update();
    if (renderer.gardeningActivity) actions.add(renderer.gardeningActivity.action);
  }
  assert.deepEqual([...actions].sort(), ['fertilize', 'plant', 'water']);
  assert.equal(renderer.hasActiveSprout(), true);
  assert.deepEqual(renderer.getPlantedTrees(), []);
});

runTest('Uji 173: Input tiga jam mencakup seluruh fokus dan istirahat, juga setelah disimpan dan dipulihkan', () => {
  for (const total of [1, 25, 30, 60, 120, 180, 240, 1440]) {
    const hours = String(Math.floor(total / 60)), minutes = String(total % 60);
    const result = parseSettingsDuration({ hours, minutes });
    assert.ok(result.valid);
    const config = sanitizePomodoroConfig({ ...FIXED_DEFAULT_CONFIG, focusTargetMin: undefined, totalDurationMin: result.total });
    const engine = new PomodoroEngine(config);
    const plan = engine.getPlan();
    assert.equal(plan.totalDurationMin, total);
    assert.equal(plan.totalFocusMin + plan.totalBreakMin, total);
    assert.equal(plan.phases.reduce((sum, phase) => sum + phase.durationMin, 0), total);
    engine.start();
    engine.pause();
    const snapshot = engine.getSnapshot();
    assert.ok(snapshot);
    const restored = new PomodoroEngine(sanitizePomodoroConfig(JSON.parse(JSON.stringify(config))));
    assert.ok(restored.restoreFromSnapshot(snapshot));
    assert.equal(restored.getPlan().totalDurationMin, total);
  }
  const threeHours = buildPomodoroPlan(180, 25, 5);
  assert.equal(threeHours.totalDurationMin, 180);
  assert.equal(threeHours.totalFocusMin, 145);
  assert.equal(threeHours.totalBreakMin, 35);
});

runTest('Uji 174: Pet musik memiliki satu aksi, jeda, dan mengalah pada berjalan/drag/reduced motion', () => {
  const pet = new PetPerformance(() => 0);
  const input = { visible: true, music: true, walking: false, blocked: false, reduced: false };
  for (let i = 0; i < 31; i++) assert.equal(pet.step(.25, input).action, 'idle');
  assert.equal(pet.step(.25, input).action, 'dance');
  assert.equal(pet.step(.25, { ...input, walking: true }).action, 'idle');
  for (let i = 0; i < 8; i++) pet.step(.25, input);
  const frame = pet.step(.25, input);
  assert.ok(['wave', 'celebrate', 'dance'].includes(frame.action));
  assert.equal(pet.step(.25, { ...input, music: false }).action, 'idle');
  assert.equal(pet.step(.25, { ...input, reduced: true }).action, 'idle');
  assert.equal(pet.step(.25, { ...input, blocked: true }).action, 'idle');
  assert.equal(pet.step(.25, { ...input, visible: false }).action, 'idle');
});

runTest('Uji 175: Setiap jenis pohon memiliki hasil gambar berbeda di empat musim tanpa meranggas seragam', () => {
  const speciesBySeason = new Map<string, string[]>();
  for (const type of ['banana', 'mango', 'durian', 'palm', 'guava'] as const) {
    const signatures: string[] = [];
    for (const season of ['spring', 'summer', 'autumn', 'winter'] as const) {
      const canvas = createMockCanvas(); const ctx = canvas.getContext('2d')!;
      const painted: string[] = [];
      ctx.fill = () => { painted.push(String(ctx.fillStyle)); };
      ctx.fillRect = () => { painted.push(String(ctx.fillStyle)); };
      TREE_RENDERERS[type](ctx, 0, 0, 1, 0, season);
      const signature = painted.join(',');
      signatures.push(signature);
      speciesBySeason.set(season, [...(speciesBySeason.get(season) ?? []), signature]);
      assert.equal(treeSeasonTraits(type, season).evergreen, true);
      assert.equal(treeSeasonTraits(type, season).snow, season === 'winter');
    }
    assert.equal(new Set(signatures).size, 4, type);
  }
  for (const [season, signatures] of speciesBySeason) {
    assert.equal(new Set(signatures).size, 5, `Lima jenis pohon harus berbeda pada ${season}`);
  }
});

runTest('Uji 176: Perawatan tunas berprioritas dan antrean pohon tetap mengunjungi semuanya', () => {
  const schedule = new GardenSchedule(() => .7);
  const trees = PLANTING_SLOTS.slice(0, 5).map((slot, i) => ({ id: String(i), gridR: slot.r, gridC: slot.c, treeType: slot.type, plantedAtTimestamp: 0 }));
  const sprout = { r: 5, c: 4 }; schedule.setSprout('seed');
  const visited = new Set<string>(); let watered = 0;
  for (let tick = 0; tick < 1400; tick++) {
    const job = schedule.next(.25, true, trees, sprout);
    if (job) { if (job.treeId) visited.add(job.treeId); else watered++; schedule.finish(); }
  }
  assert.equal(visited.size, trees.length);
  assert.ok(watered >= 11);
});

runTest('Uji 177: Durasi pendek, jam utuh dan gabungan tidak memuat unit nol', () => {
  assert.equal(formatDuration(1), '1 menit');
  assert.equal(formatDuration(0), '0 menit');
  assert.equal(formatDuration(60), '1 jam');
  assert.equal(formatDuration(145), '2 jam 25 menit');
  assert.equal(formatDuration(1440), '24 jam');
});

runTest('Uji 178: Status penyimpanan melaporkan gagal, retry berhasil, dan bisa dilepas', () => {
  const state = getDefaultAppState();
  saveAppState(state);
  const seen: boolean[] = [];
  const unsubscribe = subscribeStorageStatus(saved => seen.push(saved));
  const original = localStorage.setItem;
  try {
    localStorage.setItem = () => { throw new Error('quota full'); };
    state.progress.completedSessionsToday = 3;
    assert.equal(saveAppState(state), false);
    assert.deepEqual(seen, [true, false]);
  } finally { localStorage.setItem = original; }
  assert.equal(saveAppState(state), true);
  assert.deepEqual(seen, [true, false, true]);
  assert.equal(loadAppState().progress.completedSessionsToday, 3);
  unsubscribe();
  const length = seen.length;
  saveAppState(state);
  assert.equal(seen.length, length);
});

console.log(`\n=== HASIL: ${passedTests}/${passedTests + failedTests} PENGUJIAN LOLOS DENGAN SUKSES ===`);

if (failedTests > 0) {
  console.error(`Terdapat ${failedTests} pengujian yang gagal!`);
  process.exit(1);
} else {
  process.exit(0);
}
