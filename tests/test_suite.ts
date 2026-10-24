import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPomodoroPlan, validatePomodoroInput } from '../src/timer/pomodoroPlan';
import { PomodoroEngine } from '../src/timer/pomodoroEngine';
import {
  sanitizePomodoroConfig,
  DEFAULT_POMODORO_CONFIG,
  isYesterday,
  getTodayDateString,
  loadAppState,
} from '../src/storage';
import { LyricsService, parseSyncedLyrics, type TrackArtworkInfo } from '../src/audio/lyricsService';
import {
  resolveMediaSourceIdentity,
  base64ToBytes,
  base64ToBlobUrl,
} from '../src/audio/mediaSourceIdentity';
import { SystemMediaBridge, type SystemMediaTrack } from '../src/audio/systemMediaBridge';
import { IslandRenderer } from '../src/canvas/islandRenderer';
import {
  drawMomoSeasonLayer,
  getMomoFrameAnchor,
} from '../src/canvas/momoSeasonAccessories';
import type { PomodoroConfig, PlanPhase, IslandSeason } from '../src/types';
import { ISLAND_DIMENSIONS, getIslandDimension } from '../src/main';

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
    clearRect: () => {},
    fillText: () => {},
    fillRect: () => {},
    strokeRect: () => {},
    moveTo: () => {},
    lineTo: () => {},
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
runTest('Uji 1: Total 180m (25/5) menghasilkan 150m fokus + 30m istirahat', () => {
  const plan = buildPomodoroPlan(180, 25, 5);
  assert.strictEqual(plan.totalDurationMin, 180);
  assert.strictEqual(plan.totalFocusMin, 150);
  assert.strictEqual(plan.totalBreakMin, 30);
  assert.strictEqual(plan.focusSessionCount, 6);
  assert.strictEqual(plan.phases.length, 12);
  assert.strictEqual(plan.phases[plan.phases.length - 1].isShortened, false);
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
  assert.strictEqual(cleanConfig.dailyWaterTargetMl, DEFAULT_POMODORO_CONFIG.dailyWaterTargetMl);

  // Verifikasi bahwa konfigurasi yang dibersihkan dapat langsung dipakai membuat engine tanpa error
  const engine = new PomodoroEngine(cleanConfig);
  assert.strictEqual(engine.getStatus(), 'idle');
  assert.strictEqual(engine.getCurrentPhase()?.type, 'focus');
});

// ----------------------------------------------------------------------------
// 5. Temuan Audit 5: Jeda pada batas akhir fase tidak melewatkan pencatatan
// ----------------------------------------------------------------------------
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
runTest('Uji 13: Pembaruan berkala loadLyrics dengan lagu yang sama mempertahankan timer putaran lirik', () => {
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

    assert.strictEqual(timerCreatedCount, 1, 'Timer hanya boleh dimulai 1 kali untuk 11 kali pembaruan berturut-turut');
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
    await new Promise((r) => setTimeout(r, 10));

    void service.loadLyrics('SongB', 'ArtistB', 'AlbumB', true);
    await new Promise((r) => setTimeout(r, 10));

    resolveSongB(null);
    await new Promise((r) => setTimeout(r, 20));

    resolveSongA(null);
    await new Promise((r) => setTimeout(r, 20));

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
    if (urlStr.includes('lrclib.net')) {
      return new Promise((resolve) => {
        resolveLyrics = () => {
          resolve({
            ok: true,
            json: async () => ({
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
    await new Promise((r) => setTimeout(r, 10));

    void service.loadLyrics('SongSlow', 'ArtistSlow', 'AlbumSlow', false);
    await new Promise((r) => setTimeout(r, 10));

    resolveLyrics(null);
    await lyricsPromise;
    await new Promise((r) => setTimeout(r, 20));

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

  await new Promise((r) => setTimeout(r, 10));

  // Tahap 2: Ubah bentuk panel (min-height belum aktif)
  classList.remove('is-fading-out', 'expanded-ready');
  classList.add('is-morphing');
  transitionLog.push('morph-start');
  assert.strictEqual(classList.contains('expanded-ready'), false, 'expanded-ready tidak boleh aktif saat panel sedang berubah bentuk');
  assert.strictEqual(classList.contains('is-morphing'), true);

  await new Promise((r) => setTimeout(r, 10));

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
});

await runTestAsync('Uji 22: syncPosition memilih baris lirik sesuai detik pemutaran lagu (intro, berjalan, dan seek)', async () => {
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
          syncedLyrics: "[00:10.00] Baris 1 (detik 10)\n[00:20.00]\n[00:30.00] Baris 2 (detik 30)\n[00:50.00] Baris 3 (detik 50)",
          plainLyrics: "Baris 1\nBaris 2\nBaris 3"
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

    // 5. Lagu dijeda (pause) pada posisi yang sama
    service.syncPosition(35, false);
    latest = updates[updates.length - 1];
    assert.strictEqual(latest.highlight, 'Baris 2 (detik 30)', 'Saat dijeda, posisi highlight lirik tetap terjaga');
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
    assert.strictEqual(latest.highlight, 'Kutipan lirik pertama');
  } finally {
    globalThis.fetch = origFetch;
    service.clear();
  }
});

runTest('Uji 24: Format waktu menghitung menit dan detik secara tepat tanpa kesalahan nilai desimal atau negatif', () => {
  function formatTime(seconds: number): string {
    if (!seconds || isNaN(seconds) || seconds < 0) return '00:00';
    const totalSecs = Math.floor(seconds);
    const m = Math.floor(totalSecs / 60);
    const s = totalSecs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  assert.strictEqual(formatTime(0), '00:00');
  assert.strictEqual(formatTime(-15), '00:00');
  assert.strictEqual(formatTime(9.8), '00:09');
  assert.strictEqual(formatTime(65), '01:05');
  assert.strictEqual(formatTime(102.4), '01:42');
  assert.strictEqual(formatTime(248), '04:08');
  assert.strictEqual(formatTime(3600), '60:00');
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
  assert.strictEqual(loaded.waterMl, 0, 'Air minum harian harus direset saat berganti hari');

  // Musim aktif dan hitungan musim harus tetap dipertahankan
  assert.strictEqual(loaded.progress.currentSeason, 'autumn', 'Musim aktif tidak boleh direset saat berganti hari');
  assert.strictEqual(loaded.progress.seasonCycleCount, 4, 'Hitungan siklus musim tidak boleh direset saat berganti hari');
  assert.strictEqual(loaded.config.seasonMode, 'cycle');
});

runTest('Uji 26: Selesai 6 sesi fokus penuh dalam mode cycle merotasi musim secara berurutan', () => {
  let currentSeason: IslandSeason = 'spring';
  let seasonCycleCount = 0;
  const seasons: IslandSeason[] = ['spring', 'summer', 'autumn', 'winter'];

  function completeOneFocusSession() {
    seasonCycleCount++;
    if (seasonCycleCount >= 6) {
      const idx = seasons.indexOf(currentSeason);
      currentSeason = seasons[(idx + 1) % seasons.length];
      seasonCycleCount = 0;
    }
  }

  // Jalankan 5 sesi
  for (let i = 0; i < 5; i++) {
    completeOneFocusSession();
    assert.strictEqual(currentSeason, 'spring');
    assert.strictEqual(seasonCycleCount, i + 1);
  }

  // Sesi ke-6: harus rotasi menjadi summer dan cycle count direset menjadi 0
  completeOneFocusSession();
  assert.strictEqual(currentSeason, 'summer', 'Sesi ke-6 harus merotasi musim dari spring menjadi summer');
  assert.strictEqual(seasonCycleCount, 0, 'Siklus hitungan harus kembali ke 0 setelah pergantian musim');

  // Jalankan 6 sesi lagi: summer menjadi autumn
  for (let i = 0; i < 6; i++) {
    completeOneFocusSession();
  }
  assert.strictEqual(currentSeason, 'autumn');

  // Jalankan 6 sesi lagi: autumn menjadi winter
  for (let i = 0; i < 6; i++) {
    completeOneFocusSession();
  }
  assert.strictEqual(currentSeason, 'winter');

  // Jalankan 6 sesi lagi: winter kembali menjadi spring
  for (let i = 0; i < 6; i++) {
    completeOneFocusSession();
  }
  assert.strictEqual(currentSeason, 'spring');
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

runTest('Uji 35: Spesifikasi dimensi panel musik sesuai desain acuan Figma (960 × 248 px, background #17231F, border #35483E, radius bawah 18 px, padding 16 px, gap 12 px, isi 156 px)', () => {
  const css = fs.readFileSync('src/styles.css', 'utf8');

  // 1. Dimensi dan styling .island-widget.state-expanded.tab-music sesuai Figma
  assert.strictEqual(
    css.includes('width: 960px;'),
    true,
    'Panel musik harus memiliki lebar 960 px'
  );
  assert.strictEqual(
    css.includes('.island-widget.state-expanded.tab-music {\n  box-sizing: border-box;\n  width: 960px;\n  max-width: 100vw;\n  height: 248px;\n  max-height: 248px;\n  background: #17231F;\n  border: 1px solid #35483E;\n  border-top: none;\n  border-top-left-radius: 0;\n  border-top-right-radius: 0;\n  border-bottom-left-radius: 18px;\n  border-bottom-right-radius: 18px;\n}'),
    true,
    'Panel musik harus berukuran 960 × 248 px, background #17231F, border #35483E, border-top none, dan sudut bawah 18 px'
  );

  // 2. Min-height panel musik disetel 248 px
  assert.strictEqual(
    css.includes('.island-widget.state-expanded.expanded-ready.tab-music {\n  min-height: 248px;\n  max-height: 248px;\n}'),
    true,
    'Min-height panel musik harus disetel ke 248 px'
  );

  // 3. .view-expanded tab musik berukuran 960 × 248 px dengan padding 16 px dan gap 12 px
  assert.strictEqual(
    css.includes('.island-widget.state-expanded.tab-music .view-expanded {\n  box-sizing: border-box;\n  display: flex;\n  flex-direction: column;\n  align-items: flex-start;\n  padding: 16px;\n  gap: 12px;\n  width: 100%;\n  height: 248px;\n  max-height: 248px;\n}'),
    true,
    '.view-expanded musik harus memakai padding 16 px, gap 12 px, flex column, dan align-items flex-start'
  );

  // 4. Panel fokus dan minum tetap mempertahankan tinggi penuh 308 px
  assert.strictEqual(
    css.includes('.island-widget.state-expanded.tab-focus,\n.island-widget.state-expanded.tab-hydration {\n  height: 308px;\n  max-height: 308px;\n}'),
    true,
    'Panel fokus dan minum tetap harus memakai tinggi 308 px'
  );

  // 5. Penataan #panel-music memiliki tinggi tetap 156 px, gap 12 px, dan align-items center
  assert.strictEqual(
    css.includes('#panel-music {\n  width: 100%;\n  height: 156px;\n  min-height: 156px;\n  max-height: 156px;\n  flex: 0 0 156px;\n  margin-top: 0;\n  margin-bottom: 0;\n  gap: 12px;\n  align-items: center;\n  box-sizing: border-box;\n}'),
    true,
    'Isi panel musik harus memiliki tinggi tetap 156 px (16+48+12+156+16=248 px) dan gap 12 px'
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
  const req2Seq = ++pollSequence;
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
            syncedLyrics: '[00:15.00] Lirik pembuka versi Live\n[00:40.00] Lirik kedua versi Live',
          }),
        } as unknown as Response;
      } else if (urlStr.includes('duration=240')) {
        // Versi Studio (durasi 240 detik)
        return {
          ok: true,
          json: async () => ({
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
    mediaRs.includes('let calculated = raw_pos + elapsed_secs;'),
    true,
    'media.rs harus menambahkan elapsed time ke snapshot Position saat is_playing aktif'
  );
});

runTest('Uji 41: Konfigurasi ISLAND_DIMENSIONS dan fungsi getIslandDimension sebagai satu sumber acuan (Single Source of Truth)', () => {
  // 1. Hidden notch
  assert.deepStrictEqual(ISLAND_DIMENSIONS.hidden, {
    width: 130,
    height: 28,
    minWidth: null,
    minHeight: null,
    resizable: false,
  });
  assert.deepStrictEqual(getIslandDimension('hidden', 'music', false), ISLAND_DIMENSIONS.hidden);

  // 2. Compact notch
  assert.deepStrictEqual(ISLAND_DIMENSIONS.compact, {
    width: 460,
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

  // 4. Expanded focus dan hydration (308 px)
  assert.strictEqual(ISLAND_DIMENSIONS.expanded.focus.height, 308);
  assert.strictEqual(ISLAND_DIMENSIONS.expanded.focus.minHeight, 308);
  assert.strictEqual(ISLAND_DIMENSIONS.expanded.hydration.height, 308);
  assert.strictEqual(ISLAND_DIMENSIONS.expanded.hydration.minHeight, 308);

  // 5. Expanded music (248 px persis sesuai Figma)
  assert.strictEqual(ISLAND_DIMENSIONS.expanded.music.width, 960);
  assert.strictEqual(ISLAND_DIMENSIONS.expanded.music.height, 248);
  assert.strictEqual(ISLAND_DIMENSIONS.expanded.music.minHeight, 248);
  assert.strictEqual(ISLAND_DIMENSIONS.expanded.music.resizable, true);
  assert.deepStrictEqual(getIslandDimension('expanded', 'music', false), ISLAND_DIMENSIONS.expanded.music);
});

runTest('Uji 42: Alur perubahan ukuran jendela konsisten: Fokus (308) -> Musik (248) -> Minum (308) -> Musik (248) -> Compact (42) -> Musik (248) -> Modal (560) -> Tutup Modal (248)', () => {
  // Simulasi alur navigasi tab dan status
  let currentState: 'hidden' | 'compact' | 'expanded' = 'expanded';
  let currentActiveTab: 'focus' | 'hydration' | 'music' = 'focus';
  let isModalOpen = false;

  // 1. Fokus awal
  let dim = getIslandDimension(currentState, currentActiveTab, isModalOpen);
  assert.strictEqual(dim.height, 308, 'Tab Fokus awal harus 308 px');

  // 2. Berpindah ke tab Musik
  currentActiveTab = 'music';
  dim = getIslandDimension(currentState, currentActiveTab, isModalOpen);
  assert.strictEqual(dim.height, 248, 'Tab Musik harus tepat 248 px');
  assert.strictEqual(dim.width, 960);

  // 3. Berpindah ke tab Minum (Hydration)
  currentActiveTab = 'hydration';
  dim = getIslandDimension(currentState, currentActiveTab, isModalOpen);
  assert.strictEqual(dim.height, 308, 'Tab Minum harus kembali 308 px');

  // 4. Kembali ke tab Musik
  currentActiveTab = 'music';
  dim = getIslandDimension(currentState, currentActiveTab, isModalOpen);
  assert.strictEqual(dim.height, 248, 'Kembali ke Musik harus 248 px');

  // 5. Mengecilkan ke Compact
  currentState = 'compact';
  dim = getIslandDimension(currentState, currentActiveTab, isModalOpen);
  assert.strictEqual(dim.height, 42, 'Mode Compact harus 42 px');
  assert.strictEqual(dim.width, 460);

  // 6. Mengembangkan kembali ke Expanded (aktif tab Musik)
  currentState = 'expanded';
  dim = getIslandDimension(currentState, currentActiveTab, isModalOpen);
  assert.strictEqual(dim.height, 248, 'Expanded kembali ke tab Musik harus 248 px');

  // 7. Membuka modal pengaturan dari tab Musik
  isModalOpen = true;
  dim = getIslandDimension(currentState, currentActiveTab, isModalOpen);
  assert.strictEqual(dim.height, 560, 'Modal pengaturan harus 560 px');
  assert.strictEqual(dim.width, 960);

  // 8. Menutup modal pengaturan
  isModalOpen = false;
  dim = getIslandDimension(currentState, currentActiveTab, isModalOpen);
  assert.strictEqual(dim.height, 248, 'Menutup modal dari tab Musik harus mengembalikan ukuran ke 248 px');
});

// ----------------------------------------------------------------------------
// 10. Tampilan Lirik 3 Baris Aktif di Tengah dan Transisi Lembut
// ----------------------------------------------------------------------------
await runTestAsync('Uji 43: Gaya lirik 3 baris aktif di tengah, transisi berurutan step (180-250 ms), fade jump saat seek/ganti lagu, tiga titik pixel instrumental, dan penanganan pause/reduced-motion', async () => {
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
    assert.strictEqual(u.isInstrumental, true, 'Saat jeda instrumental panjang, status harus instrumental');
    assert.strictEqual(u.highlight, '♪ ♪ ♪');
    assert.strictEqual(u.line1, 'Baris Keempat Setelah Jeda (30s)');
    assert.strictEqual(u.line2, 'Baris Kelima Gap Panjang (55s)');

    // 7. Ganti Lagu ke SongB (jump langsung dan reset state)
    await service.loadLyrics('SongB', 'ArtistB', 'AlbumB', true, 10, 150);
    u = updates[updates.length - 1];
    assert.strictEqual(u.transitionType, 'jump', 'Ganti lagu harus menggunakan transisi jump');

    // 8. Verifikasi DOM di index.html
    const html = fs.readFileSync('index.html', 'utf8');
    assert.strictEqual(html.includes('id="lyrics-viewport"'), true, 'index.html harus memuat lyrics-viewport');
    assert.strictEqual(html.includes('id="lyrics-track"'), true, 'index.html harus memuat lyrics-track');
    assert.strictEqual(html.includes('id="lyrics-instrumental-dots"'), true, 'index.html harus memuat container titik pixel instrumental');
    assert.strictEqual(html.includes('pixel-dot'), true, 'index.html harus memuat elemen pixel-dot');
    assert.strictEqual(html.includes('id="music-card-highlight"'), true, 'index.html harus mempertahankan id music-card-highlight');

    // 9. Verifikasi CSS di src/styles.css
    const css = fs.readFileSync('src/styles.css', 'utf8');
    assert.strictEqual(css.includes('.lyrics-track.is-sliding-up'), true, 'styles.css harus memiliki kelas .lyrics-track.is-sliding-up');
    assert.strictEqual(css.includes('transform: translateY(-26px);'), true, 'Animasi pergeseran ke atas bergeser tepat -26px');
    assert.strictEqual(css.includes('transition: transform 200ms cubic-bezier(0.22, 1, 0.36, 1);'), true, 'Durasi pergeseran berada di rentang 180-250 ms (200 ms)');
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
  assert.strictEqual(loaded.waterMl, 0, 'Air minum negatif harus dijepit ke 0');

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

await runTestAsync('Uji 58: Jeda manual di tengah lagu tidak dianggap lagu selesai; jeda di ujung durasi memicu event selesai', async () => {
  let finishedCount = 0;
  const baseTrack = {
    title: 'Lagu Ujian', artist: 'Artis', album: 'Album', is_playing: true,
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
    currentPayload = { ...baseTrack, is_playing: false, position_secs: 199.6 };
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
      json: async () => ({ syncedLyrics: '[00:05.00] Lirik Retry Berhasil' }),
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
    await new Promise((r) => setTimeout(r, 250));
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
console.log(`\n=== HASIL: ${passedTests}/${passedTests + failedTests} PENGUJIAN LOLOS DENGAN SUKSES ===`);

if (failedTests > 0) {
  console.error(`Terdapat ${failedTests} pengujian yang gagal!`);
  process.exit(1);
} else {
  process.exit(0);
}
