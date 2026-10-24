import { drawOakTree, drawPineTree, drawSproutProgress } from './treeSprites';
import { drawMomoV2, MomoV2Action } from './momoV2Atlas';
import { MomoSeasonalAction } from './momoSeasonAccessories';
import { PlantedTree, IslandSeason } from '../types';

export interface PlantingSlot {
  r: number;
  c: number;
  type: 'oak' | 'pine';
}

// 14 petak tanam yang strategis mengelilingi jalur jalan setapak
export const PLANTING_SLOTS: PlantingSlot[] = [
  { r: 0, c: 2, type: 'oak' },
  { r: 1, c: 0, type: 'pine' },
  { r: 0, c: 4, type: 'pine' },
  { r: 4, c: 1, type: 'oak' },
  { r: 2, c: 5, type: 'pine' },
  { r: 5, c: 3, type: 'oak' },
  { r: 1, c: 4, type: 'pine' },
  { r: 4, c: 5, type: 'oak' },
  { r: 0, c: 1, type: 'pine' },
  { r: 5, c: 2, type: 'pine' },
  { r: 1, c: 5, type: 'oak' },
  { r: 4, c: 0, type: 'pine' },
  { r: 0, c: 3, type: 'oak' },
  { r: 5, c: 4, type: 'pine' },
];

export class IslandRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private isRunning: boolean = false;
  private rafId: number | null = null;
  private lastFrameTime: number = 0;
  private readonly frameInterval: number = 1000 / 24;
  private shouldRender: () => boolean;

  // Animation states
  private frameCount: number = 0;
  private blinkTimer: number = 0;
  private momoMood: 'idle' | 'happy' | 'hydrated' | 'resting' = 'idle';
  private celebrationTimer: number = 0;
  private hydrationTimer: number = 0;
  private waveTimer: number = 0;
  private songFinishedTimer: number = 0;
  private isMusicPlaying: boolean = false;
  private isOverviewMode: boolean = false;
  private ambientMode: 'rain' | 'stream' | 'breeze' | null = null;
  private rainDrops: Array<{ x: number; y: number; speed: number; length: number }> = [];
  private musicNotes: Array<{ x: number; y: number; vy: number; opacity: number; symbol: string }> = [];

  // Seasonal Momo Animation & Snow Accumulation states
  private snowAccumulationLevel: number = 0;
  private snowAccumulationTimer: number = 0;
  private activeSeasonalAction: MomoSeasonalAction | null = null;
  private seasonalActionTimer: number = 0;
  private readonly seasonalActionDuration: number = 48;

  // Tree & Sprout States
  private permanentTrees: PlantedTree[] = [];
  private activeSprout: {
    slotIndex: number;
    progress: number;
    isPaused: boolean;
    isBlooming: boolean;
    bloomTimer: number;
  } | null = null;

  // Walking path & waypoints for Momo (mengikuti jalan setapak di tengah)
  private normalWaypoints: Array<{ r: number; c: number; waitFrames: number }> = [
    { r: 2.2, c: 2.2, waitFrames: 60 },
    { r: 2.8, c: 2.2, waitFrames: 45 },
    { r: 2.8, c: 2.8, waitFrames: 50 },
    { r: 2.2, c: 2.8, waitFrames: 60 },
  ];
  private waypoints = this.normalWaypoints;
  private currentWaypointIndex: number = 0;
  private currentPos = { r: 2.2, c: 2.2 };
  private waitCounter: number = 0;
  private facingRight: boolean = true;
  private isWalking: boolean = false;

  // Floating spores & seasonal weather particles
  private spores: Array<{ x: number; y: number; vy: number; vx: number; opacity: number }> = [];
  private currentSeason: IslandSeason = 'spring';
  private seasonalParticles: Array<{
    x: number;
    y: number;
    vx: number;
    vy: number;
    size: number;
    opacity: number;
    color: string;
  }> = [];

  constructor(canvas: HTMLCanvasElement, shouldRender?: () => boolean) {
    this.canvas = canvas;
    this.shouldRender = shouldRender ?? (() => true);
    const context = canvas.getContext('2d', { willReadFrequently: false });
    if (!context) throw new Error('Could not get 2D context');
    this.ctx = context;

    this.initSpores();
    this.initSeasonalParticles();
    this.initRain();
    this.handleResize();

    window.addEventListener('resize', () => this.handleResize());
    if (typeof ResizeObserver !== 'undefined' && canvas.parentElement) {
      const ro = new ResizeObserver(() => this.handleResize());
      ro.observe(canvas.parentElement);
    }
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.pause();
      } else if (this.shouldRender()) {
        this.start();
      }
    });
  }

  public setSeason(season: IslandSeason): void {
    if (this.currentSeason !== season) {
      this.currentSeason = season;
      this.initSeasonalParticles();
      if (season !== 'winter') {
        this.snowAccumulationLevel = 0;
        this.snowAccumulationTimer = 0;
      }
      this.activeSeasonalAction = null;
      this.seasonalActionTimer = 0;
    }
  }

  public getSeason(): IslandSeason {
    return this.currentSeason;
  }

  private initSeasonalParticles(): void {
    this.seasonalParticles = [];
    const count = 20;

    for (let i = 0; i < count; i++) {
      let color = '#FFB7C5';
      let vx = 0.25 + Math.random() * 0.35;
      let vy = 0.2 + Math.random() * 0.3;
      let size = 2 + Math.random() * 1.5;
      let opacity = 0.4 + Math.random() * 0.45;

      if (this.currentSeason === 'spring') {
        const pinks = ['#FFB7C5', '#FFAAA6', '#FFC0CB', '#FFD1DC'];
        color = pinks[Math.floor(Math.random() * pinks.length)];
        vx = 0.2 + Math.random() * 0.35;
        vy = 0.15 + Math.random() * 0.25;
        size = 2 + Math.random() * 1.5;
      } else if (this.currentSeason === 'summer') {
        const golds = ['#FFDE59', '#FFE494', '#FFF3B0', '#FFD166'];
        color = golds[Math.floor(Math.random() * golds.length)];
        vx = (Math.random() - 0.5) * 0.3;
        vy = -(0.15 + Math.random() * 0.25);
        size = 1.5 + Math.random() * 1.2;
      } else if (this.currentSeason === 'autumn') {
        const autumns = ['#E25822', '#D97706', '#B45309', '#9A3412', '#C28835'];
        color = autumns[Math.floor(Math.random() * autumns.length)];
        vx = 0.15 + Math.random() * 0.35;
        vy = 0.3 + Math.random() * 0.4;
        size = 2.5 + Math.random() * 1.5;
      } else if (this.currentSeason === 'winter') {
        const whites = ['#FFFFFF', '#F8FAFC', '#E2E8F0', '#EDF2F7'];
        color = whites[Math.floor(Math.random() * whites.length)];
        vx = (Math.random() - 0.5) * 0.2;
        vy = 0.25 + Math.random() * 0.35;
        size = 2 + Math.random() * 1.5;
      }

      this.seasonalParticles.push({
        x: Math.random() * 360,
        y: Math.random() * 160,
        vx,
        vy,
        size,
        opacity,
        color,
      });
    }
  }

  private initSpores() {
    this.spores = [];
    for (let i = 0; i < 14; i++) {
      this.spores.push({
        x: Math.random() * 360,
        y: Math.random() * 160,
        vy: -(0.15 + Math.random() * 0.35),
        vx: (Math.random() - 0.5) * 0.25,
        opacity: 0.25 + Math.random() * 0.45,
      });
    }
  }

  private initRain() {
    this.rainDrops = [];
    for (let i = 0; i < 28; i++) {
      this.rainDrops.push({
        x: Math.random() * 380,
        y: Math.random() * 160,
        speed: 3 + Math.random() * 2,
        length: 5 + Math.random() * 4,
      });
    }
  }

  // ==========================================================================
  // PENGELOLAAN POHON PERMANEN & SESI FOKUS
  // ==========================================================================
  public setPlantedTrees(trees: PlantedTree[]) {
    this.permanentTrees = [...trees];
  }

  public getPlantedTrees(): PlantedTree[] {
    return this.permanentTrees;
  }

  /**
   * Mengembalikan jumlah generasi hutan yang telah diarsipkan.
   * Satu generasi terdiri dari 14 pohon (seluruh petak terisi).
   */
  public getGenerationCount(): number {
    return Math.floor(this.permanentTrees.length / PLANTING_SLOTS.length);
  }

  /**
   * Mengembalikan rincian generasi hutan untuk antarmuka pengguna
   */
  public getForestGenerationInfo(): {
    generation: number;
    currentGenTrees: number;
    maxSlots: number;
    totalTrees: number;
  } {
    const maxSlots = PLANTING_SLOTS.length;
    const totalTrees = this.permanentTrees.length;
    const generation = Math.floor(totalTrees / maxSlots);
    const currentGenTrees = totalTrees % maxSlots;
    return {
      generation,
      currentGenTrees,
      maxSlots,
      totalTrees,
    };
  }

  /**
   * Dipanggil saat lagu selesai diputar:
   * Momo melepas headphone, meregangkan badan rileks selama ~3.5 detik
   */
  public triggerSongFinished(): void {
    this.songFinishedTimer = 84; // 84 frames @ 24fps = 3.5 detik
    this.momoMood = 'resting';
    this.isWalking = false;
  }

  /**
   * Mengembalikan daftar pohon generasi aktif (yang ditampilkan di pulau).
   * Pohon dari generasi sebelumnya diarsipkan dan tidak digambar.
   */
  private getCurrentGenTrees(): PlantedTree[] {
    const genStart = this.getGenerationCount() * PLANTING_SLOTS.length;
    return this.permanentTrees.slice(genStart);
  }

  /**
   * Menentukan indeks petak berikutnya yang tersedia pada generasi aktif.
   * Mengembalikan indeks petak (0..13) berdasarkan jumlah pohon di generasi ini.
   */
  private getNextSlotIndex(): number {
    return this.getCurrentGenTrees().length % PLANTING_SLOTS.length;
  }

  /**
   * Dipanggil saat fokus dimulai:
   * Momo berjalan ke petak kosong lalu menanam benih
   */
  public startFocusPlanting(): { r: number; c: number; slotIndex: number } {
    const slotIndex = this.getNextSlotIndex();
    const slot = PLANTING_SLOTS[slotIndex];

    this.activeSprout = {
      slotIndex,
      progress: 0.05,
      isPaused: false,
      isBlooming: false,
      bloomTimer: 0,
    };

    // Arahkan Momo berjalan mendekati petak tanam
    this.waypoints = [
      { r: slot.r > 2 ? slot.r - 0.5 : slot.r + 0.5, c: slot.c > 2 ? slot.c - 0.5 : slot.c + 0.5, waitFrames: 90 },
      ...this.normalWaypoints,
    ];
    this.currentWaypointIndex = 0;
    this.momoMood = 'idle';

    return { r: slot.r, c: slot.c, slotIndex };
  }

  /**
   * Dipanggil selama fokus berlangsung:
   * Petak menunjukkan progres pertumbuhan tunas (0.0 sampai 1.0)
   */
  public updateFocusProgress(progress: number) {
    if (this.activeSprout && !this.activeSprout.isBlooming) {
      this.activeSprout.progress = Math.max(0.05, Math.min(1.0, progress));
    }
  }

  /**
   * Dipanggil saat timer dijeda / di-resume
   */
  public setTimerPaused(paused: boolean) {
    if (this.activeSprout) {
      this.activeSprout.isPaused = paused;
    }
    if (paused) {
      this.momoMood = 'resting'; // Momo duduk di dekat tunas
      this.isWalking = false;
    } else {
      this.momoMood = 'idle';
    }
  }

  /**
   * Memeriksa apakah terdapat tunas aktif yang sedang bertumbuh (belum mekar)
   */
  public hasActiveSprout(): boolean {
    return this.activeSprout !== null && !this.activeSprout.isBlooming;
  }

  /**
   * Dipanggil saat fokus selesai:
   * Tunas tumbuh menjadi satu pohon permanen, Momo merayakan dengan gembira.
   * Jika petak terakhir generasi ini terisi, generasi baru dimulai secara otomatis.
   */
  public completeFocusSession(): PlantedTree {
    let slotIndex = this.getNextSlotIndex();
    if (this.activeSprout) {
      slotIndex = this.activeSprout.slotIndex;
      this.activeSprout.isBlooming = true;
      this.activeSprout.bloomTimer = 48; // ~2 detik perayaan mekar
    }

    const slot = PLANTING_SLOTS[slotIndex];
    const newTree: PlantedTree = {
      id: `tree_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      gridR: slot.r,
      gridC: slot.c,
      treeType: slot.type,
      plantedAtTimestamp: Date.now(),
    };

    this.permanentTrees.push(newTree);
    this.momoMood = 'happy';
    this.celebrationTimer = 48; // 2 detik perayaan Momo
    this.waypoints = this.normalWaypoints;

    return newTree;
  }

  /**
   * Dipanggil jika sesi fokus dibatalkan / reset
   * Tidak mendapat pohon; pohon dari sesi sebelumnya tetap ada
   */
  public cancelFocusSession() {
    this.activeSprout = null;
    this.momoMood = 'idle';
    this.waypoints = this.normalWaypoints;
  }

  /**
   * Dipanggil saat fase istirahat
   */
  public setBreakMode(isBreak: boolean) {
    if (isBreak) {
      this.momoMood = 'resting';
      this.isWalking = false;
    } else {
      this.momoMood = 'idle';
    }
  }

  public setMood(mood: 'idle' | 'happy' | 'hydrated' | 'resting') {
    this.momoMood = mood;
  }

  public celebrateBriefly(frames: number = 36) {
    this.momoMood = 'happy';
    this.celebrationTimer = frames;
  }

  public setHydrated(hydrated: boolean) {
    if (hydrated) {
      this.momoMood = 'hydrated';
      this.hydrationTimer = 72; // ~3 detik efek segar minum air
    } else {
      this.momoMood = 'idle';
      this.hydrationTimer = 0;
    }
  }

  public setAmbientMode(mode: 'rain' | 'stream' | 'breeze' | 'off' | null) {
    if (mode === 'off' || mode === null) {
      this.ambientMode = null;
      if (!this.isMusicPlaying && this.momoMood === 'resting') {
        this.momoMood = 'idle';
      }
      return;
    }
    this.ambientMode = mode;
    if (mode === 'stream') {
      this.momoMood = 'resting'; // Momo duduk santai di tepi saluran air
      this.isWalking = false;
    } else if (!this.isMusicPlaying && this.momoMood === 'resting') {
      this.momoMood = 'idle';
    }
  }

  public getAmbientMode(): 'rain' | 'stream' | 'breeze' | null {
    return this.ambientMode;
  }

  public setMusicPlaying(playing: boolean) {
    this.isMusicPlaying = playing;
    if (!playing) {
      this.musicNotes = [];
      // Musik dijeda: Momo berhenti menari lalu duduk santai
      this.momoMood = 'resting';
      this.isWalking = false;
    } else {
      this.momoMood = 'idle';
    }
  }

  public setOverviewMode(overview: boolean) {
    this.isOverviewMode = overview;
  }

  public waveHello(frames: number = 40) {
    this.momoMood = 'happy';
    this.waveTimer = frames;
  }

  public triggerSeasonalAction(action?: MomoSeasonalAction): void {
    if (action) {
      this.activeSeasonalAction = action;
    } else {
      const defaults: Record<IslandSeason, MomoSeasonalAction> = {
        spring: 'spring_sniff',
        summer: 'summer_fan',
        autumn: 'autumn_catch',
        winter: 'winter_warm_hands',
      };
      this.activeSeasonalAction = defaults[this.currentSeason];
    }
    this.seasonalActionTimer = this.seasonalActionDuration;
  }

  public getActiveSeasonalAction(): MomoSeasonalAction | null {
    return this.activeSeasonalAction;
  }

  public getSnowAccumulationLevel(): number {
    return this.snowAccumulationLevel;
  }

  public setSnowAccumulationLevel(level: number): void {
    this.snowAccumulationLevel = Math.max(0, Math.min(3, Math.floor(level)));
  }

  public start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastFrameTime = performance.now();
    this.loop(this.lastFrameTime);
  }

  public pause() {
    this.isRunning = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private handleResize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const w = rect.width || 360;
    const h = rect.height || 160;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(dpr, dpr);
  }

  private loop = (currentTime: number) => {
    if (!this.isRunning) return;

    this.rafId = requestAnimationFrame(this.loop);

    const delta = currentTime - this.lastFrameTime;
    if (delta >= this.frameInterval) {
      this.lastFrameTime = currentTime - (delta % this.frameInterval);
      this.update();
      this.draw();
    }
  };

  private update() {
    this.frameCount++;

    // Hitung mundur perayaan selesai fokus
    if (this.celebrationTimer > 0) {
      this.celebrationTimer--;
      if (this.celebrationTimer === 0 && this.momoMood === 'happy') {
        this.momoMood = 'idle';
      }
    }

    // Hitung mundur lambaian tangan saat island dibuka
    if (this.waveTimer > 0) {
      this.waveTimer--;
      if (this.waveTimer === 0 && this.momoMood === 'happy') {
        this.momoMood = 'idle';
      }
    }

    // Hitung mundur segar minum air
    if (this.hydrationTimer > 0) {
      this.hydrationTimer--;
      if (this.hydrationTimer === 0 && this.momoMood === 'hydrated') {
        this.momoMood = 'idle';
      }
    }

    // Hitung mundur meregangkan badan saat lagu selesai
    if (this.songFinishedTimer > 0) {
      this.songFinishedTimer--;
      if (this.songFinishedTimer === 0 && this.momoMood === 'resting') {
        this.momoMood = 'idle';
      }
    }

    // Hitung mundur aksi khas musiman Momo
    if (this.activeSeasonalAction && this.seasonalActionTimer > 0) {
      this.seasonalActionTimer--;
      if (this.seasonalActionTimer === 0) {
        if (this.activeSeasonalAction === 'winter_snow_shake') {
          this.snowAccumulationLevel = 0; // Salju di kepala rontok bersih
        }
        this.activeSeasonalAction = null;
      }
    }

    // Akumulasi salju di atas kepala Momo saat musim dingin
    if (this.currentSeason === 'winter') {
      this.snowAccumulationTimer++;
      if (this.snowAccumulationTimer >= 100) {
        this.snowAccumulationTimer = 0;
        if (this.snowAccumulationLevel < 3) {
          this.snowAccumulationLevel++;
        }
      }
      // Jika salju sudah tebal (level 3) dan Momo sedang idle menunggu, picu snow shake otomatis
      if (
        this.snowAccumulationLevel >= 3 &&
        !this.isWalking &&
        !this.activeSeasonalAction &&
        this.momoMood === 'idle' &&
        this.celebrationTimer === 0 &&
        this.waveTimer === 0
      ) {
        this.triggerSeasonalAction('winter_snow_shake');
      }
    } else {
      this.snowAccumulationLevel = 0;
      this.snowAccumulationTimer = 0;
    }

    // Hitung mundur mekar tunas aktif
    if (this.activeSprout?.isBlooming) {
      this.activeSprout.bloomTimer--;
      if (this.activeSprout.bloomTimer <= 0) {
        this.activeSprout = null; // Tunas selesai mekar menjadi pohon permanen
      }
    }

    // Blinking logic
    this.blinkTimer = (this.blinkTimer + 1) % 90;

    // Reduced motion check: jika pengguna menginginkan gerakan statis, partikel tidak digerakkan
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!prefersReducedMotion) {
      // Floating spores
      for (const s of this.spores) {
        s.y += s.vy;
        s.x += s.vx;
        if (s.y < 5) {
          s.y = 155;
          s.x = 20 + Math.random() * 320;
        }
      }

      // Seasonal weather particles (kelopak, cahaya hangat, daun gugur, salju)
      for (const p of this.seasonalParticles) {
        p.x += p.vx;
        p.y += p.vy;

        if (this.currentSeason === 'summer') {
          // Partikel musim panas melayang perlahan ke atas
          if (p.y < -5) {
            p.y = 165;
            p.x = Math.random() * 360;
          }
        } else {
          // Partikel musim semi, gugur, dan dingin melayang turun ke bawah
          if (p.y > 165) {
            p.y = -5;
            p.x = Math.random() * 360;
          }
        }

        if (p.x > 365) {
          p.x = -5;
        } else if (p.x < -5) {
          p.x = 365;
        }
      }

      // Gerimis Hujan saat mode ambient rain aktif
      if (this.ambientMode === 'rain') {
        for (const drop of this.rainDrops) {
          drop.y += drop.speed;
          drop.x -= drop.speed * 0.4;
          if (drop.y > 165 || drop.x < 0) {
            drop.y = -8;
            drop.x = Math.random() * 380;
          }
        }
      }

      // Not musik pixel melayang saat musik diputar
      if (this.isMusicPlaying) {
        if (this.frameCount % 80 === 0 && this.musicNotes.length < 2) {
          this.musicNotes.push({
            x: 8 + (Math.random() - 0.5) * 6,
            y: -14,
            vy: -0.3,
            opacity: 1.0,
            symbol: this.frameCount % 160 === 0 ? '♫' : '♪',
          });
        }
      }
      for (let i = this.musicNotes.length - 1; i >= 0; i--) {
        const note = this.musicNotes[i];
        note.y += note.vy;
        note.opacity -= 0.012;
        if (note.opacity <= 0) {
          this.musicNotes.splice(i, 1);
        }
      }
    }

    if (prefersReducedMotion || this.momoMood === 'resting') {
      this.isWalking = false;
      return;
    }

    // Momo walking logic
    const targetWp = this.waypoints[this.currentWaypointIndex];
    if (!targetWp) return;

    const dr = targetWp.r - this.currentPos.r;
    const dc = targetWp.c - this.currentPos.c;
    const dist = Math.hypot(dr, dc);

    if (dist > 0.04) {
      this.isWalking = true;
      const speed = 0.02;
      this.currentPos.r += (dr / dist) * speed;
      this.currentPos.c += (dc / dist) * speed;

      if (dc - dr > 0.01) {
        this.facingRight = true;
      } else if (dc - dr < -0.01) {
        this.facingRight = false;
      }
    } else {
      this.isWalking = false;
      this.waitCounter++;

      // Trigger aksi khas musiman secara alami saat Momo sedang menunggu di waypoint
      if (
        !this.activeSeasonalAction &&
        this.waitCounter > 20 &&
        this.waitCounter % 80 === 0 &&
        this.momoMood === 'idle' &&
        this.celebrationTimer === 0 &&
        this.waveTimer === 0 &&
        this.hydrationTimer === 0 &&
        !this.isMusicPlaying &&
        !this.activeSprout
      ) {
        const seasonActionPairs: Record<IslandSeason, [MomoSeasonalAction, MomoSeasonalAction]> = {
          spring: ['spring_inspect', 'spring_sniff'],
          summer: ['summer_fan', 'summer_wipe'],
          autumn: ['autumn_catch', 'autumn_admire'],
          winter: ['winter_warm_hands', 'winter_snow_shake'],
        };
        const pair = seasonActionPairs[this.currentSeason];
        const chosen = (this.frameCount % 160 < 80) ? pair[0] : pair[1];
        if (chosen === 'winter_snow_shake' && this.snowAccumulationLevel === 0) {
          this.triggerSeasonalAction('winter_warm_hands');
        } else {
          this.triggerSeasonalAction(chosen);
        }
      }

      if (this.waitCounter >= targetWp.waitFrames) {
        this.waitCounter = 0;
        this.currentWaypointIndex = (this.currentWaypointIndex + 1) % this.waypoints.length;
      }
    }
  }

  // ==========================================================================
  // RENDERING ENGINE PERSIS FIGMA
  // ==========================================================================
  private draw() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.width / dpr;
    const h = this.canvas.height / dpr;

    this.ctx.clearRect(0, 0, w, h);

    const baseW = 360;
    const baseH = 160;
    const zoomScale = this.isOverviewMode ? 0.84 : 1.0;
    const scale = Math.min(1, Math.min(w / baseW, h / baseH)) * zoomScale;

    this.ctx.save();
    const offsetX = (w - baseW * scale) / 2;
    const offsetY = (h - baseH * scale) / 2;
    this.ctx.translate(offsetX, offsetY);
    this.ctx.scale(scale, scale);

    // 1. Spores melayang di udara
    this.drawSpores();

    // 1b. Partikel cuaca musiman (kelopak, cahaya hangat, daun gugur, salju)
    this.drawSeasonalParticles();

    // 2. Pulau Isometrik (Base geometry 1:1 Figma isometric_island_base.svg)
    this.drawIsometricIsland();

    // 3. Pohon, Tunas, dan Momo dengan Y-depth sorting
    this.drawDepthSortedEntities();

    // 4. Efek Rintik Gerimis Hujan saat mode ambient rain
    if (this.ambientMode === 'rain') {
      this.drawRain();
    }

    this.ctx.restore();
  }

  private drawSeasonalParticles() {
    this.ctx.save();
    for (const p of this.seasonalParticles) {
      this.ctx.fillStyle = p.color;
      this.ctx.globalAlpha = p.opacity;
      this.ctx.fillRect(Math.round(p.x), Math.round(p.y), Math.round(p.size), Math.round(p.size));
    }
    this.ctx.restore();
  }

  private drawRain() {
    this.ctx.save();
    this.ctx.strokeStyle = 'rgba(168, 217, 230, 0.45)';
    this.ctx.lineWidth = 1.2;
    this.ctx.beginPath();
    for (const drop of this.rainDrops) {
      this.ctx.moveTo(drop.x, drop.y);
      this.ctx.lineTo(drop.x - drop.length * 0.4, drop.y + drop.length);
    }
    this.ctx.stroke();
    this.ctx.restore();
  }

  private drawSpores() {
    for (const s of this.spores) {
      this.ctx.fillStyle = `rgba(196, 245, 155, ${s.opacity})`;
      this.ctx.fillRect(Math.round(s.x), Math.round(s.y), 2, 2);
    }
  }

  /**
   * Menggambar pulau isometrik 1:1 sesuai isometric_island_base.svg dari Figma
   * Puncak atas (180, 24), Kanan (324, 84), Bawah (180, 144), Kiri (36, 84)
   */
  private drawIsometricIsland() {
    this.ctx.save();

    // Palet warna lanskap pulau sesuai musim aktif
    let cliffL = '#8C6438';
    let cliffR = '#604B2D';
    let overhangL = '#86A731';
    let overhangR = '#6F8F28';
    let cliffTexL = '#A57E42';
    let cliffTexR = '#7C6338';
    let baseGrass = '#B0CE48';
    let tileEven = '#B9D752';
    let tileOdd = '#AAC63D';

    if (this.currentSeason === 'summer') {
      cliffL = '#7A5228';
      cliffR = '#523A1D';
      overhangL = '#386641';
      overhangR = '#2D5333';
      cliffTexL = '#8F6635';
      cliffTexR = '#684725';
      baseGrass = '#4A7C59';
      tileEven = '#52B788';
      tileOdd = '#40916C';
    } else if (this.currentSeason === 'autumn') {
      cliffL = '#7A481F';
      cliffR = '#583212';
      overhangL = '#A36224';
      overhangR = '#854C19';
      cliffTexL = '#945C27';
      cliffTexR = '#6B3C16';
      baseGrass = '#C28835';
      tileEven = '#B4782A';
      tileOdd = '#9C631E';
    } else if (this.currentSeason === 'winter') {
      cliffL = '#6E5540';
      cliffR = '#4A3B2C';
      overhangL = '#E2E8F0'; // Lapisan salju tebing
      overhangR = '#CBD5E1';
      cliffTexL = '#876D55';
      cliffTexR = '#5F4D3B';
      baseGrass = '#D8E2DC'; // Tanah beku bersalju
      tileEven = '#C4D4C8';
      tileOdd = '#B2C2B6';
    }

    // 1. Tebing tanah kiri & kanan
    this.ctx.fillStyle = cliffL;
    this.ctx.beginPath();
    this.ctx.moveTo(36, 84);
    this.ctx.lineTo(180, 144);
    this.ctx.lineTo(180, 156);
    this.ctx.lineTo(36, 96);
    this.ctx.closePath();
    this.ctx.fill();

    this.ctx.fillStyle = cliffR;
    this.ctx.beginPath();
    this.ctx.moveTo(180, 144);
    this.ctx.lineTo(324, 84);
    this.ctx.lineTo(324, 96);
    this.ctx.lineTo(180, 156);
    this.ctx.closePath();
    this.ctx.fill();

    // 2. Overhang rumput hijau / lapisan salju
    this.ctx.fillStyle = overhangL;
    this.ctx.beginPath();
    this.ctx.moveTo(36, 84);
    this.ctx.lineTo(180, 144);
    this.ctx.lineTo(180, 148);
    this.ctx.lineTo(36, 88);
    this.ctx.closePath();
    this.ctx.fill();

    this.ctx.fillStyle = overhangR;
    this.ctx.beginPath();
    this.ctx.moveTo(180, 144);
    this.ctx.lineTo(324, 84);
    this.ctx.lineTo(324, 88);
    this.ctx.lineTo(180, 148);
    this.ctx.closePath();
    this.ctx.fill();

    // 3. Tekstur tanah tebing
    this.ctx.fillStyle = cliffTexL;
    for (let i = 0; i < 11; i++) {
      const sx = 48 + i * 10;
      const sy = 89 + i * 4.15;
      this.ctx.fillRect(Math.round(sx), Math.round(sy), 4, 4);
    }
    this.ctx.fillStyle = cliffTexR;
    for (let i = 0; i < 11; i++) {
      const sx = 190 + i * 10;
      const sy = 146 - i * 4.15;
      this.ctx.fillRect(Math.round(sx), Math.round(sy), 4, 3);
    }

    // 4. Dasar rumput pulau hijau
    this.ctx.fillStyle = baseGrass;
    this.ctx.beginPath();
    this.ctx.moveTo(180, 24);
    this.ctx.lineTo(324, 84);
    this.ctx.lineTo(180, 144);
    this.ctx.lineTo(36, 84);
    this.ctx.closePath();
    this.ctx.fill();

    // 5. Grid ubin 6x6 berpola kotak selang-seling
    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < 6; c++) {
        const x = 180 + (c - r) * 24;
        const y = 24 + (c + r + 1) * 10;

        const isEven = (r + c) % 2 === 0;
        this.ctx.fillStyle = isEven ? tileEven : tileOdd;

        this.ctx.beginPath();
        this.ctx.moveTo(x, y - 10);
        this.ctx.lineTo(x + 24, y);
        this.ctx.lineTo(x, y + 10);
        this.ctx.lineTo(x - 24, y);
        this.ctx.closePath();
        this.ctx.fill();
      }
    }

    // 6. Empat petak tengah (2,2)-(3,3) memakai aturan warna dasar yang sama
    // dengan seluruh grid (pola selang-seling di atas). Overlay kerikil khusus
    // sengaja dihilangkan agar permukaan pulau konsisten di semua musim.
    // Jalur koordinat berjalan Momo di tengah tetap dipertahankan.

    this.ctx.restore();
  }

  /**
   * Y-Depth Sorting untuk semua pohon permanen, tunas aktif, dan Momo
   */
  private drawDepthSortedEntities() {
    const getTilePos = (r: number, c: number) => ({
      x: 180 + (c - r) * 24,
      y: 24 + (c + r + 1) * 10,
    });

    interface DrawableEntity {
      type: 'tree' | 'sprout' | 'momo';
      x: number;
      y: number;
      sortY: number;
      treeType?: 'oak' | 'pine';
      scale?: number;
      sproutProgress?: number;
      sway?: number;
    }

    const entities: DrawableEntity[] = [];

    // Efek angin lembut sesekali
    const globalWindSway = Math.floor(this.frameCount / 90) % 2 === 1 ? Math.round(Math.sin(this.frameCount * 0.25)) : 0;

    // 1. Hanya gambar pohon dari generasi aktif (generasi sebelumnya diarsipkan)
    const currentGenTrees = this.getCurrentGenTrees();
    currentGenTrees.forEach((tree, idx) => {
      const pos = getTilePos(tree.gridR, tree.gridC);
      const treePhase = (idx + Math.floor(this.frameCount / 90)) % 3;
      const treeSway = treePhase === 0 ? Math.round(Math.sin(this.frameCount * 0.18)) : 0;
      entities.push({
        type: 'tree',
        x: pos.x,
        y: pos.y + 2,
        sortY: pos.y + 2,
        treeType: tree.treeType,
        scale: 1.0,
        sway: treeSway,
      });
    });

    // 2. Tambahkan tunas aktif sesi fokus jika ada
    if (this.activeSprout) {
      const slot = PLANTING_SLOTS[this.activeSprout.slotIndex];
      const pos = getTilePos(slot.r, slot.c);

      if (this.activeSprout.isBlooming) {
        // Tunas sedang mekar menjadi pohon utuh
        const bloomScale = 0.5 + (1 - this.activeSprout.bloomTimer / 48) * 0.5;
        entities.push({
          type: 'tree',
          x: pos.x,
          y: pos.y + 2,
          sortY: pos.y + 2,
          treeType: slot.type,
          scale: bloomScale,
          sway: 0,
        });
      } else {
        entities.push({
          type: 'sprout',
          x: pos.x,
          y: pos.y + 2,
          sortY: pos.y + 2,
          sproutProgress: this.activeSprout.progress,
          sway: globalWindSway,
        });
      }
    }

    // 3. Posisi Momo dengan 3 variasi tarian musik, langkah jalan, dan istirahat
    const momoPos = getTilePos(this.currentPos.r, this.currentPos.c);
    const stepBob = this.isWalking ? Math.abs(Math.sin(this.frameCount * 0.35)) * 2 : 0;
    const idleBob = Math.sin(this.frameCount * 0.15) * 1.5;

    let musicXBob = 0;
    let musicYBob = 0;
    let musicTilt = 0;

    if (this.isMusicPlaying) {
      const dancePhase = Math.floor((this.frameCount % 360) / 120);
      if (dancePhase === 0) {
        // Variasi 1: Mengangguk (head-bobbing naik turun ritmis)
        musicYBob = -Math.abs(Math.sin(this.frameCount * 0.35)) * 3;
      } else if (dancePhase === 1) {
        // Variasi 2: Goyang kanan-kiri (swaying kiri-kanan dengan kemiringan lembut)
        musicXBob = Math.sin(this.frameCount * 0.22) * 2.5;
        musicYBob = -Math.abs(Math.cos(this.frameCount * 0.22)) * 1.5;
        musicTilt = Math.sin(this.frameCount * 0.22) * 0.08;
      } else {
        // Variasi 3: Mengetuk kaki (foot tapping hop cepat)
        const tapCycle = this.frameCount % 16;
        musicYBob = tapCycle < 6 ? -2.2 : 0;
      }
    }

    const yBob = this.isWalking ? -stepBob : this.isMusicPlaying ? musicYBob : idleBob;

    entities.push({
      type: 'momo',
      x: momoPos.x + musicXBob,
      y: momoPos.y,
      sortY: momoPos.y,
      scale: yBob,
      sway: musicTilt,
    });

    // Urutkan entitas dari belakang ke depan (Y-sorting)
    entities.sort((a, b) => a.sortY - b.sortY);

    // Render masing-masing entitas
    for (const e of entities) {
      if (e.type === 'tree') {
        if (e.treeType === 'oak') {
          drawOakTree(this.ctx, e.x, e.y, e.scale || 1, e.sway || 0, this.currentSeason);
        } else {
          drawPineTree(this.ctx, e.x, e.y, e.scale || 1, e.sway || 0, this.currentSeason);
        }
      } else if (e.type === 'sprout') {
        drawSproutProgress(this.ctx, e.x, e.y, e.sproutProgress || 0.1, e.sway || 0);
      } else if (e.type === 'momo') {
        this.drawMomo(e.x, e.y, this.facingRight, e.scale || 0, e.sway || 0);
      }
    }
  }

  private drawMomo(x: number, y: number, facingRight: boolean, _yBob: number = 0, tilt: number = 0) {
    this.ctx.save();
    this.ctx.translate(Math.round(x), Math.round(y));

    // Bayangan elips Momo di permukaan tanah
    this.ctx.fillStyle = 'rgba(31, 64, 36, 0.28)';
    this.ctx.beginPath();
    this.ctx.ellipse(0, 0, 11, 3.5, 0, 0, Math.PI * 2);
    this.ctx.fill();

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let momoTilt = tilt;
    if (this.activeSeasonalAction === 'winter_snow_shake' && !prefersReducedMotion) {
      momoTilt += Math.sin(this.seasonalActionTimer * 1.5) * 0.14;
    }

    if (momoTilt !== 0) {
      this.ctx.rotate(momoTilt);
    }

    // Tentukan aksi Momo v2 dari state animasi aktif
    let action: MomoV2Action = 'idle';
    const frameDurationTicks = 3; // 8 frame/detik sesuai spesifikasi Figma (24 fps / 8 = 3 tick per frame)

    if (this.celebrationTimer > 0) {
      action = 'celebrate';
    } else if (this.waveTimer > 0) {
      action = 'wave';
    } else if (this.activeSeasonalAction) {
      action = 'idle';
    } else if (this.isWalking) {
      action = 'walk';
    } else if (this.isMusicPlaying) {
      action = 'dance';
    } else if (this.hydrationTimer > 0 || this.momoMood === 'hydrated') {
      action = 'drink';
    } else if (this.songFinishedTimer > 0 || this.momoMood === 'resting' || this.ambientMode === 'stream') {
      action = 'sleep';
    } else if (this.activeSprout && this.activeSprout.progress < 0.2) {
      action = 'plant';
    } else if (this.momoMood === 'happy') {
      action = 'celebrate';
    }

    const frameIdx = Math.floor(this.frameCount / frameDurationTicks) % 8;
    const scale = 0.52;
    const drawW = 64 * scale;
    const drawH = 64 * scale;

    // Garis tanah y=64 pada kanvas 64x64, sehingga destY harus bergeser -drawH agar kaki menyentuh y=0
    const destX = -drawW / 2;
    const destY = -drawH + 3;

    const seasonalActionProgress = this.activeSeasonalAction
      ? 1 - this.seasonalActionTimer / this.seasonalActionDuration
      : 0;

    drawMomoV2(
      this.ctx,
      action,
      frameIdx,
      destX,
      destY,
      scale,
      !facingRight,
      this.currentSeason,
      {
        snowLevel: this.snowAccumulationLevel,
        seasonalAction: this.activeSeasonalAction,
        seasonalActionProgress,
        reducedMotion: Boolean(prefersReducedMotion),
      }
    );

    // Satu atau dua not musik pixel melayang saat musik diputar
    if (this.isMusicPlaying) {
      for (const note of this.musicNotes) {
        this.ctx.fillStyle = `rgba(196, 245, 155, ${note.opacity})`;
        this.ctx.font = 'bold 9px monospace';
        this.ctx.fillText(note.symbol, Math.round(note.x * 1.5), Math.round(note.y * 1.5 - 10));
      }
    }

    this.ctx.restore();
  }
}
