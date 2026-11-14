import type { PlantedTree } from '../types';
import type { GardenAction } from './gardening';
export interface CareJob { target: { r: number; c: number }; actions: GardenAction[]; treeId?: string }
export class GardenSchedule {
  public active = false;
  private clock = 0;
  private sproutDue = Infinity;
  private treeDue = 90;
  private sproutKey: string | null = null;
  private initial = false;
  private bag: string[] = [];
  constructor(private random: () => number = Math.random) {}
  setSprout(key: string | null) {
    if (key === this.sproutKey) return;
    this.sproutKey = key; this.initial = key !== null;
    this.sproutDue = key === null ? Infinity : this.clock;
  }
  start() { this.active = true; }
  finish() { this.active = false; }
  next(seconds: number, enabled: boolean, trees: PlantedTree[], sprout?: { r: number; c: number }): CareJob | null {
    if (!enabled) return null;
    this.clock += Number.isFinite(seconds) ? Math.min(0.25, Math.max(0, seconds)) : 0;
    if (this.active) return null;
    if (sprout && this.sproutKey !== null && this.clock + 1e-7 >= this.sproutDue) {
      const actions: GardenAction[] = this.initial ? ['water', 'fertilize'] : ['water'];
      this.initial = false; this.sproutDue = this.clock + 60; this.active = true;
      return { target: sprout, actions };
    }
    if (trees.length && this.clock + 1e-7 >= this.treeDue) {
      this.bag = this.bag.filter(id => trees.some(tree => tree.id === id));
      if (!this.bag.length) {
        this.bag = trees.map(tree => tree.id);
        for (let i = this.bag.length - 1; i > 0; i--) {
          const j = Math.min(i, Math.floor(this.random() * (i + 1)));
          [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]];
        }
      }
      const id = this.bag.shift()!;
      const tree = trees.find(tree => tree.id === id)!;
      this.treeDue = this.clock + 90; this.active = true;
      return { target: { r: tree.gridR, c: tree.gridC }, actions: ['water', 'fertilize'], treeId: id };
    }
    return null;
  }
}
