/**
 * Identitas Sumber Media Moss Island
 * Memisahkan APLIKASI SUMBER (Opera, Spotify Desktop, dll.) dari LAYANAN
 * (Spotify terverifikasi, media web, atau tidak diketahui).
 *
 * Aturan kejujuran:
 * - Keberadaan judul/artis BUKAN bukti sumbernya Spotify.
 * - Kata "spotify" pada judul lagu BUKAN bukti tunggal layanan Spotify.
 * - GSMTC (Windows System Media Transport Controls) tidak menyediakan
 *   identitas situs web, sehingga Spotify Web di Opera tidak dapat
 *   diverifikasi hanya dari ID aplikasi Opera. Untuk verifikasi nyata,
 *   diperlukan integrasi browser (mis. ekstensi) yang menandai sesi —
 *   representasinya sudah disiapkan lewat service "spotify_web_verified".
 */

export type MediaServiceKind =
  | 'spotify_desktop'
  | 'spotify_web_verified'
  | 'web_media'
  | 'native_app'
  | 'unknown';

export interface MediaSourceTrackInfo {
  source_app?: string;
  source_display_name?: string;
  service_kind?: string;
  has_session?: boolean;
}

export interface MediaSourceIdentity {
  /** Nama aplikasi sumber yang ramah, mis. "Opera", "Spotify" */
  appName: string;
  /** Klasifikasi layanan yang jujur */
  service: MediaServiceKind;
  /** Label badge utama panel musik, mis. "SPOTIFY", "OPERA · MEDIA WEB" */
  badgeText: string;
  /** true hanya jika layanan Spotify benar-benar terverifikasi */
  isSpotifyVerified: boolean;
}

const UNKNOWN_IDENTITY: MediaSourceIdentity = {
  appName: 'Tidak Diketahui',
  service: 'unknown',
  badgeText: 'SISTEM MEDIA',
  isSpotifyVerified: false,
};

/**
 * Menurunkan identitas aplikasi dari AUMID mentah (fallback jika Rust
 * belum mengirim source_display_name, mis. binari lama).
 */
export function deriveAppNameFromAppId(appId: string | undefined): string {
  if (!appId || appId.trim().length === 0) return '';
  const low = appId.toLowerCase();
  const known: Array<[string, string]> = [
    ['spotify', 'Spotify'],
    ['opera', 'Opera'],
    ['msedge', 'Edge'],
    ['microsoft edge', 'Edge'],
    ['chrome', 'Chrome'],
    ['firefox', 'Firefox'],
    ['brave', 'Brave'],
    ['vivaldi', 'Vivaldi'],
    ['windowsmediaplayer', 'Media Player'],
    ['zunemusic', 'Groove Music'],
    ['itunes', 'iTunes'],
    ['foobar', 'foobar2000'],
    ['vlc', 'VLC'],
  ];
  for (const [needle, name] of known) {
    if (low.includes(needle)) return name;
  }
  const tail = appId.split(/[\\!/]/).pop()?.trim() || '';
  return tail;
}

export function resolveMediaSourceIdentity(track: MediaSourceTrackInfo | null): MediaSourceIdentity {
  if (!track || track.has_session === false) {
    return { ...UNKNOWN_IDENTITY };
  }

  const serviceKind = (track.service_kind || '').trim() as MediaServiceKind;
  const rawApp = (track.source_app || '').trim();
  const appName =
    (track.source_display_name || '').trim() || deriveAppNameFromAppId(rawApp) || 'Tidak Diketahui';

  switch (serviceKind) {
    case 'spotify_desktop':
      // AUMID benar-benar Spotify (aplikasi desktop resmi)
      return {
        appName: 'Spotify',
        service: 'spotify_desktop',
        badgeText: 'SPOTIFY',
        isSpotifyVerified: true,
      };
    case 'spotify_web_verified':
      // Sesi web Spotify yang diverifikasi oleh integrasi browser eksplisit
      return {
        appName,
        service: 'spotify_web_verified',
        badgeText: `SPOTIFY · ${appName.toUpperCase()}`,
        isSpotifyVerified: true,
      };
    case 'web_media': {
      // Browser umum memutar media web; identitas situs tidak tersedia dari sistem.
      // JANGAN mengklaim Spotify hanya karena judul/artis terisi.
      const upper = appName.toUpperCase();
      return {
        appName,
        service: 'web_media',
        badgeText: upper === 'TIDAK DIKETAHUI' ? 'MEDIA WEB' : `${upper} · MEDIA WEB`,
        isSpotifyVerified: false,
      };
    }
    case 'native_app':
      return {
        appName,
        service: 'native_app',
        badgeText: appName.toUpperCase(),
        isSpotifyVerified: false,
      };
    default:
      return { ...UNKNOWN_IDENTITY };
  }
}

/** Dekode base64 menjadi bytes (untuk membungkus artwork sesi menjadi Blob). */
export function base64ToBytes(base64: string): Uint8Array | null {
  if (!base64 || base64.length === 0) return null;
  try {
    const clean = base64.replace(/[\r\n\s]/g, '');
    const atobFn: (s: string) => string =
      typeof atob === 'function'
        ? atob
        : (s: string) => Buffer.from(s, 'base64').toString('binary');
    const binary = atobFn(clean);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

/**
 * Membungkus data gambar base64 menjadi object URL (blob:).
 * Mengembalikan null bila data tidak valid atau lingkungan tidak mendukung.
 * Pemanggil wajib mencabut URL dengan URL.revokeObjectURL saat tidak dipakai.
 */
export function base64ToBlobUrl(base64: string, mimeType: string): string | null {
  const bytes = base64ToBytes(base64);
  if (!bytes || bytes.length === 0) return null;
  if (typeof Blob === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) {
    return null;
  }
  try {
    const bufferCopy = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(bufferCopy).set(bytes);
    const blob = new Blob([bufferCopy], { type: mimeType || 'image/png' });
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}
