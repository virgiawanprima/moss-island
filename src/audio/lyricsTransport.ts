import { isTauri } from '../storage';

let cooldownUntil = 0;

export class LyricsCooldownError extends Error {
  constructor(public readonly retryAt: number, public readonly status: number) {
    super(`LRCLIB HTTP ${status}: layanan meminta penundaan`);
  }
}

export function retryAfterMilliseconds(value: string | null, now: number): number {
  if (!value?.trim()) return 0;
  const text = value.trim();
  if (/^\d+$/.test(text)) {
    const seconds = Number(text);
    return Number.isFinite(seconds) ? Math.min(seconds * 1000, Number.MAX_SAFE_INTEGER - now) : 0;
  }
  const date = Date.parse(text);
  return Number.isFinite(date) ? Math.max(0, date - now) : 0;
}

export function resetLyricsCooldownForTests() { cooldownUntil = 0; }

export async function requestLyrics(endpoint: 'get' | 'search', params: URLSearchParams) {
  if (Date.now() < cooldownUntil) throw new LyricsCooldownError(cooldownUntil, 429);
  let response: { ok: boolean; status: number; json(): Promise<unknown>; retryAfter: string | null };
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    const result = await invoke<{ status: number; body: unknown; retry_after?: string | null }>('fetch_lyrics', {
      endpoint,
      params: Array.from(params.entries()),
    });
    if (!result || typeof result.status !== 'number') throw new Error('Respons layanan lirik tidak valid');
    response = { ok: result.status === 200, status: result.status, json: async () => result.body, retryAfter: result.retry_after ?? null };
  } else {
    const result = await fetch(`https://lrclib.net/api/${endpoint}?${params}`, { signal: AbortSignal.timeout(12_000) });
    response = { ok: result.ok, status: result.status, json: () => result.json(), retryAfter: result.headers?.get('Retry-After') ?? null };
  }
  if (response.status === 429 || response.status === 503) {
    const now = Date.now();
    const delay = Math.max(5000, retryAfterMilliseconds(response.retryAfter, now));
    cooldownUntil = Math.max(cooldownUntil, now + delay + Math.floor(Math.random() * Math.min(1000, delay * 0.1)));
    throw new LyricsCooldownError(cooldownUntil, response.status);
  }
  return response;
}
