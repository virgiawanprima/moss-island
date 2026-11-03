import type { PlantedTree } from '../types';

export type GardenAction = 'plant' | 'water' | 'fertilize';
export interface GardenWaypoint {
  r: number;
  c: number;
  waitFrames: number;
  action?: GardenAction;
  targetR?: number;
  targetC?: number;
  treeId?: string;
}

export function buildGardenRoute(trees: PlantedTree[], sprout?: { r: number; c: number }, includePlant = true): GardenWaypoint[] {
  const route: GardenWaypoint[] = [];
  const stop = (r: number, c: number, action: GardenAction, treeId?: string) => {
    route.push({
      r: r + Math.sign(2.5 - r) * 0.65,
      c: c + Math.sign(2.5 - c) * 0.65,
      waitFrames: action === 'plant' ? 96 : 88,
      action, targetR: r, targetC: c, treeId,
    });
  };
  if (sprout) {
    if (includePlant) stop(sprout.r, sprout.c, 'plant');
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
