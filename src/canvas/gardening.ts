import type { PlantedTree } from '../types';

export type GardenAction = 'water' | 'fertilize';
export interface GardenWaypoint {
  r: number;
  c: number;
  waitFrames: number;
  action?: GardenAction;
  targetR?: number;
  targetC?: number;
  treeId?: string;
}

export function buildGardenRoute(trees: PlantedTree[], sprout?: { r: number; c: number }): GardenWaypoint[] {
  const route: GardenWaypoint[] = [];
  const stop = (r: number, c: number, action: GardenAction, treeId?: string) => {
    // Jumlah r+c tetap agar kaki Momo sejajar dengan pangkal tanaman pada proyeksi isometrik.
    const side = c >= r ? 1 : -1;
    route.push({
      r: r + side * 0.65,
      c: c - side * 0.65,
      waitFrames: 88,
      action, targetR: r, targetC: c, treeId,
    });
  };
  if (sprout) {
    stop(sprout.r, sprout.c, 'water');
    stop(sprout.r, sprout.c, 'fertilize');
  }
  const ordered = [...trees].sort((a, b) =>
    Math.atan2(a.gridR - 2.5, a.gridC - 2.5) - Math.atan2(b.gridR - 2.5, b.gridC - 2.5));
  for (const tree of ordered) {
    stop(tree.gridR, tree.gridC, 'water', tree.id);
    stop(tree.gridR, tree.gridC, 'fertilize', tree.id);
  }
  return route;
}
