export type DockEdge = 'top' | 'bottom' | 'left' | 'right';
export type DockPlacement = DockEdge | 'floating';

export interface WorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function nearestDockEdge(x: number, y: number, area: WorkArea): DockEdge {
  const distances: [DockEdge, number][] = [
    ['top', Math.abs(y - area.y)],
    ['bottom', Math.abs(y - (area.y + area.height))],
    ['left', Math.abs(x - area.x)],
    ['right', Math.abs(x - (area.x + area.width))],
  ];
  return distances.reduce((closest, candidate) => candidate[1] < closest[1] ? candidate : closest)[0];
}

export function dockWithinThreshold(x: number, y: number, area: WorkArea, size = { width: 0, height: 0 }): DockPlacement {
  if (area.width <= 0 || area.height <= 0 || !Number.isFinite(x + y)) return 'floating';
  const distances: [DockEdge, number][] = [
    ['top', Math.max(0, y - size.height / 2 - area.y) / area.height],
    ['bottom', Math.max(0, area.y + area.height - y - size.height / 2) / area.height],
    ['left', Math.max(0, x - size.width / 2 - area.x) / area.width],
    ['right', Math.max(0, area.x + area.width - x - size.width / 2) / area.width],
  ];
  const nearest = distances.reduce((a, b) => b[1] < a[1] ? b : a);
  return nearest[1] <= 0.1 ? nearest[0] : 'floating';
}

export function isVerticalDock(edge: DockPlacement): boolean {
  return edge === 'left' || edge === 'right';
}
