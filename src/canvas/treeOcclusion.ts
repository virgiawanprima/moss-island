import { TREE_BOUNDS, type TreeType } from './treeSprites';

export interface TreePlacement {
  x: number;
  y: number;
  treeType: TreeType;
  scale: number;
}

const OCCLUSION_THRESHOLD = 0.3;

function coveredFraction(front: { left: number; right: number; top: number; bottom: number }, rear: { left: number; right: number; top: number; bottom: number }): number {
  const width = Math.max(0, Math.min(front.right, rear.right) - Math.max(front.left, rear.left));
  const height = Math.max(0, Math.min(front.bottom, rear.bottom) - Math.max(front.top, rear.top));
  const area = (rear.right - rear.left) * (rear.bottom - rear.top);
  return area > 0 ? width * height / area : 0;
}

function treeBounds(tree: TreePlacement) {
  const [halfWidth, height] = TREE_BOUNDS[tree.treeType];
  return { left: tree.x - halfWidth * tree.scale, right: tree.x + halfWidth * tree.scale,
    top: tree.y - height * tree.scale, bottom: tree.y };
}

export function coversRearTree(front: TreePlacement, rear: TreePlacement): boolean {
  if (front.y <= rear.y) return false;
  return coveredFraction(treeBounds(front), treeBounds(rear)) >= OCCLUSION_THRESHOLD;
}

export function shouldFadeTree(tree: TreePlacement, trees: TreePlacement[]): boolean {
  return trees.some(rear => coversRearTree(tree, rear))
    && !trees.some(front => coversRearTree(front, tree));
}

export function coversMomo(tree: TreePlacement, momo: { x: number; y: number }): boolean {
  if (tree.y <= momo.y) return false;
  return coveredFraction(treeBounds(tree), {
    left: momo.x - 7, right: momo.x + 7, top: momo.y - 24, bottom: momo.y,
  }) >= OCCLUSION_THRESHOLD;
}

export function getTreeOpacity(tree: TreePlacement, trees: TreePlacement[], momo: { x: number; y: number }, beingTended: boolean): number {
  if (beingTended) return 1;
  return shouldFadeTree(tree, trees) || coversMomo(tree, momo) ? 0.55 : 1;
}
