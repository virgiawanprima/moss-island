import { IslandSeason, TreeSpecies } from '../types';

export type TreeType = TreeSpecies;
export const TREE_BOUNDS: Record<TreeType, readonly [number, number]> = {
  banana: [24, 46], mango: [17, 39], durian: [16, 46], palm: [24, 50], guava: [16, 32],
};
type Point = readonly [number, number];

const foliage = {
  spring: { edge: '#153E32', dark: '#205C42', base: '#348454', light: '#69AF76', glint: '#A8D99D' },
  summer: { edge: '#102F2C', dark: '#174D40', base: '#286D51', light: '#4C9970', glint: '#8DC8A0' },
  autumn: { edge: '#4A2826', dark: '#7D352B', base: '#B75635', light: '#DD8B50', glint: '#F2BF83' },
  winter: { edge: '#193D3C', dark: '#24564F', base: '#387465', light: '#6A9F8C', glint: '#D0E7DF' },
} as const;

function polygon(ctx: CanvasRenderingContext2D, color: string, points: readonly Point[]) {
  ctx.fillStyle = color;
  ctx.beginPath();
  points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.closePath();
  ctx.fill();
}

function groundShadow(ctx: CanvasRenderingContext2D, radius: number) {
  ctx.fillStyle = 'rgba(12, 32, 26, 0.25)';
  ctx.beginPath();
  ctx.ellipse(4, 1, radius, 3.5, -0.18, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(12, 32, 26, 0.3)';
  ctx.beginPath();
  ctx.ellipse(0, 0, 4, 2, 0, 0, Math.PI * 2);
  ctx.fill();
}

function trunk(ctx: CanvasRenderingContext2D, height: number, width = 6) {
  const left = -Math.floor(width / 2);
  polygon(ctx, '#382C25', [[left, -height], [left + width, -height], [left + width, -2], [left + width + 2, 1], [left - 2, 1], [left, -3]]);
  ctx.fillStyle = '#785237';
  ctx.fillRect(left + 1, -height, width - 2, height);
  ctx.fillStyle = '#B58B59';
  ctx.fillRect(left + 1, -height, 2, height - 2);
  ctx.fillStyle = '#4B3829';
  for (let y = -height + 3; y < -2; y += 5) ctx.fillRect(left + 3, y, 2, 2);
  polygon(ctx, '#785237', [[-2, -3], [-5, 0], [-5, 1], [0, 0], [4, 1], [5, 0], [2, -3]]);
}

function leafCluster(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, season: IslandSeason) {
  const p = foliage[season];
  ctx.save();
  ctx.translate(x, y);
  polygon(ctx, p.edge, [[-size + 2, -3], [-size, 0], [-size, 6], [-size + 4, 10], [size - 3, 10], [size, 6], [size, -1], [size - 4, -5], [-size + 5, -5]]);
  polygon(ctx, p.base, [[-size + 3, -3], [-size + 1, 1], [-size + 1, 5], [-size + 4, 7], [size - 3, 7], [size - 1, 4], [size - 1, 0], [size - 4, -3]]);
  polygon(ctx, p.dark, [[1, 0], [size - 4, -3], [size - 1, 0], [size - 1, 5], [size - 4, 8], [-1, 8], [3, 4]]);
  polygon(ctx, p.light, [[-size + 4, -3], [-size + 2, 0], [-size + 2, 3], [-3, 2], [1, -2], [-1, -4]]);
  ctx.fillStyle = p.glint;
  ctx.fillRect(-size + 5, -3, 4, 1);
  ctx.fillRect(-size + 3, 0, 2, 2);
  ctx.fillStyle = p.light;
  ctx.fillRect(2, 4, 2, 1);
  ctx.fillStyle = p.dark;
  ctx.fillRect(-4, 5, 2, 2);
  ctx.restore();
}

export function drawMangoTree(ctx: CanvasRenderingContext2D, x: number, y: number, scale = 1, sway = 0, season: IslandSeason = 'spring') {
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  ctx.scale(scale, scale);
  groundShadow(ctx, 13);
  trunk(ctx, 17, 7);
  polygon(ctx, '#63452F', [[-1, -12], [-9, -20], [-7, -22], [1, -16], [7, -23], [9, -21], [3, -12]]);
  ctx.translate(Math.round(sway), 0);
  const greenSeason = season === 'autumn' ? 'summer' : season;
  leafCluster(ctx, 6, -23, 9, greenSeason);
  leafCluster(ctx, -5, -23, 10, greenSeason);
  leafCluster(ctx, 0, -31, 10, greenSeason);
  leafCluster(ctx, -8, -29, 6, greenSeason);
  for (const [fx, fy] of season === 'summer' || season === 'autumn' ? [[-8, -18], [6, -16], [2, -25]] : []) {
    polygon(ctx, '#76532F', [[fx, fy - 2], [fx + 3, fy - 1], [fx + 4, fy + 3], [fx + 1, fy + 5], [fx - 1, fy + 2]]);
    polygon(ctx, '#DBAB4E', [[fx, fy - 1], [fx + 2, fy], [fx + 2, fy + 3], [fx, fy + 3]]);
    ctx.fillStyle = '#A9C56A';
    ctx.fillRect(fx, fy - 1, 2, 2);
  }
  if (season === 'spring') {
    ctx.fillStyle = '#DCD8A2';
    ctx.fillRect(-8, -28, 2, 2);
    ctx.fillRect(5, -22, 2, 2);
    ctx.fillStyle = '#F3EAC8';
    ctx.fillRect(-7, -28, 1, 1);
  } else if (season === 'winter') {
    polygon(ctx, '#E2F0E8', [[-6, -34], [-2, -36], [5, -34], [7, -31], [1, -31], [-3, -32], [-7, -31]]);
    ctx.fillStyle = '#A5C8BF';
    ctx.fillRect(-10, -29, 4, 2);
    ctx.fillRect(4, -24, 5, 2);
  }
  drawSeasonAccents(ctx, 'mango', season);
  ctx.restore();
}

export function drawDurianTree(ctx: CanvasRenderingContext2D, x: number, y: number, scale = 1, sway = 0, season: IslandSeason = 'spring') {
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  ctx.scale(scale, scale);
  groundShadow(ctx, 13);
  trunk(ctx, 24, 7);
  polygon(ctx, '#4B3829', [[0, -15], [-8, -28], [-6, -29], [2, -20], [8, -31], [10, -29], [3, -15]]);
  ctx.translate(Math.round(sway), 0);
  const green = season === 'autumn' ? 'summer' : season;
  leafCluster(ctx, 0, -40, 7, green);
  leafCluster(ctx, -5, -33, 9, green);
  leafCluster(ctx, 6, -31, 8, green);
  for (const [fx, fy] of season === 'summer' || season === 'autumn' ? [[-6, -20], [5, -15]] : []) {
    ctx.fillStyle = '#7B633B';
    ctx.fillRect(fx, fy - 5, 1, 6);
    polygon(ctx, '#34472A', [[fx - 4, fy], [fx - 3, fy - 3], [fx - 1, fy - 2], [fx + 1, fy - 3], [fx + 4, fy], [fx + 3, fy + 5], [fx, fy + 7], [fx - 4, fy + 4]]);
    polygon(ctx, '#839E49', [[fx - 3, fy], [fx - 1, fy - 2], [fx + 1, fy - 1], [fx + 2, fy + 3], [fx, fy + 5], [fx - 3, fy + 3]]);
    ctx.fillStyle = '#C3CA75';
    for (const [dx, dy] of [[-2, 0], [0, 2], [-2, 4], [2, 0]]) ctx.fillRect(fx + dx, fy + dy, 1, 1);
    ctx.fillStyle = '#516735';
    ctx.fillRect(fx + 2, fy + 4, 2, 1);
  }
  drawSeasonAccents(ctx, 'durian', season);
  ctx.restore();
}

export function drawGuavaTree(ctx: CanvasRenderingContext2D, x: number, y: number, scale = 1, sway = 0, season: IslandSeason = 'spring') {
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  ctx.scale(scale, scale);
  groundShadow(ctx, 12);
  trunk(ctx, 16, 5);
  polygon(ctx, '#916E4D', [[0, -10], [-9, -21], [-7, -22], [1, -15], [7, -23], [8, -21], [2, -10]]);
  ctx.translate(Math.round(sway), 0);
  const green = season === 'autumn' ? 'spring' : season;
  leafCluster(ctx, -6, -24, 8, green);
  leafCluster(ctx, 6, -23, 8, green);
  leafCluster(ctx, 0, -27, 8, green);
  for (const [fx, fy] of season === 'summer' || season === 'autumn' ? [[-8, -18], [7, -16], [0, -25]] : []) {
    polygon(ctx, '#4E6B31', [[fx - 2, fy - 2], [fx + 2, fy - 2], [fx + 3, fy], [fx + 2, fy + 3], [fx - 2, fy + 3], [fx - 3, fy]]);
    ctx.fillStyle = '#C6D36E';
    ctx.fillRect(fx - 1, fy - 1, 3, 3);
    ctx.fillStyle = '#E7E5A9';
    ctx.fillRect(fx - 1, fy - 1, 1, 1);
    ctx.fillStyle = '#72573B';
    ctx.fillRect(fx, fy + 2, 1, 1);
  }
  if (season === 'spring') {
    ctx.fillStyle = '#F1EADB';
    ctx.fillRect(-10, -24, 2, 2);
    ctx.fillRect(6, -27, 2, 2);
  }
  drawSeasonAccents(ctx, 'guava', season);
  ctx.restore();
}

export function drawBananaTree(ctx: CanvasRenderingContext2D, x: number, y: number, scale = 1, sway = 0, season: IslandSeason = 'spring') {
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  ctx.scale(scale, scale);
  groundShadow(ctx, 14);
  polygon(ctx, '#34513A', [[-4, 0], [-3, -27], [2, -32], [5, -26], [4, 0]]);
  polygon(ctx, '#7D9B59', [[-2, 0], [-2, -25], [1, -30], [2, -23], [1, 0]]);
  ctx.fillStyle = '#B8C789';
  ctx.fillRect(-2, -23, 1, 21);
  ctx.fillStyle = '#6A7049';
  ctx.fillRect(2, -15, 2, 10);
  ctx.fillRect(-3, -7, 3, 2);
  ctx.translate(Math.round(sway), -27);
  const leaves: Point[][] = [
    [[0, 0], [-8, -14], [-19, -15], [-23, -10], [-18, -8], [-12, -9]],
    [[0, 0], [7, -14], [17, -17], [23, -14], [20, -9], [12, -9]],
    [[0, 0], [-12, -5], [-22, 0], [-23, 7], [-17, 4], [-8, -1]],
    [[0, 0], [13, -4], [23, 2], [22, 8], [17, 4], [7, 0]],
    [[-1, -1], [-5, -13], [-2, -19], [2, -18], [4, -9], [2, 0]],
  ];
  const p = foliage[season === 'winter' ? 'winter' : 'spring'];
  leaves.forEach((points, i) => {
    polygon(ctx, p.edge, points);
    polygon(ctx, i % 2 ? p.base : p.light, points.map(([lx, ly]) => [Math.round(lx * 0.87), Math.round(ly * 0.83)] as Point));
  });
  ctx.strokeStyle = '#ACCD80';
  ctx.lineWidth = 1;
  for (const [lx, ly] of [[-20, -11], [20, -12], [-20, 3], [20, 4], [0, -17]]) {
    ctx.beginPath(); ctx.moveTo(0, -1); ctx.lineTo(lx, ly); ctx.stroke();
  }
  ctx.fillStyle = '#7F6A35';
  ctx.fillRect(-6, 0, 2, 11);
  for (let row = 0; row < (season === 'summer' || season === 'autumn' ? 3 : 0); row++) {
    for (let fruit = 0; fruit < 3; fruit++) {
      const fx = -11 + fruit * 3 + row % 2;
      const fy = 3 + row * 4;
      polygon(ctx, '#8B7B32', [[fx, fy], [fx + 2, fy], [fx + 3, fy + 3], [fx + 1, fy + 4]]);
      ctx.fillStyle = '#E0C95C';
      ctx.fillRect(fx, fy, 2, 3);
      ctx.fillStyle = '#F4E39A';
      ctx.fillRect(fx, fy, 1, 2);
    }
  }
  if (season === 'spring' || season === 'summer') polygon(ctx, '#854953', [[-6, 15], [-3, 18], [-5, 22], [-8, 19]]);
  ctx.translate(0, 27);
  drawSeasonAccents(ctx, 'banana', season);
  ctx.restore();
}

export function drawPalmTree(ctx: CanvasRenderingContext2D, x: number, y: number, scale = 1, sway = 0, season: IslandSeason = 'spring') {
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  ctx.scale(scale, scale);
  groundShadow(ctx, 15);
  polygon(ctx, '#382C25', [[-3, 0], [-4, -12], [-2, -31], [3, -31], [3, -13], [5, 0]]);
  polygon(ctx, '#8E6340', [[-2, 0], [-3, -12], [-1, -31], [1, -31], [1, -12], [3, 0]]);
  polygon(ctx, '#C29765', [[-2, -1], [-3, -12], [-1, -30], [0, -30], [-1, -12], [0, -1]]);
  for (let row = -27; row < -2; row += 4) {
    polygon(ctx, '#49382B', [[-2, row], [1, row + 1], [3, row - 1], [3, row + 1], [0, row + 3], [-2, row + 2]]);
    ctx.fillStyle = '#BA8957';
    ctx.fillRect(-2, row - 1, 2, 1);
  }
  ctx.translate(Math.round(sway), -30);
  const p = foliage[season === 'autumn' ? 'summer' : season];
  const fronds: Point[][] = [
    [[0, 0], [-7, -8], [-17, -7], [-23, 0], [-23, 5], [-18, 0], [-8, -2]],
    [[0, 0], [7, -8], [17, -7], [23, 0], [23, 5], [18, 0], [8, -2]],
    [[0, 0], [-9, 1], [-16, 9], [-17, 17], [-13, 13], [-9, 7]],
    [[0, 0], [9, 1], [16, 9], [17, 17], [13, 13], [9, 7]],
    [[-2, 0], [-6, -10], [-3, -17], [1, -20], [4, -12], [2, 0]],
  ];
  fronds.forEach((points, i) => {
    polygon(ctx, p.edge, points);
    polygon(ctx, i % 2 ? p.base : p.light, points.map(([px, py]) => [Math.round(px * 0.88), Math.round(py * 0.83)] as Point));
  });
  ctx.strokeStyle = p.glint;
  ctx.lineWidth = 1;
  for (const end of [[-19, -3], [19, -3], [-14, 12], [14, 12], [0, -17]]) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(end[0], end[1]);
    ctx.stroke();
  }
  ctx.fillStyle = '#8D422D';
  ctx.fillRect(-6, -1, 6, 7);
  ctx.fillRect(1, 0, 6, 7);
  ctx.fillStyle = '#CD713C';
  for (const [fx, fy] of season === 'winter' ? [] : [[-5, 0], [-2, 3], [2, 1], [5, 4]]) {
    ctx.fillRect(fx, fy, 2, 2);
    ctx.fillStyle = '#E7A35A';
    ctx.fillRect(fx, fy, 1, 1);
    ctx.fillStyle = '#CD713C';
  }
  ctx.translate(0, 30);
  drawSeasonAccents(ctx, 'palm', season);
  ctx.restore();
}

export function treeSeasonTraits(type: TreeType, season: IslandSeason) {
  return { evergreen: true, fruit: season === 'summer' || season === 'autumn',
    bloom: season === 'spring' && type !== 'palm', snow: season === 'winter',
    coldSensitive: type === 'banana' || type === 'durian' || type === 'palm' };
}

const BASE_TREE_RENDERERS: Record<TreeType, typeof drawMangoTree> = {
  banana: drawBananaTree, mango: drawMangoTree, durian: drawDurianTree, palm: drawPalmTree, guava: drawGuavaTree,
};

function drawSeasonAccents(ctx: CanvasRenderingContext2D, type: TreeType, season: IslandSeason) {
    const traits = treeSeasonTraits(type, season);
    ctx.save();
    const [width, height] = TREE_BOUNDS[type];
    if (traits.bloom) {
      ctx.fillStyle = type === 'banana' ? '#A65B79' : type === 'durian' ? '#E7D8A4' : '#F1E6C8';
      ctx.fillRect(-width / 3, -height + 7, 2, 2); ctx.fillRect(width / 4, -height + 12, 2, 2);
    }
    if (season === 'autumn') {
      // Spesies tropis tetap berdaun; hanya beberapa ujung daun tua menguning.
      ctx.fillStyle = '#B8AD69'; ctx.fillRect(-width / 2 + 2, -height + 16, 3, 1);
      ctx.fillRect(width / 3, -height + 13, 2, 1);
      ctx.fillStyle = '#9C854E'; ctx.fillRect(8, 1, 3, 1);
    }
    if (traits.snow) {
      polygon(ctx, '#DFEDE6', [[-width / 3, -height + 7], [-width / 5, -height + 4], [width / 5, -height + 4], [width / 3, -height + 7]]);
      ctx.fillStyle = '#A2BEB7'; ctx.fillRect(-width / 3, -height + 7, width * 2 / 3, 1);
      if (traits.coldSensitive) { ctx.fillStyle = '#9B956D'; ctx.fillRect(width / 3, -height + 17, 3, 2); }
    }
    ctx.restore();
}
export const TREE_RENDERERS = BASE_TREE_RENDERERS;

export function drawSproutProgress(ctx: CanvasRenderingContext2D, x: number, y: number, progress: number, windSway = 0) {
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  groundShadow(ctx, 6);
  polygon(ctx, '#49382B', [[-7, -1], [-3, -4], [4, -4], [7, -1], [3, 2], [-4, 2]]);
  ctx.fillStyle = '#A67D50';
  ctx.fillRect(-3, -3, 5, 2);
  if (progress > 0.05) {
    const height = Math.round(4 + Math.min(1, progress) * 8);
    ctx.translate(Math.round(windSway), 0);
    ctx.fillStyle = '#184F37';
    ctx.fillRect(-1, -3 - height, 3, height);
    ctx.fillStyle = '#77B787';
    ctx.fillRect(-1, -3 - height, 1, height);
    polygon(ctx, '#286D49', [[0, -height], [-6, -height - 5], [-7, -height - 1], [-3, -height + 1]]);
    polygon(ctx, '#6DB87D', [[0, -height], [-6, -height - 5], [-4, -height - 2]]);
    if (progress >= 0.4) {
      polygon(ctx, '#1E573D', [[0, -height - 2], [5, -height - 7], [8, -height - 6], [6, -height - 2]]);
      polygon(ctx, '#95CEA0', [[1, -height - 3], [5, -height - 7], [6, -height - 5]]);
    }
    if (progress >= 0.8) {
      ctx.fillStyle = '#B5DBA4';
      ctx.fillRect(-1, -height - 8, 3, 4);
    }
  }
  ctx.restore();
}
