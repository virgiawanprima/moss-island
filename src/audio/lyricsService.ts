/**
 * Layanan Metadata dan Lirik Musik Moss Island
 * Menampilkan informasi artis, judul, album, kutipan lirik akurat,
 * serta sampul dari sesi media aktif (fallback pencarian terverifikasi).
 */

import { base64ToBlobUrl } from './mediaSourceIdentity';

export interface SyncedLyricLine {
  timeSecs: number;
  text: string;
}

export interface ParsedLyricsData {
  isSynced: boolean;
  syncedLines: SyncedLyricLine[];
  plainLines: string[];
}

export interface LyricsLinesUpdate {
  line1: string;
  highlight: string;
  line2: string;
  incoming?: string;
  isSynced: boolean;
  isInstrumental?: boolean;
  isPlaying?: boolean;
  lineIndex?: number;
  totalLines?: number;
  transitionType?: 'step' | 'jump' | 'none';
}

export type ArtworkSource = 'session' | 'search' | 'ambient' | 'none';

export interface TrackArtworkInfo {
  albumArtUrl: string | null;
  artistPicUrl: string | null;
  title: string;
  artist: string;
  /** Asal gambar: sesi media aktif, hasil pencarian terverifikasi, ambient lokal, atau kosong */
  source: ArtworkSource;
  /** Identitas sesi+rekaman yang menghasilkan artwork ini (penjaga balapan) */
  artworkKey: string;
}

export interface SessionRecordMeta {
  title: string;
  artist: string;
  album?: string;
  durationSecs?: number;
}

export type LyricsCallback = (update: LyricsLinesUpdate) => void;
export type ArtworkCallback = (info: TrackArtworkInfo) => void;

/** Membuat object URL dari data artwork base64 sesi (null bila tidak didukung). */
function createSessionObjectUrl(dataBase64: string, mimeType: string): string | null {
  return base64ToBlobUrl(dataBase64, mimeType);
}

/** Mencabut object URL dengan aman saat tidak digunakan lagi. */
function revokeObjectUrlSafe(url: string): void {
  try {
    if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(url);
    }
  } catch {
    // Abaikan kegagalan revoke (lingkungan non-browser)
  }
}

/**
 * Mengurai lirik berformat LRC bertimestamp [mm:ss.xx]
 */
export function parseSyncedLyrics(lrc: string): SyncedLyricLine[] {
  const result: SyncedLyricLine[] = [];
  const lines = lrc.split('\n');
  const timeRegex = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    timeRegex.lastIndex = 0;
    const timestamps: number[] = [];
    let match: RegExpExecArray | null;

    while ((match = timeRegex.exec(line)) !== null) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      const millisStr = match[3] || '0';
      const millis = parseFloat(`0.${millisStr}`) * 1000;
      const totalSecs = minutes * 60 + seconds + millis / 1000;
      timestamps.push(totalSecs);
    }

    const text = line.replace(/\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]/g, '').trim();
    // Simpan baris yang memiliki timestamp meskipun teksnya kosong (penanda jeda instrumental)
    if (timestamps.length > 0) {
      for (const t of timestamps) {
        result.push({ timeSecs: t, text });
      }
    }
  }

  result.sort((a, b) => a.timeSecs - b.timeSecs);
  return result;
}

export class LyricsService {
  private cache = new Map<string, ParsedLyricsData | string[]>();
  private artCache = new Map<string, TrackArtworkInfo>();
  private currentKey: string = '';
  private currentArtKey: string = '';
  private listeners: LyricsCallback[] = [];
  private artListeners: ArtworkCallback[] = [];
  private activeLyrics: ParsedLyricsData | null = null;
  private currentPositionSecs: number = 0;
  private currentLineIdx: number = 0;
  private rollTimer: number | null = null;
  private currentTitle: string = '';
  private currentArtist: string = '';
  private lastArtworkInfo: TrackArtworkInfo | null = null;
  private currentIsPlaying: boolean = true;
  private previousActiveIdx: number = -999;
  private wasInstrumental: boolean = false;
  private previousKey: string = '';

  // Identitas rekaman eksplisit dari sesi media aktif (session_key#record_key).
  // Ketika terisi, pengelolaan artwork sepenuhnya milik jalur sesi media dan
  // pencarian Deezer/iTunes hanya berjalan bila diminta secara eksplisit.
  private explicitArtIdentity: string | null = null;
  // Penanda fallback pencarian sudah dijalankan untuk identitas aktif
  private searchFallbackDoneFor: string = '';
  // Object URL artwork sesi beserta kuncinya; dicabut saat tidak terpakai lagi
  private sessionObjectUrls = new Map<string, string>();
  // Status unduhan lirik per versi rekaman: loading/ready/not_found/error
  private lyricsLoadState = new Map<
    string,
    { status: 'loading' | 'ready' | 'not_found' | 'error'; attempts: number; nextRetryAt: number }
  >();
  // Dasar penundaan percobaan ulang lirik (ms); diperbesar eksponensial hingga 60 dtk
  private lyricsRetryBaseMs: number = 5000;

  private ambientPoems: Record<string, string[]> = {
    rain: [
      'Rintik hujan menyapa daun lumut,',
      'fokus kita mengalir tenang.',
      'Segarkan pikiran, satu demi satu.',
      'Dengarkan ritme alam yang damai.',
    ],
    stream: [
      'Air jernih membasahi bebatuan,',
      'alur waktu melaju tanpa desakan.',
      'Momo duduk tenang di tepi pulau,',
      'menikmati hening di antara pikiran.',
    ],
    breeze: [
      'Semilir sejuk dari lembah pinus,',
      'daun di kepala Momo bergoyang lembut.',
      'Napas perlahan, pikiran semakin jernih,',
      'pulau bertumbuh bersama usahamu.',
    ],
  };

  public subscribe(cb: LyricsCallback): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  public subscribeArtwork(cb: ArtworkCallback): () => void {
    this.artListeners.push(cb);
    if (this.lastArtworkInfo) {
      cb(this.lastArtworkInfo);
    }
    return () => {
      this.artListeners = this.artListeners.filter((l) => l !== cb);
    };
  }

  // ========================================================================
  // ARTWORK DARI SESI MEDIA AKTIF (SUMBER UTAMA)
  // ========================================================================

  /**
   * Dipanggil saat rekaman/sesi sistem media berganti:
   * langsung mengosongkan cover lama (placeholder) dan mereset metadata
   * artwork lagu sebelumnya agar tidak menetap saat unduhan lambat.
   */
  public onSystemRecordChanged(
    identityKey: string,
    meta: SessionRecordMeta,
    hasSessionArtwork: boolean
  ): void {
    if (this.currentArtKey !== identityKey) {
      this.currentArtKey = identityKey;
      // Kosongkan cover lama seketika: jangan biarkan sampul lagu sebelumnya terlihat
      this.notifyArtwork({
        albumArtUrl: null,
        artistPicUrl: null,
        title: meta.title,
        artist: meta.artist,
        source: 'none',
        artworkKey: identityKey,
      });
    }
    this.explicitArtIdentity = identityKey;
    if (this.searchFallbackDoneFor !== identityKey) {
      // Identitas baru: fallback pencarian boleh dijalankan sekali bila diperlukan
      this.searchFallbackDoneFor = '';
    }
    void hasSessionArtwork;
  }

  /**
   * Menerapkan artwork dari sesi media aktif. Hanya diterapkan bila identitas
   * sesi+rekaman masih sesuai dengan rekaman aktif saat ini.
   */
  public applySessionArtworkData(
    artworkKey: string,
    dataBase64: string,
    mimeType: string,
    meta: SessionRecordMeta
  ): boolean {
    if (this.currentArtKey !== artworkKey) {
      // Rekaman sudah berganti: tolak gambar lama
      return false;
    }
    const url = this.getOrCreateSessionUrl(artworkKey, dataBase64, mimeType);
    if (!url) {
      return false;
    }
    this.notifyArtwork({
      albumArtUrl: url,
      artistPicUrl: null,
      title: meta.title,
      artist: meta.artist,
      source: 'session',
      artworkKey,
    });
    return true;
  }

  /**
   * Menandakan artwork sesi tidak tersedia (thumbnail kosong, gagal dibaca,
   * atau format tidak didukung). Cover tetap placeholder, tidak ada gambar lama.
   */
  public notifySessionArtworkUnavailable(artworkKey: string): void {
    if (this.currentArtKey !== artworkKey) return;
    // Pastikan tidak ada sampul lama yang tertempel pada rekaman baru
    if (this.lastArtworkInfo && this.lastArtworkInfo.albumArtUrl) {
      this.notifyArtwork({
        albumArtUrl: null,
        artistPicUrl: null,
        title: this.lastArtworkInfo.title,
        artist: this.lastArtworkInfo.artist,
        source: 'none',
        artworkKey,
      });
    }
  }

  /** Mendapatkan object URL dari cache atau membuatnya dari data base64. */
  private getOrCreateSessionUrl(artworkKey: string, dataBase64: string, mimeType: string): string | null {
    const existing = this.sessionObjectUrls.get(artworkKey);
    if (existing) return existing;

    const url = createSessionObjectUrl(dataBase64, mimeType);
    if (!url) return null;

    // Batasi jumlah object URL yang disimpan: cabut yang paling tua
    if (this.sessionObjectUrls.size >= 12) {
      const oldestKey = this.sessionObjectUrls.keys().next().value;
      if (oldestKey !== undefined) {
        const oldUrl = this.sessionObjectUrls.get(oldestKey);
        if (oldUrl) revokeObjectUrlSafe(oldUrl);
        this.sessionObjectUrls.delete(oldestKey);
      }
    }
    this.sessionObjectUrls.set(artworkKey, url);
    return url;
  }

  /**
   * Fallback opsional: pencarian Deezer/iTunes dengan verifikasi rekaman.
   * Tidak pernah menggantikan thumbnail sesi secara otomatis dan tidak
   * memilih hasil pertama secara buta; kecocokan meragukan -> placeholder.
   */
  public async requestSearchArtworkFallback(meta: SessionRecordMeta & { identityKey: string }): Promise<void> {
    const { identityKey } = meta;
    if (this.currentArtKey !== identityKey) return;
    if (this.explicitArtIdentity !== identityKey) return;
    if (this.searchFallbackDoneFor === identityKey) return;
    if (this.lastArtworkInfo && this.lastArtworkInfo.source === 'session' && this.lastArtworkInfo.artworkKey === identityKey) {
      // Sampul sesi sudah tampil: pencarian tidak diperlukan
      return;
    }

    this.searchFallbackDoneFor = identityKey;
    await this.fetchArtworkAndArtistPic(meta.title, meta.artist, {
      album: meta.album,
      durationSecs: meta.durationSecs,
      identityKey,
    });
  }

  private notify(update: LyricsLinesUpdate): void {
    const fullUpdate: LyricsLinesUpdate = {
      isInstrumental: false,
      isPlaying: this.currentIsPlaying,
      lineIndex: this.currentLineIdx,
      totalLines: this.activeLyrics?.syncedLines.length || this.activeLyrics?.plainLines.length || 0,
      transitionType: 'none',
      ...update,
    };
    for (const cb of this.listeners) {
      try {
        cb(fullUpdate);
      } catch (err) {
        console.error('Error in lyrics callback:', err);
      }
    }
  }

  private notifyArtwork(info: TrackArtworkInfo): void {
    this.lastArtworkInfo = info;
    for (const cb of this.artListeners) {
      try {
        cb(info);
      } catch (err) {
        console.error('Error in artwork callback:', err);
      }
    }
  }

  private normalizeLyricsData(data: ParsedLyricsData | string[]): ParsedLyricsData {
    if (Array.isArray(data)) {
      return {
        isSynced: false,
        syncedLines: [],
        plainLines: data,
      };
    }
    return data;
  }

  public setAmbientTrack(trackId: 'rain' | 'stream' | 'breeze' | 'off', isPlaying: boolean = true) {
    this.stopRolling();
    this.currentKey = `ambient:${trackId}`;
    this.currentIsPlaying = isPlaying;
    // Kembali ke jalur artwork lokal ambient (tanpa identitas sesi media)
    this.explicitArtIdentity = null;
    this.searchFallbackDoneFor = '';
    this.notifyArtwork({
      albumArtUrl: null,
      artistPicUrl: null,
      title: trackId === 'rain' ? 'Suara Hujan Hutan' : trackId === 'stream' ? 'Gemericik Sungai' : 'Semilir Angin Pinus',
      artist: 'Moss Audio · Forest Tape',
      source: 'ambient',
      artworkKey: `ambient:${trackId}`,
    });

    if (trackId === 'off' || !this.ambientPoems[trackId]) {
      this.activeLyrics = null;
      this.notify({
        line1: 'LYRICS / AMBIENT',
        highlight: 'Di antara riuh dunia, kita tumbuh perlahan.',
        line2: 'Satu langkah, satu cerita.',
        isSynced: false,
      });
      return;
    }

    this.activeLyrics = {
      isSynced: false,
      syncedLines: [],
      plainLines: this.ambientPoems[trackId],
    };
    this.currentLineIdx = 0;
    this.currentTitle = trackId === 'rain' ? 'Suara Hujan Hutan' : trackId === 'stream' ? 'Gemericik Sungai' : 'Semilir Angin Pinus';
    this.currentArtist = 'Moss Audio · Forest Tape';

    this.emitCurrentRollingLines();
    if (isPlaying) {
      this.startRolling();
    }
  }

  // ========================================================================
  // PENCARIAN ARTWORK TERVERIFIKASI (FALLBACK OPSIONAL)
  // Hanya dijalankan ketika thumbnail sesi tidak tersedia. Hasil tidak boleh
  // dianggap "cover album asli Spotify" — diberi label sumber pencarian.
  // ========================================================================

  private normalizeForMatch(value: string): string {
    return value
      .toLowerCase()
      .replace(/\s*[\(\[\{].*?[\)\]\}]/g, ' ')
      .replace(/\s*[-–—].*$/, ' ')
      .replace(/\b(feat|ft|featuring)\b.*$/g, ' ')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private tokensMatch(a: string, b: string): boolean {
    const na = this.normalizeForMatch(a);
    const nb = this.normalizeForMatch(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    if (na.includes(nb) || nb.includes(na)) return true;
    const setA = new Set(na.split(' '));
    const setB = new Set(nb.split(' '));
    if (setA.size === 0 || setB.size === 0) return false;
    let shared = 0;
    setA.forEach((t) => {
      if (setB.has(t)) shared++;
    });
    return shared / Math.max(setA.size, setB.size) >= 0.8;
  }

  private async fetchArtworkAndArtistPic(
    title: string,
    artist: string,
    options?: {
      album?: string;
      durationSecs?: number;
      identityKey?: string;
    }
  ): Promise<TrackArtworkInfo> {
    const album = options?.album;
    const durationSecs = options?.durationSecs ?? 0;
    const identityKey = options?.identityKey ?? '';

    const cleanTitle = title.replace(/\s*[\(\[].*?[\)\]]/g, '').trim() || title.trim();
    const cleanArtist = artist.split(/[,&]/)[0].trim() || artist.trim();
    const roundedDur = durationSecs > 0 ? Math.round(durationSecs) : 0;
    // Cache key mencakup album+durasi agar versi rekaman berbeda dapat sampul berbeda
    const artKey = `${cleanTitle}:::${cleanArtist}:::${album || ''}:::${roundedDur}`.toLowerCase();
    // Guard tampilan memakai kunci sederhana yang sama dengan yang dipasang loadLyrics
    const guardKey = `${cleanTitle}:::${cleanArtist}`.toLowerCase();

    if (this.artCache.has(artKey)) {
      const cached = this.artCache.get(artKey)!;
      const isCurrent = identityKey ? this.currentArtKey === identityKey : this.currentArtKey === guardKey;
      if (isCurrent) {
        this.notifyArtwork(cached);
      }
      return cached;
    }

    interface ScoredCandidate {
      albumArtUrl: string;
      artistPicUrl: string | null;
      score: number;
    }
    // Skor kandidat: verifikasi judul, artis, album, dan durasi bila tersedia.
    // Kandidat dengan kecocokan meragukan DITOLAK (placeholder, bukan tebakan).
    const best: { value: ScoredCandidate | null } = { value: null };

    const consider = (
      candTitle: string | undefined,
      candArtist: string | undefined,
      candAlbum: string | undefined,
      candDuration: number | undefined,
      albumArtUrl: string | null,
      artistPicUrl: string | null
    ) => {
      if (!albumArtUrl) return;
      // Gerbang wajib: judul DAN artis harus cocok sebelum penilaian lain.
      // Tanpa ini, kandidat album/durasi sama tetapi artis berbeda bisa lolos.
      if (!this.tokensMatch(cleanTitle, candTitle || '')) return;
      if (!this.tokensMatch(cleanArtist, candArtist || '')) return;

      let score = 8; // dasar: judul + artis sudah cocok (melewati ambang 7)
      if (album && candAlbum && this.tokensMatch(album, candAlbum)) score += 2;
      if (durationSecs > 0 && typeof candDuration === 'number' && candDuration > 0) {
        const diff = Math.abs(candDuration - durationSecs);
        if (diff <= 3) score += 2;
        else if (diff <= 8) score += 1;
        else if (diff > 25) score -= 2;
      }
      if (!best.value || score > best.value.score) {
        best.value = { albumArtUrl, artistPicUrl, score };
      }
    };

    // Coba Deezer API: pencarian dibatasi 10 kandidat lalu diverifikasi satu per satu
    try {
      const query = encodeURIComponent(`${cleanArtist} ${cleanTitle}`);
      const deezerRes = await fetch(`https://api.deezer.com/search?q=${query}&limit=10`, {
        signal: AbortSignal.timeout(3500),
      });
      if (deezerRes.ok) {
        const json = await deezerRes.json();
        if (json.data && Array.isArray(json.data)) {
          for (const match of json.data) {
            consider(
              match.title,
              match.artist?.name,
              match.album?.title,
              typeof match.duration === 'number' ? match.duration : undefined,
              match.album?.cover_medium || match.album?.cover_big || null,
              match.artist?.picture_medium || match.artist?.picture_big || null
            );
          }
        }
      }
    } catch {
      // Abaikan error Deezer, coba fallback ke iTunes
    }

    // Fallback ke iTunes Search API jika belum ada kandidat yang lolos verifikasi
    if (!best.value) {
      try {
        const query = encodeURIComponent(`${cleanArtist} ${cleanTitle}`);
        const itunesRes = await fetch(`https://itunes.apple.com/search?term=${query}&entity=song&limit=10`, {
          signal: AbortSignal.timeout(3500),
        });
        if (itunesRes.ok) {
          const itunesData = await itunesRes.json();
          if (itunesData.results && Array.isArray(itunesData.results)) {
            for (const item of itunesData.results) {
              consider(
                item.trackName,
                item.artistName,
                item.collectionName,
                typeof item.trackTimeMillis === 'number' ? item.trackTimeMillis / 1000 : undefined,
                item.artworkUrl100 ? item.artworkUrl100.replace('100x100bb', '300x300bb') : null,
                null
              );
            }
          }
        }
      } catch {
        // Abaikan error iTunes
      }
    }

    // Ambang kepercayaan: hanya kandidat yang lolos gerbang judul+artis dipakai.
    const chosen = best.value && best.value.score >= 7 ? best.value : null;

    const info: TrackArtworkInfo = {
      albumArtUrl: chosen ? chosen.albumArtUrl : null,
      artistPicUrl: chosen ? chosen.artistPicUrl : null,
      title,
      artist,
      source: chosen ? 'search' : 'none',
      artworkKey: identityKey || artKey,
    };

    this.artCache.set(artKey, info);
    const isCurrent = identityKey ? this.currentArtKey === identityKey : this.currentArtKey === guardKey;
    if (isCurrent) {
      this.notifyArtwork(info);
    }
    return info;
  }

  private selectBestRecordMatch(
    items: Array<{
      trackName?: string;
      artistName?: string;
      albumName?: string;
      duration?: number;
      syncedLyrics?: string;
      plainLyrics?: string;
    }>,
    album?: string,
    targetDuration: number = 0
  ) {
    if (!items || items.length === 0) return null;

    const candidates = items.filter((it) => it.syncedLyrics || it.plainLyrics);
    if (candidates.length === 0) return items[0];

    // Jika durasi rekaman tersedia, cari kandidat yang selisih durasinya paling mendekati rekaman Spotify
    if (targetDuration > 0) {
      candidates.sort((a, b) => {
        // Prioritaskan kandidat yang memiliki lirik tersinkron
        const aHasSynced = Boolean(a.syncedLyrics) ? 1 : 0;
        const bHasSynced = Boolean(b.syncedLyrics) ? 1 : 0;
        if (aHasSynced !== bHasSynced) return bHasSynced - aHasSynced;

        // Cocokkan nama album jika tersedia
        const aAlbumMatch = album && a.albumName?.toLowerCase() === album.toLowerCase() ? 1 : 0;
        const bAlbumMatch = album && b.albumName?.toLowerCase() === album.toLowerCase() ? 1 : 0;
        if (aAlbumMatch !== bAlbumMatch) return bAlbumMatch - aAlbumMatch;

        // Urutkan berdasarkan selisih durasi terkecil terhadap Spotify
        const aDiff = typeof a.duration === 'number' ? Math.abs(a.duration - targetDuration) : 999;
        const bDiff = typeof b.duration === 'number' ? Math.abs(b.duration - targetDuration) : 999;
        return aDiff - bDiff;
      });

      return candidates[0];
    }

    return candidates.find((c) => Boolean(c.syncedLyrics)) || candidates[0];
  }

  private async fetchVersionMatchedLyrics(
    title: string,
    artist: string,
    album?: string,
    durationSecs: number = 0
  ): Promise<ParsedLyricsData | null> {
    const roundedDur = durationSecs > 0 ? Math.round(durationSecs) : 0;
    // Membedakan "lirik memang tidak tersedia" (layanan menjawab) dari
    // "layanan tidak dapat dijangkau" (semua permintaan gagal jaringan)
    let sawAnyResponse = false;

    // 1. Coba pencarian presisi /api/get dengan judul asli, artis, album, dan durasi rekaman
    try {
      const getParams = new URLSearchParams({
        track_name: title,
        artist_name: artist,
      });
      if (album && album.trim().length > 0) {
        getParams.append('album_name', album);
      }
      if (roundedDur > 0) {
        getParams.append('duration', roundedDur.toString());
      }
      const res = await fetch(`https://lrclib.net/api/get?${getParams.toString()}`, {
        signal: AbortSignal.timeout(3500),
      });
      sawAnyResponse = true;
      if (res.ok) {
        const data = await res.json();
        const parsed = this.parseLrclibResponse(data);
        if (parsed) return parsed;
      }
    } catch {
      // Lanjut ke pencarian multi-versi jika get gagal atau 404
    }

    // 2. Pencarian multi-rekaman /api/search dengan track_name dan artist_name asli
    try {
      const searchParams = new URLSearchParams({
        track_name: title,
        artist_name: artist,
      });
      const res = await fetch(`https://lrclib.net/api/search?${searchParams.toString()}`, {
        signal: AbortSignal.timeout(3500),
      });
      sawAnyResponse = true;
      if (res.ok) {
        const items = await res.json();
        if (Array.isArray(items) && items.length > 0) {
          const matched = this.selectBestRecordMatch(items, album, roundedDur);
          const parsed = this.parseLrclibResponse(matched);
          if (parsed) return parsed;
        }
      }
    } catch {
      // Abaikan dan lanjut ke query fleksibel
    }

    // 3. Fallback pencarian /api/search dengan query fleksibel
    const cleanTitle = title.replace(/\s*[\(\[].*?[\)\]]/g, '').trim() || title.trim();
    const cleanArtist = artist.split(/[,&]/)[0].trim() || artist.trim();

    try {
      const qRes = await fetch(
        `https://lrclib.net/api/search?q=${encodeURIComponent(`${cleanTitle} ${cleanArtist}`)}`,
        { signal: AbortSignal.timeout(3500) }
      );
      sawAnyResponse = true;
      if (qRes.ok) {
        const items = await qRes.json();
        if (Array.isArray(items) && items.length > 0) {
          const matched = this.selectBestRecordMatch(items, album, roundedDur);
          const parsed = this.parseLrclibResponse(matched);
          if (parsed) return parsed;
        }
      }
    } catch {
      // Fallback tetap menampilkan info kartu
    }

    // Semua permintaan gagal tanpa satu pun respons: layanan tidak terjangkau.
    // Lemparkan agar pemanggil membedakannya dari "lirik tidak tersedia".
    if (!sawAnyResponse) {
      throw new Error('Layanan lirik tidak dapat dijangkau');
    }

    return null;
  }

  private parseLrclibResponse(data: { syncedLyrics?: string; plainLyrics?: string } | null): ParsedLyricsData | null {
    if (!data) return null;

    if (data.syncedLyrics && typeof data.syncedLyrics === 'string') {
      const syncedLines = parseSyncedLyrics(data.syncedLyrics);
      if (syncedLines.length > 0) {
        return {
          isSynced: true,
          syncedLines,
          plainLines: [],
        };
      }
    }

    if (data.plainLyrics && typeof data.plainLyrics === 'string') {
      const plainLines = data.plainLyrics
        .split('\n')
        .map((l: string) => l.trim())
        .filter((l: string) => l.length > 0 && !l.startsWith('['));
      if (plainLines.length > 0) {
        return {
          isSynced: false,
          syncedLines: [],
          plainLines,
        };
      }
    }

    return null;
  }

  public async loadLyrics(
    title: string,
    artist: string,
    album?: string,
    isPlaying: boolean = true,
    positionSecs: number = 0,
    durationSecs: number = 0
  ): Promise<void> {
    const roundedDur = durationSecs > 0 ? Math.round(durationSecs) : 0;
    // Cache key spesifik per versi rekaman mencakup judul asli, artis, album, dan durasi
    const versionKey = `${title}:::${artist}:::${album || ''}:::${roundedDur}`.toLowerCase();
    const simpleKey = `${title}:::${artist}`.toLowerCase();
    const cleanTitle = title.replace(/\s*[\(\[].*?[\)\]]/g, '').trim() || title.trim();
    const cleanArtist = artist.split(/[,&]/)[0].trim() || artist.trim();
    const isNewTrack = this.currentKey !== versionKey;

    this.currentIsPlaying = isPlaying;
    this.currentPositionSecs = Math.max(0, positionSecs);

    // Saat sesi media aktif, identitas artwork dimiliki jalur sesi
    // (session_key#record_key); pencarian tidak dipicu dari sini agar
    // sampul sesi tidak digantikan gambar pencarian secara otomatis.
    const isSessionPathActive = this.explicitArtIdentity !== null;

    if (isNewTrack) {
      this.currentKey = versionKey;
      this.currentTitle = title;
      this.currentArtist = artist;
      this.currentLineIdx = 0;
      this.activeLyrics = null;
      this.stopRolling();

      if (!isSessionPathActive) {
        const artKey = `${cleanTitle}:::${cleanArtist}`.toLowerCase();
        this.currentArtKey = artKey;
        // Muat artwork album dan foto artis secara proaktif setelah currentArtKey diatur
        void this.fetchArtworkAndArtistPic(cleanTitle, cleanArtist);
      }
    }

    const defaultLine2 = isPlaying
      ? album
        ? `Album · ${album}`
        : 'Sedang Diputar · Sesi Media Sistem'
      : 'Pemutaran Dijeda';

    let cached = this.cache.get(versionKey);
    if (!cached && roundedDur === 0) {
      cached = this.cache.get(simpleKey);
    }

    if (cached) {
      this.lyricsLoadState.set(versionKey, { status: 'ready', attempts: 0, nextRetryAt: 0 });
      this.activeLyrics = this.normalizeLyricsData(cached);
      this.syncPosition(this.currentPositionSecs, this.currentIsPlaying);
      return;
    }

    // Unduh lirik: untuk lagu baru, atau percobaan ulang setelah kegagalan
    // jaringan (dengan penundaan bertahap). Status "not_found" tidak diulang
    // otomatis karena lirik memang tidak tersedia untuk rekaman ini.
    const loadState = this.lyricsLoadState.get(versionKey);
    const shouldRetryLoad = loadState?.status === 'error' && Date.now() >= loadState.nextRetryAt;

    if (isNewTrack || shouldRetryLoad) {
      // Tampilkan informasi awal sebelum lirik selesai diunduh
      this.notify({
        line1: artist ? `Artis · ${artist}` : 'Sesi Media Sistem',
        highlight: title,
        line2: defaultLine2,
        isSynced: false,
      });

      try {
        const parsed = await this.fetchVersionMatchedLyrics(title, artist, album, durationSecs);
        if (parsed) {
          this.cache.set(versionKey, parsed);
          this.lyricsLoadState.set(versionKey, { status: 'ready', attempts: 0, nextRetryAt: 0 });
          if (this.currentKey === versionKey) {
            this.activeLyrics = parsed;
            this.syncPosition(this.currentPositionSecs, this.currentIsPlaying);
          }
          return;
        }
        // Layanan menjawab tetapi tidak ada lirik untuk rekaman ini
        this.lyricsLoadState.set(versionKey, { status: 'not_found', attempts: 0, nextRetryAt: 0 });
      } catch (_err) {
        // Kegagalan jaringan/layanan: jadwalkan percobaan ulang bertahap
        const attempts = (loadState?.attempts || 0) + 1;
        const backoffMs = Math.min(60000, this.lyricsRetryBaseMs * Math.pow(2, attempts - 1));
        this.lyricsLoadState.set(versionKey, { status: 'error', attempts, nextRetryAt: Date.now() + backoffMs });
      }
    } else {
      this.syncPosition(this.currentPositionSecs, this.currentIsPlaying);
    }
  }

  public syncPosition(positionSecs: number, isPlaying: boolean = true): void {
    this.currentPositionSecs = Math.max(0, positionSecs);
    this.currentIsPlaying = isPlaying;

    if (!this.activeLyrics) return;

    if (this.activeLyrics.isSynced && this.activeLyrics.syncedLines.length > 0) {
      // Hentikan timer putaran tetap karena baris lirik ditentukan oleh posisi lagu
      this.stopRolling();

      const lines = this.activeLyrics.syncedLines;
      const total = lines.length;
      let activeIdx = -1;

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].timeSecs <= this.currentPositionSecs) {
          activeIdx = i;
        } else {
          break;
        }
      }

      if (activeIdx === -1) {
        // Sebelum baris pertama dimulai (bagian intro musik sebelum vokal)
        const firstVocal = lines.find((l) => l.text.trim().length > 0);
        const secondVocal = lines.filter((l) => l.text.trim().length > 0)[1];

        let transitionType: 'step' | 'jump' | 'none' = 'none';
        if (this.previousKey !== this.currentKey) {
          transitionType = 'jump';
          this.previousKey = this.currentKey;
        } else if (this.previousActiveIdx !== -999 && this.previousActiveIdx !== -1) {
          transitionType = 'jump';
        }

        this.previousActiveIdx = -1;
        this.wasInstrumental = true;
        this.currentLineIdx = -1;

        this.notify({
          line1: this.currentArtist ? `Artis · ${this.currentArtist}` : 'Sesi Media Sistem',
          highlight: '♪ ♪ ♪',
          line2: firstVocal ? firstVocal.text : (this.currentTitle || 'Musik Dimulai'),
          incoming: secondVocal ? secondVocal.text : '',
          isSynced: true,
          isInstrumental: true,
          isPlaying,
          lineIndex: -1,
          totalLines: total,
          transitionType,
        });
        return;
      }

      const currentRawText = lines[activeIdx].text;
      const isExplicitEmpty = currentRawText.trim().length === 0;

      // Periksa jeda instrumental antar baris (gap panjang di mana vokal sudah selesai dan tidak ada marker instrumental eksplisit)
      let isGapInstrumental = false;
      const nextRawLine = lines[activeIdx + 1];
      if (nextRawLine && !isExplicitEmpty && nextRawLine.text.trim().length > 0) {
        const gap = nextRawLine.timeSecs - lines[activeIdx].timeSecs;
        // Hanya jika jeda antar baris vokal minimal 10 detik
        const vocalHoldTime = Math.min(8.0, Math.max(5.0, gap * 0.5));
        if (
          gap >= 10.0 &&
          this.currentPositionSecs >= lines[activeIdx].timeSecs + vocalHoldTime &&
          nextRawLine.timeSecs - this.currentPositionSecs >= 3.0
        ) {
          isGapInstrumental = true;
        }
      }

      const isInstrumental = isExplicitEmpty || isGapInstrumental;

      // Cari lirik vokal sebelumnya
      let prevText = '';
      if (isGapInstrumental) {
        prevText = currentRawText;
      } else {
        for (let p = activeIdx - 1; p >= 0; p--) {
          if (lines[p].text.trim().length > 0) {
            prevText = lines[p].text;
            break;
          }
        }
      }
      if (!prevText) {
        prevText = this.currentArtist ? `Artis · ${this.currentArtist}` : 'Sesi Media Sistem';
      }

      // Cari lirik vokal selanjutnya
      let nextText = '';
      let nextVocalIdx = -1;
      for (let n = activeIdx + 1; n < lines.length; n++) {
        if (lines[n].text.trim().length > 0) {
          nextText = lines[n].text;
          nextVocalIdx = n;
          break;
        }
      }
      if (!nextText) {
        nextText = this.currentTitle || 'Musik Instrumental';
      }

      // Cari lirik setelah nextText (incoming untuk animasi slide)
      let incomingText = '';
      if (nextVocalIdx !== -1) {
        for (let inc = nextVocalIdx + 1; inc < lines.length; inc++) {
          if (lines[inc].text.trim().length > 0) {
            incomingText = lines[inc].text;
            break;
          }
        }
      }

      // Tentukan tipe transisi (step vs jump vs none)
      let transitionType: 'step' | 'jump' | 'none' = 'none';
      if (this.previousKey !== this.currentKey) {
        transitionType = 'jump';
        this.previousKey = this.currentKey;
      } else if (this.previousActiveIdx === -999) {
        transitionType = 'none';
      } else if (
        (activeIdx === this.previousActiveIdx + 1 && !this.wasInstrumental && !isInstrumental) ||
        (activeIdx === this.previousActiveIdx && !this.wasInstrumental && isInstrumental) ||
        (activeIdx === this.previousActiveIdx + 1 && this.wasInstrumental && !isInstrumental)
      ) {
        transitionType = isPlaying ? 'step' : 'none';
      } else if (activeIdx === this.previousActiveIdx && this.wasInstrumental === isInstrumental) {
        transitionType = 'none';
      } else {
        transitionType = 'jump';
      }

      this.previousActiveIdx = activeIdx;
      this.wasInstrumental = isInstrumental;
      this.currentLineIdx = activeIdx;

      const highlightText = isInstrumental ? '♪ ♪ ♪' : currentRawText;

      this.notify({
        line1: prevText,
        highlight: highlightText,
        line2: nextText,
        incoming: incomingText,
        isSynced: true,
        isInstrumental,
        isPlaying,
        lineIndex: activeIdx,
        totalLines: total,
        transitionType,
      });
    } else if (this.activeLyrics.plainLines.length > 0) {
      // Lirik biasa tanpa penanda waktu: tampilkan dengan keterangan sinkronisasi tidak tersedia
      this.emitCurrentRollingLines();
      if (isPlaying && this.rollTimer === null && this.activeLyrics.plainLines.length > 1) {
        this.startRolling();
      } else if (!isPlaying) {
        this.stopRolling();
      }
    }
  }

  private startRolling() {
    if (this.rollTimer !== null) return;
    const linesCount = this.activeLyrics?.plainLines.length || 0;
    if (linesCount <= 1) return;

    this.rollTimer = window.setInterval(() => {
      if (!this.activeLyrics || this.activeLyrics.isSynced) {
        this.stopRolling();
        return;
      }
      this.currentLineIdx = (this.currentLineIdx + 1) % this.activeLyrics.plainLines.length;
      this.emitCurrentRollingLines();
    }, 7000);
  }

  private stopRolling() {
    if (this.rollTimer !== null) {
      clearInterval(this.rollTimer);
      this.rollTimer = null;
    }
  }

  private emitCurrentRollingLines() {
    if (!this.activeLyrics || this.activeLyrics.plainLines.length === 0) return;

    const lines = this.activeLyrics.plainLines;
    const total = lines.length;
    const prevIdx = (this.currentLineIdx - 1 + total) % total;
    const nextIdx = (this.currentLineIdx + 1) % total;
    const incIdx = (this.currentLineIdx + 2) % total;

    const prevLineText =
      this.currentLineIdx === 0
        ? 'Lirik biasa (sinkronisasi tidak tersedia)'
        : lines[prevIdx];

    this.notify({
      line1: prevLineText,
      highlight: lines[this.currentLineIdx],
      line2: lines[nextIdx] || this.currentTitle,
      incoming: lines[incIdx] || '',
      isSynced: false,
      isInstrumental: false,
      isPlaying: this.currentIsPlaying,
      lineIndex: this.currentLineIdx,
      totalLines: total,
      transitionType: this.currentLineIdx === 0 ? 'none' : 'step',
    });
  }

  public clear(): void {
    this.stopRolling();
    this.cache.clear();
    this.artCache.clear();
    this.lyricsLoadState.clear();
    this.currentKey = '';
    this.previousKey = '';
    this.previousActiveIdx = -999;
    this.wasInstrumental = false;
    this.activeLyrics = null;
    this.currentLineIdx = 0;
    this.currentPositionSecs = 0;
    this.currentTitle = '';
    this.currentArtist = '';
    this.lastArtworkInfo = null;
    // Lepaskan seluruh object URL artwork sesi yang masih tersimpan
    for (const url of this.sessionObjectUrls.values()) {
      revokeObjectUrlSafe(url);
    }
    this.sessionObjectUrls.clear();
    this.explicitArtIdentity = null;
    this.searchFallbackDoneFor = '';
  }
}

export const lyricsService = new LyricsService();
