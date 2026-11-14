import type { GardenWaypoint } from './gardening';

interface Tile { r: number; c: number }
const key = ({ r, c }: Tile) => `${r}:${c}`;

/** Kunjungi petak yang dapat dicapai dalam urutan acak, lewat tetangga tanpa menembus tanaman. */
export function buildWanderRoute(start: Tile, occupied: Tile[], random: () => number = Math.random): GardenWaypoint[] {
  const blocked = new Set(occupied.map(key));
  const goals: Tile[] = [];
  for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) {
    if (!blocked.has(key({ r, c }))) goals.push({ r, c });
  }
  for (let i = goals.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.max(0, Math.floor(random() * (i + 1))));
    [goals[i], goals[j]] = [goals[j], goals[i]];
  }
  let current = { r: Math.max(0, Math.min(5, Math.round(start.r))), c: Math.max(0, Math.min(5, Math.round(start.c))) };
  const route: GardenWaypoint[] = [];
  for (const goal of goals) {
    const queue: Tile[] = [current];
    const parents = new Map<string, Tile | null>([[key(current), null]]);
    for (let i = 0; i < queue.length && !parents.has(key(goal)); i++) {
      const tile = queue[i];
      for (const next of [{ r: tile.r + 1, c: tile.c }, { r: tile.r - 1, c: tile.c },
        { r: tile.r, c: tile.c + 1 }, { r: tile.r, c: tile.c - 1 }]) {
        if (next.r < 0 || next.r > 5 || next.c < 0 || next.c > 5 || blocked.has(key(next)) || parents.has(key(next))) continue;
        parents.set(key(next), tile);
        queue.push(next);
      }
    }
    if (!parents.has(key(goal))) continue;
    const path: Tile[] = [];
    for (let tile: Tile | null = goal; tile && key(tile) !== key(current); tile = parents.get(key(tile)) ?? null) path.push(tile);
    path.reverse().forEach(tile => route.push({ ...tile, waitFrames: 0 }));
    if (path.length) route[route.length - 1].waitFrames = 12 + Math.floor(random() * 25);
    current = goal;
  }
  return route;
}
