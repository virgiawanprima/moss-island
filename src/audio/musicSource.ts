export function takeOverLocalPlayback(
  audio: { stop(): void },
  pauseClock: () => void,
  invalidateRequests: () => void,
) {
  invalidateRequests();
  audio.stop();
  pauseClock();
}

export function shouldIgnoreAmbiguousWebViewSession(
  sourceApp: string,
  selectedSession: string | null,
  localOwned: boolean,
): boolean {
  const basename = sourceApp.trim().replace(/\\/g, '/').split('/').pop()?.toLowerCase();
  return selectedSession === null && localOwned && basename === 'msedgewebview2.exe';
}
