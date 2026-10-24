/**
 * Simulasi sesi media sistem untuk pengujian visual Moss Island.
 *
 * Diaktifkan HANYA lewat parameter URL pratinjau peramban:
 *   ?mockmedia=opera   -> Spotify Web di Opera (web_media, tidak terverifikasi)
 *   ?mockmedia=spotify -> Spotify Desktop (spotify_desktop, terverifikasi)
 *
 * Modul memasang __TAURI_INTERNALS__ tiruan sehingga SystemMediaBridge asli
 * memanggil command yang sama seperti di desktop. Tidak berpengaruh pada
 * aplikasi desktop Tauri sungguhan (instalasi dilewati bila Tauri asli ada).
 */

interface MockTrack {
  title: string;
  artist: string;
  album: string;
  durationSecs: number;
  recordKey: string;
  colors: [string, string];
}

let mockTracks: MockTrack[] = [];
let mockCurrentIdx = 0;
let mockIsPlaying = true;
let mockSeekBaseSecs = 0;
let mockLastResumeTime = 0;
let mockArtworkCache: string[] = [];
let mockRequestCount = 0;

function makeArtworkBase64(colors: [string, string], label: string): string {
  if (typeof document === 'undefined') return '';
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const grad = ctx.createLinearGradient(0, 0, 64, 64);
  grad.addColorStop(0, colors[0]);
  grad.addColorStop(1, colors[1]);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  // Pola pixel sederhana agar sampul mudah dibedakan antar rekaman
  ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
  for (let y = 0; y < 64; y += 8) {
    ctx.fillRect((y % 16 === 0 ? 4 : 12), y, 4, 4);
  }
  ctx.fillStyle = 'rgba(16, 25, 23, 0.8)';
  ctx.font = 'bold 11px monospace';
  ctx.fillText(label, 6, 58);
  const dataUrl = canvas.toDataURL('image/png');
  return dataUrl.replace('data:image/png;base64,', '');
}

function mockTrackPayload() {
  const track = mockTracks[mockCurrentIdx];
  const elapsed = mockIsPlaying ? (Date.now() - mockLastResumeTime) / 1000 : 0;
  const position = Math.min(track.durationSecs, mockSeekBaseSecs + elapsed);
  const isSpotifyDesktop = (window as unknown as { __MOCK_MEDIA_SPOTIFY?: boolean }).__MOCK_MEDIA_SPOTIFY === true;
  return {
    title: track.title,
    artist: track.artist,
    album: track.album,
    is_playing: mockIsPlaying,
    source_app: isSpotifyDesktop ? 'Spotify.exe' : 'OperaInternetBrowser.1655713752.3114608054!OperaStable',
    source_display_name: isSpotifyDesktop ? 'Spotify' : 'Opera',
    service_kind: isSpotifyDesktop ? 'spotify_desktop' : 'web_media',
    is_spotify: isSpotifyDesktop,
    has_session: true,
    session_key: 'media-session-sim-1',
    record_key: track.recordKey,
    has_thumbnail: true,
    position_secs: position,
    duration_secs: track.durationSecs,
  };
}

function mockArtworkPayload(recordKey: string) {
  const idx = mockTracks.findIndex((t) => t.recordKey === recordKey);
  if (idx === -1) return null;
  mockRequestCount++;
  return {
    session_key: 'media-session-sim-1',
    record_key: recordKey,
    artwork_key: `media-session-sim-1#${recordKey}`,
    data_base64: mockArtworkCache[idx],
    mime_type: 'image/png',
  };
}

/**
 * Memasang sesi media tiruan. Tidak melakukan apa pun bila mode kosong atau
 * Tauri desktop asli sudah terdeteksi.
 */
export function installMockMediaSession(mode: string | null): void {
  if (!mode || typeof window === 'undefined') return;
  if ('__TAURI_INTERNALS__' in window || '__TAURI__' in window) return;

  const isSpotifyDesktop = mode === 'spotify';
  (window as unknown as { __MOCK_MEDIA_SPOTIFY?: boolean }).__MOCK_MEDIA_SPOTIFY = isSpotifyDesktop;

  mockTracks = [
    {
      title: 'Midnight Fern',
      artist: 'Canopy Collective',
      album: 'Verdant Hours',
      durationSecs: 214,
      recordKey: 'midnight fern|canopy collective|verdant hours|1|214',
      colors: ['#2E7D52', '#A3E635'],
    },
    {
      title: 'Moss Ring (Live Session)',
      artist: 'Canopy Collective',
      album: 'Verdant Hours (Deluxe)',
      durationSecs: 189,
      recordKey: 'moss ring (live session)|canopy collective|verdant hours (deluxe)|2|189',
      colors: ['#B45309', '#FBBF24'],
    },
  ];
  mockArtworkCache = mockTracks.map((t, i) => makeArtworkBase64(t.colors, `SIM ${i + 1}`));
  mockCurrentIdx = 0;
  mockIsPlaying = true;
  mockSeekBaseSecs = 42;
  mockLastResumeTime = Date.now();

  const internals = {
    invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
      switch (cmd) {
        case 'get_system_media_track':
          return Promise.resolve(mockTrackPayload());
        case 'get_system_media_artwork':
          return Promise.resolve(
            mockArtworkPayload(String(args?.recordKey ?? ''))
          );
        case 'system_media_toggle_play':
          if (mockIsPlaying) {
            mockSeekBaseSecs = Math.min(
              mockTracks[mockCurrentIdx].durationSecs,
              mockSeekBaseSecs + (Date.now() - mockLastResumeTime) / 1000
            );
            mockIsPlaying = false;
          } else {
            mockLastResumeTime = Date.now();
            mockIsPlaying = true;
          }
          return Promise.resolve(true);
        case 'system_media_next':
          mockCurrentIdx = (mockCurrentIdx + 1) % mockTracks.length;
          mockSeekBaseSecs = 0;
          mockLastResumeTime = Date.now();
          return Promise.resolve(true);
        case 'system_media_prev':
          mockCurrentIdx = (mockCurrentIdx - 1 + mockTracks.length) % mockTracks.length;
          mockSeekBaseSecs = 0;
          mockLastResumeTime = Date.now();
          return Promise.resolve(true);
        case 'system_media_seek':
          mockSeekBaseSecs = Math.max(0, Number(args?.positionSecs ?? 0));
          mockLastResumeTime = Date.now();
          return Promise.resolve(true);
        default:
          // Command jendela/event/plugin lain: balas netral agar pratinjau tetap jalan
          return Promise.resolve(null);
      }
    },
    transformCallback(callback: unknown) {
      return typeof callback === 'function' ? -1 : Number(callback) || -1;
    },
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
  };
  Object.defineProperty(window, '__TAURI_INTERNALS__', { value: internals, configurable: true });
}
