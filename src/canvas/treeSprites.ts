// ============================================================================
// TREE SPRITES & PROCEDURAL RENDERING PERSIS FIGMA
// Mendukung:
// 1. Oak Tree (Pohon rindang bulat berundak dari panel_focus.png)
// 2. Pine Tree (Pohon cemara runcing 3 tingkat dari tree_mature.svg)
// 3. Sprout / Sapling (Tunas benih bertumbuh dari tree_sprout.svg)
// ============================================================================

import { IslandSeason } from '../types';

export type TreeType = 'oak' | 'pine';

export function drawSproutProgress(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  progress: number, // 0.0 sampai 1.0
  windSway: number = 0
) {
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));

  // 1. Gundukan tanah tempat menanam (#AF8055)
  ctx.fillStyle = '#8C6438';
  ctx.fillRect(-6, -2, 12, 3);
  ctx.fillStyle = '#AF8055';
  ctx.fillRect(-4, -4, 8, 3);

  // 2. Tunas benih bertumbuh sesuai progres
  if (progress > 0.05) {
    // Batang tunas kecil
    const stemHeight = Math.min(8, Math.round(4 + progress * 4));
    ctx.fillStyle = '#71BA83';
    ctx.fillRect(-1 + windSway, -4 - stemHeight, 2, stemHeight);

    // Daun tunas
    ctx.fillStyle = '#C4F59B';
    if (progress < 0.4) {
      // Benih bertunas 1 kuncup
      ctx.fillRect(-2 + windSway, -5 - stemHeight, 4, 3);
    } else if (progress < 0.8) {
      // 2 helai daun kecil
      ctx.fillRect(-4 + windSway, -6 - stemHeight, 3, 2);
      ctx.fillRect(1 + windSway, -6 - stemHeight, 3, 2);
      ctx.fillRect(-1 + windSway, -7 - stemHeight, 2, 3);
    } else {
      // Tunas daun rimbun siap mekar
      ctx.fillRect(-5 + windSway, -7 - stemHeight, 4, 3);
      ctx.fillRect(1 + windSway, -7 - stemHeight, 4, 3);
      ctx.fillRect(-2 + windSway, -9 - stemHeight, 4, 4);
    }
  }

  ctx.restore();
}

export function drawOakTree(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number = 1,
  sway: number = 0,
  season: IslandSeason = 'spring'
) {
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  ctx.scale(scale, scale);

  // Batang pohon cokelat kayu
  ctx.fillStyle = '#604B2D';
  ctx.fillRect(-2, -8, 4, 8);
  ctx.fillStyle = '#8C6438';
  ctx.fillRect(-1, -8, 2, 7);

  // Palet dedaunan oak sesuai musim
  let shadowColor = '#71BA83';
  let midColor = '#B9D752';
  let highlightColor = '#C4F59B';
  let textureColor = '#AAC63D';

  if (season === 'summer') {
    shadowColor = '#1B4332';
    midColor = '#2D6A4F';
    highlightColor = '#52B788';
    textureColor = '#40916C';
  } else if (season === 'autumn') {
    shadowColor = '#9A3412';
    midColor = '#D97706';
    highlightColor = '#FBBF24';
    textureColor = '#B45309';
  } else if (season === 'winter') {
    shadowColor = '#1E3F20';
    midColor = '#2D5A27';
    highlightColor = '#E2E8F0';
    textureColor = '#CBD5E1';
  }

  // Lapisan bayangan bawah mahkota
  ctx.fillStyle = shadowColor;
  ctx.fillRect(-9 + sway, -20, 18, 12);
  ctx.fillRect(-11 + sway, -18, 22, 8);

  // Lapisan tengah mahkota
  ctx.fillStyle = midColor;
  ctx.fillRect(-8 + sway, -23, 16, 12);
  ctx.fillRect(-10 + sway, -21, 20, 8);

  // Highlight mahkota atas
  ctx.fillStyle = highlightColor;
  ctx.fillRect(-6 + sway, -25, 12, 5);
  ctx.fillRect(-7 + sway, -23, 14, 3);
  ctx.fillRect(-4 + sway, -26, 8, 2);

  // Titik tekstur dedaunan
  ctx.fillStyle = textureColor;
  ctx.fillRect(-5 + sway, -16, 3, 3);
  ctx.fillRect(2 + sway, -17, 3, 2);
  ctx.fillRect(-1 + sway, -21, 3, 2);

  // Sentuhan khusus musim
  if (season === 'spring') {
    // Bunga mekar kecil merah muda di dedaunan
    ctx.fillStyle = '#FFAAA6';
    ctx.fillRect(-6 + sway, -20, 2, 2);
    ctx.fillRect(4 + sway, -18, 2, 2);
    ctx.fillRect(-1 + sway, -24, 2, 2);
  } else if (season === 'winter') {
    // Tumpukan salju di pucuk mahkota oak
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(-5 + sway, -26, 10, 3);
    ctx.fillRect(-7 + sway, -24, 4, 2);
    ctx.fillRect(3 + sway, -24, 4, 2);
  }

  ctx.restore();
}

export function drawPineTree(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number = 1,
  sway: number = 0,
  season: IslandSeason = 'spring'
) {
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  ctx.scale(scale, scale);

  // Batang pinus
  ctx.fillStyle = '#604B2D';
  ctx.fillRect(-2, -6, 4, 6);
  ctx.fillStyle = '#8C6438';
  ctx.fillRect(-1, -6, 2, 5);

  let t1Base = '#1E3823';
  let t1Hi = '#71BA83';
  let t2Base = '#26472D';
  let t2Hi = '#71BA83';
  let t3Base = '#315C3A';
  let t3Hi = '#C4F59B';
  let tipColor = '#C4F59B';

  if (season === 'summer') {
    t1Base = '#132E18';
    t1Hi = '#2D6A4F';
    t2Base = '#1B4332';
    t2Hi = '#40916C';
    t3Base = '#2D6A4F';
    t3Hi = '#52B788';
    tipColor = '#74C69D';
  } else if (season === 'autumn') {
    t1Base = '#3E3B18';
    t1Hi = '#707A30';
    t2Base = '#4D5624';
    t2Hi = '#928929';
    t3Base = '#636629';
    t3Hi = '#B8A038';
    tipColor = '#D97706';
  } else if (season === 'winter') {
    t1Base = '#1B3224';
    t1Hi = '#E2E8F0';
    t2Base = '#224230';
    t2Hi = '#F1F5F9';
    t3Base = '#2C543D';
    t3Hi = '#FFFFFF';
    tipColor = '#FFFFFF';
  }

  // Tingkat 1 (Bawah)
  ctx.fillStyle = t1Base;
  ctx.fillRect(-8 + sway, -12, 16, 6);
  ctx.fillStyle = t1Hi;
  ctx.fillRect(-7 + sway, -12, 14, 2);

  // Tingkat 2 (Tengah)
  ctx.fillStyle = t2Base;
  ctx.fillRect(-6 + sway, -18, 12, 6);
  ctx.fillStyle = t2Hi;
  ctx.fillRect(-5 + sway, -18, 10, 2);

  // Tingkat 3 (Atas)
  ctx.fillStyle = t3Base;
  ctx.fillRect(-4 + sway, -24, 8, 6);
  ctx.fillStyle = t3Hi;
  ctx.fillRect(-3 + sway, -24, 6, 2);

  // Pucuk cemara
  ctx.fillStyle = tipColor;
  ctx.fillRect(-1 + sway, -26, 2, 2);

  ctx.restore();
}
