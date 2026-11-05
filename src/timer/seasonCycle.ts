import type { IslandSeason, SeasonMode, PhaseType } from '../types';

export function seasonAfterPhase(current: IslandSeason, mode: SeasonMode, phase: PhaseType, skipped = false): IslandSeason {
  if (mode !== 'cycle' || phase !== 'focus' || skipped) return current;
  const seasons: IslandSeason[] = ['spring', 'summer', 'autumn', 'winter'];
  return seasons[(seasons.indexOf(current) + 1) % seasons.length];
}
