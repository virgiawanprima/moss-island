// ============================================================================
// MOMO SEASON ACCESSORIES & SEASONAL ANIMATIONS
// Pakaian musiman modular dan animasi khas Momo per musim.
// Desain asli Momo dari Figma PAT (64x64 pixel art) dipertahankan sebagai dasar.
// Seluruh aksesori terikat pada koordinat kepala dan pose frame (bukan koordinat statis).
// ============================================================================

import { MomoV2Action } from './momoV2Atlas';
import { IslandSeason } from '../types';

export type MomoSeasonalAction =
  | 'spring_inspect'
  | 'spring_sniff'
  | 'summer_fan'
  | 'summer_wipe'
  | 'autumn_catch'
  | 'autumn_admire'
  | 'winter_warm_hands'
  | 'winter_snow_shake';

export interface MomoFrameAnchor {
  sproutX: number;
  sproutY: number;
  headTopY: number;
  eyesY: number;
  neckY: number;
  bodyOffsetY: number;
}

export interface MomoSeasonRenderOptions {
  snowLevel?: number; // 0: bersih, 1: tipis, 2: sedang, 3: tumpukan tebal
  seasonalAction?: MomoSeasonalAction | null;
  seasonalActionProgress?: number; // 0.0 s/d 1.0
  reducedMotion?: boolean;
}

/**
 * Mendapatkan koordinat jangkar Momo per frame untuk sinkronisasi aksesori
 */
export function getMomoFrameAnchor(action: MomoV2Action, frameIndex: number): MomoFrameAnchor {
  const safeIdx = Math.abs(frameIndex) % 8;
  
  // Dance dan celebrate memiliki gerak naik-turun tubuh 1-2 pixel
  if (action === 'dance' || action === 'celebrate') {
    const yOffsets = [0, -1, -2, -1, 0, -1, -2, -1];
    const off = yOffsets[safeIdx];
    return {
      sproutX: 28,
      sproutY: 16 + off,
      headTopY: 4 + off,
      eyesY: 32 + off,
      neckY: 44 + off,
      bodyOffsetY: off,
    };
  }

  return {
    sproutX: 28,
    sproutY: 16,
    headTopY: 4,
    eyesY: 32,
    neckY: 44,
    bodyOffsetY: 0,
  };
}

/**
 * Menggambar lapisan aksesori dan pakaian musim di atas kanvas 64x64 Momo
 */
export function drawMomoSeasonLayer(
  ctx: CanvasRenderingContext2D,
  action: MomoV2Action,
  frameIndex: number,
  season: IslandSeason,
  options: MomoSeasonRenderOptions = {}
): void {
  const anchor = getMomoFrameAnchor(action, frameIndex);
  const reducedMotion = options.reducedMotion ?? false;
  const snowLevel = options.snowLevel ?? 0;
  const seasonalAction = options.seasonalAction ?? null;
  const actionProg = options.seasonalActionProgress ?? 0;

  ctx.save();
  ctx.imageSmoothingEnabled = false;

  switch (season) {
    case 'spring':
      drawSpringAccessories(ctx, anchor, seasonalAction, actionProg, reducedMotion);
      break;
    case 'summer':
      drawSummerAccessories(ctx, anchor, seasonalAction, actionProg, reducedMotion);
      break;
    case 'autumn':
      drawAutumnAccessories(ctx, anchor, seasonalAction, actionProg, reducedMotion);
      break;
    case 'winter':
      drawWinterAccessories(ctx, anchor, snowLevel, seasonalAction, actionProg, reducedMotion);
      break;
  }

  ctx.restore();
}

// ----------------------------------------------------------------------------
// 1. MUSIM SEMI (SPRING)
// Aksesori: Bunga sakura mekar di samping tunas kepala Momo (tunas tetap utuh)
// Gerakan khas: spring_inspect (mengamati bunga) & spring_sniff (mencium wangi bunga)
// ----------------------------------------------------------------------------
function drawSpringAccessories(
  ctx: CanvasRenderingContext2D,
  anchor: MomoFrameAnchor,
  seasonalAction: MomoSeasonalAction | null,
  prog: number,
  reducedMotion: boolean
): void {
  // Bunga mungil di samping tunas kepala (x: 35, y: 15 relatif anchor)
  const fx = anchor.sproutX + 7;
  const fy = anchor.sproutY + 1;

  // Daun kecil di samping bunga
  ctx.fillStyle = '#4ADE80';
  ctx.fillRect(fx + 2, fy + 1, 2, 2);

  // Kelopak bunga sakura merah muda
  ctx.fillStyle = '#FFB7C5';
  ctx.fillRect(fx - 1, fy - 2, 3, 2); // kelopak atas
  ctx.fillRect(fx - 2, fy, 2, 3);     // kelopak kiri
  ctx.fillRect(fx + 1, fy, 2, 3);     // kelopak kanan
  ctx.fillRect(fx - 1, fy + 2, 3, 2); // kelopak bawah

  // Putik tengah bunga warna kuning cerah
  ctx.fillStyle = '#FDE047';
  ctx.fillRect(fx, fy, 2, 2);

  // Efek aksi khas musim semi
  if (seasonalAction === 'spring_inspect') {
    // Kuncup bunga mungil merekah di tanah di depan Momo
    const budX = 46;
    const budY = 56 + anchor.bodyOffsetY;
    ctx.fillStyle = '#16A34A';
    ctx.fillRect(budX, budY, 2, 4); // tangkai
    ctx.fillStyle = '#F472B6';
    const budSize = prog > 0.5 ? 4 : 3;
    ctx.fillRect(budX - 1, budY - budSize, budSize, budSize); // kelopak merekah
  } else if (seasonalAction === 'spring_sniff') {
    // Momo memegang tangkai bunga kecil di dekat wajah
    const handX = 38;
    const handY = anchor.eyesY + 4;
    ctx.fillStyle = '#15803D';
    ctx.fillRect(handX, handY, 2, 4); // tangkai
    ctx.fillStyle = '#FB7185';
    ctx.fillRect(handX - 1, handY - 2, 4, 3); // bunga

    // Partikel aroma wangi melayang
    if (!reducedMotion) {
      const scentY = handY - 4 - Math.round(prog * 8);
      ctx.fillStyle = 'rgba(251, 113, 133, 0.75)';
      ctx.fillRect(handX + 1, scentY, 2, 2);
      ctx.fillRect(handX + 4, scentY - 3, 2, 2);
    }
  }
}

// ----------------------------------------------------------------------------
// 2. MUSIM PANAS (SUMMER)
// Aksesori: Topi jerami anyaman berpita dengan lubang di puncak untuk tunas Momo
// Gerakan khas: summer_fan (mengipas diri) & summer_wipe (menyeka keringat)
// ----------------------------------------------------------------------------
function drawSummerAccessories(
  ctx: CanvasRenderingContext2D,
  anchor: MomoFrameAnchor,
  seasonalAction: MomoSeasonalAction | null,
  prog: number,
  reducedMotion: boolean
): void {
  const hatY = anchor.headTopY + 12; // y sekitar 16
  const strawYellow = '#F4D06F';
  const strawShadow = '#D4A343';
  const ribbonRed = '#DC2626';

  // 1. Tepi topi lebar (brim) menaungi dahi Momo
  ctx.fillStyle = strawYellow;
  ctx.fillRect(16, hatY + 4, 32, 3);
  ctx.fillStyle = strawShadow;
  ctx.fillRect(16, hatY + 6, 32, 1);

  // 2. Mahkota topi sisi kiri (sebelum lubang tunas)
  ctx.fillStyle = strawYellow;
  ctx.fillRect(20, hatY, 8, 4);
  // Mahkota topi sisi kanan (setelah lubang tunas)
  ctx.fillRect(36, hatY, 8, 4);

  // Catatan: Area x: 28 s/d 36 sengaja dibiarkan terbuka sehingga tunas asli Momo menyembul bebas keluar!

  // 3. Pita topi merah melingkari pangkal mahkota topi
  ctx.fillStyle = ribbonRed;
  ctx.fillRect(20, hatY + 3, 8, 2);
  ctx.fillRect(36, hatY + 3, 8, 2);
  // Ujung pita menjuntai kecil di sisi kanan
  ctx.fillRect(44, hatY + 4, 2, 3);

  // Efek aksi khas musim panas
  if (seasonalAction === 'summer_fan') {
    // Daun hijau lebar sebagai kipas
    const fanAngle = reducedMotion ? 0 : Math.sin(prog * Math.PI * 4) * 0.25;
    const fanX = 42;
    const fanY = anchor.eyesY + 2;

    ctx.save();
    ctx.translate(fanX, fanY);
    ctx.rotate(fanAngle);
    // Tangkai kipas daun
    ctx.fillStyle = '#854D0E';
    ctx.fillRect(-1, 0, 2, 6);
    // Daun lebar
    ctx.fillStyle = '#22C55E';
    ctx.fillRect(-4, -6, 8, 6);
    ctx.fillStyle = '#15803D';
    ctx.fillRect(-1, -6, 2, 6); // tulang daun
    ctx.restore();

    // Hembusan angin sepoi
    if (!reducedMotion) {
      ctx.fillStyle = 'rgba(147, 197, 253, 0.7)';
      ctx.fillRect(28, anchor.eyesY + 4, 4, 1);
      ctx.fillRect(26, anchor.eyesY + 7, 3, 1);
    }
  } else if (seasonalAction === 'summer_wipe') {
    // Tangan Momo menyeka dahi
    const wipeY = anchor.eyesY - 2;
    ctx.fillStyle = '#71BA83'; // warna lengan asli Momo
    ctx.fillRect(36, wipeY, 4, 3);
    // Bintik keringat berkilau
    if (prog < 0.6) {
      ctx.fillStyle = '#60A5FA';
      ctx.fillRect(32, anchor.eyesY - 3, 2, 2);
    }
  }
}

// ----------------------------------------------------------------------------
// 3. MUSIM GUGUR (AUTUMN)
// Aksesori: Topi rajut baret ochre & syal rajut terakota di leher
// Gerakan khas: autumn_catch (menangkap daun melayang) & autumn_admire (mengamati daun)
// ----------------------------------------------------------------------------
function drawAutumnAccessories(
  ctx: CanvasRenderingContext2D,
  anchor: MomoFrameAnchor,
  seasonalAction: MomoSeasonalAction | null,
  prog: number,
  reducedMotion: boolean
): void {
  // 1. Topi rajut baret tipis di kepala dengan lubang untuk tunas
  const beretY = anchor.headTopY + 12;
  const ochre = '#D97706';
  const ochreDark = '#9A3412';

  // Sisi kiri baret
  ctx.fillStyle = ochre;
  ctx.fillRect(20, beretY + 1, 8, 4);
  // Sisi kanan baret
  ctx.fillRect(36, beretY + 1, 8, 4);
  // Bayangan lipatan baret
  ctx.fillStyle = ochreDark;
  ctx.fillRect(20, beretY + 4, 8, 1);
  ctx.fillRect(36, beretY + 4, 8, 1);

  // 2. Syal rajut terakota melingkar di leher Momo
  const scarfY = anchor.neckY;
  const terracotta = '#C85A32';
  const terraDark = '#9A3412';
  const fringeGold = '#FDBA74';

  // Lilitan syal di leher
  ctx.fillStyle = terracotta;
  ctx.fillRect(20, scarfY - 1, 24, 4);
  ctx.fillStyle = terraDark;
  ctx.fillRect(24, scarfY - 1, 2, 4);
  ctx.fillRect(32, scarfY - 1, 2, 4);
  ctx.fillRect(40, scarfY - 1, 2, 4);

  // Ujung syal menjuntai di dada kanan dengan rumbai
  ctx.fillStyle = terracotta;
  ctx.fillRect(36, scarfY + 3, 5, 5);
  ctx.fillStyle = fringeGold;
  ctx.fillRect(36, scarfY + 8, 5, 2); // rumbai

  // Efek aksi khas musim gugur
  if (seasonalAction === 'autumn_catch') {
    // Daun jingga melayang turun mendekati tangan Momo
    const leafY = reducedMotion ? anchor.eyesY + 4 : anchor.eyesY - 8 + Math.round(prog * 12);
    ctx.fillStyle = '#EA580C';
    ctx.fillRect(32, leafY, 4, 3);
    ctx.fillStyle = '#FBBF24';
    ctx.fillRect(33, leafY + 1, 2, 1); // urat daun
  } else if (seasonalAction === 'autumn_admire') {
    // Momo memegang daun di depan dada sambil tersenyum
    const leafX = 30;
    const leafY = anchor.neckY + 5;
    ctx.fillStyle = '#F97316';
    ctx.fillRect(leafX, leafY, 4, 4);
    ctx.fillStyle = '#FDE047';
    ctx.fillRect(leafX + 1, leafY + 1, 2, 2);
  }
}

// ----------------------------------------------------------------------------
// 4. MUSIM DINGIN (WINTER)
// Aksesori: Jaket musim dingin puffer, syal tebal salju, penutup telinga bulu,
//            serta akumulasi salju menumpuk di kepala.
// Gerakan khas: winter_warm_hands (menghangatkan tangan) & winter_snow_shake (merontokkan salju)
// ----------------------------------------------------------------------------
function drawWinterAccessories(
  ctx: CanvasRenderingContext2D,
  anchor: MomoFrameAnchor,
  snowLevel: number,
  seasonalAction: MomoSeasonalAction | null,
  prog: number,
  reducedMotion: boolean
): void {
  // 1. Jaket musim dingin (winter puffer jacket) membungkus badan Momo
  const jacketTopY = anchor.neckY + 2;
  const jacketBlue = '#2563EB';
  const jacketDark = '#1D4ED8';
  const furWhite = '#F8FAFC';
  const furShadow = '#CBD5E1';
  const goldButton = '#FBBF24';

  // Badan jaket (mengikuti kontur tubuh Momo)
  ctx.fillStyle = jacketBlue;
  ctx.fillRect(18, jacketTopY, 28, 10);
  ctx.fillStyle = jacketDark;
  ctx.fillRect(18, jacketTopY + 4, 28, 1); // garis segmen puffer 1
  ctx.fillRect(18, jacketTopY + 8, 28, 1); // garis segmen puffer 2

  // Garis resleting tengah
  ctx.fillStyle = furShadow;
  ctx.fillRect(31, jacketTopY, 2, 10);

  // Kancing emas mungil
  ctx.fillStyle = goldButton;
  ctx.fillRect(31, jacketTopY + 2, 2, 2);
  ctx.fillRect(31, jacketTopY + 6, 2, 2);

  // 2. Syal tebal wol salju di sekeliling leher
  const scarfY = anchor.neckY - 1;
  ctx.fillStyle = furWhite;
  ctx.fillRect(18, scarfY, 28, 4);
  ctx.fillStyle = furShadow;
  ctx.fillRect(18, scarfY + 3, 28, 1);
  // Simpul syal musim dingin
  ctx.fillStyle = furWhite;
  ctx.fillRect(24, scarfY + 4, 6, 5);
  ctx.fillStyle = furShadow;
  ctx.fillRect(24, scarfY + 8, 6, 1);

  // Trim bulu di ujung bawah jaket
  ctx.fillStyle = furWhite;
  ctx.fillRect(18, jacketTopY + 10, 28, 2);

  // 3. Penutup telinga berbulu (fluffy earmuffs) di pelipis kiri dan kanan
  const earY = anchor.eyesY - 3;
  // Bando penghubung melengkung di belakang tunas kepala
  ctx.fillStyle = '#64748B';
  ctx.fillRect(16, anchor.headTopY + 14, 32, 2);

  // Earmuff kiri
  ctx.fillStyle = furWhite;
  ctx.fillRect(12, earY, 5, 6);
  ctx.fillStyle = furShadow;
  ctx.fillRect(12, earY + 4, 5, 2);

  // Earmuff kanan
  ctx.fillStyle = furWhite;
  ctx.fillRect(47, earY, 5, 6);
  ctx.fillStyle = furShadow;
  ctx.fillRect(47, earY + 4, 5, 2);

  // 4. Salju menumpuk di atas kepala Momo (snow accumulation)
  drawHeadSnowAccumulation(ctx, anchor, snowLevel);

  // Efek aksi khas musim dingin
  if (seasonalAction === 'winter_warm_hands') {
    // Momo merapatkan tangan di depan mulut
    const handX = 29;
    const handY = anchor.eyesY + 6;
    ctx.fillStyle = '#71BA83';
    ctx.fillRect(handX, handY, 6, 3);

    // Uap napas hangat (steam vapor) naik perlahan
    if (!reducedMotion) {
      const steamY = handY - 3 - Math.round(prog * 6);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
      ctx.fillRect(handX + 1, steamY, 2, 2);
      ctx.fillRect(handX + 3, steamY - 2, 2, 2);
      ctx.fillRect(handX + 2, steamY - 4, 2, 2);
    }
  } else if (seasonalAction === 'winter_snow_shake') {
    // Butiran salju rontok dari kepala saat menggoyangkan kepala
    if (!reducedMotion && prog > 0.2 && prog < 0.8) {
      const dropProg = (prog - 0.2) / 0.6;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(20, anchor.headTopY + 16 + Math.round(dropProg * 14), 2, 2);
      ctx.fillRect(26, anchor.headTopY + 14 + Math.round(dropProg * 12), 2, 2);
      ctx.fillRect(36, anchor.headTopY + 14 + Math.round(dropProg * 12), 2, 2);
      ctx.fillRect(42, anchor.headTopY + 16 + Math.round(dropProg * 14), 2, 2);
    }
  }
}

/**
 * Menggambar akumulasi salju yang menumpuk di atas kepala Momo
 */
function drawHeadSnowAccumulation(
  ctx: CanvasRenderingContext2D,
  anchor: MomoFrameAnchor,
  level: number
): void {
  if (level <= 0) return;

  const yBase = anchor.headTopY + 14;
  const snowWhite = '#FFFFFF';
  const snowShadow = '#BFDBFE';

  if (level === 1) {
    // Level 1: butiran salju tipis (dusting)
    ctx.fillStyle = snowWhite;
    ctx.fillRect(22, yBase + 1, 3, 2);
    ctx.fillRect(26, yBase, 2, 2);
    ctx.fillRect(36, yBase, 2, 2);
    ctx.fillRect(39, yBase + 1, 3, 2);
  } else if (level === 2) {
    // Level 2: lapisan salju sedang
    ctx.fillStyle = snowWhite;
    ctx.fillRect(20, yBase, 8, 3);
    ctx.fillRect(36, yBase, 8, 3);
    ctx.fillStyle = snowShadow;
    ctx.fillRect(20, yBase + 2, 8, 1);
    ctx.fillRect(36, yBase + 2, 8, 1);
  } else if (level >= 3) {
    // Level 3: gundukan salju tebal empuk
    ctx.fillStyle = snowWhite;
    ctx.fillRect(18, yBase - 2, 10, 5);
    ctx.fillRect(36, yBase - 2, 10, 5);
    ctx.fillRect(22, yBase - 4, 5, 2); // puncak kiri
    ctx.fillRect(37, yBase - 4, 5, 2); // puncak kanan
    // Bayangan biru es lembut di dasar salju
    ctx.fillStyle = snowShadow;
    ctx.fillRect(18, yBase + 2, 10, 1);
    ctx.fillRect(36, yBase + 2, 10, 1);
  }
}
