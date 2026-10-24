export interface SystemMediaTrack {
  title: string;
  artist: string;
  album: string;
  is_playing: boolean;
  source_app: string;
  source_display_name: string;
  service_kind: string;
  is_spotify: boolean;
  has_session: boolean;
  session_key: string;
  record_key: string;
  has_thumbnail: boolean;
  position_secs: number;
  duration_secs: number;
}

/** Artwork dari sesi media aktif (bukan hasil pencarian). */
export interface SystemMediaArtwork {
  session_key: string;
  record_key: string;
  artwork_key: string;
  data_base64: string;
  mime_type: string;
}

export type MediaUpdateCallback = (track: SystemMediaTrack | null) => void;
export type SongFinishedCallback = () => void;

export class SystemMediaBridge {
  private timer: number | null = null;
  private currentTrack: SystemMediaTrack | null = null;
  private wasPlaying: boolean = false;
  private lastTitle: string = '';
  private listeners: MediaUpdateCallback[] = [];
  private songFinishedListeners: SongFinishedCallback[] = [];
  private isPollingInProgress: boolean = false;
  private pollSequence: number = 0;
  private latestAppliedSequence: number = 0;
  public readonly isTauriAvailable: boolean = false;

  constructor() {
    this.isTauriAvailable = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
  }

  public subscribe(cb: MediaUpdateCallback): () => void {
    this.listeners.push(cb);
    cb(this.currentTrack);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  public onSongFinished(cb: SongFinishedCallback): () => void {
    this.songFinishedListeners.push(cb);
    return () => {
      this.songFinishedListeners = this.songFinishedListeners.filter((l) => l !== cb);
    };
  }

  public startPolling(intervalMs: number = 1000): void {
    if (this.timer !== null) return;
    this.pollNow();
    this.timer = window.setInterval(() => {
      this.pollNow();
    }, intervalMs);
  }

  public stopPolling(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public async pollNow(): Promise<SystemMediaTrack | null> {
    // Mencegah penumpukan permintaan bersamaan jika permintaan sebelumnya belum selesai
    if (this.isPollingInProgress) {
      return this.currentTrack;
    }
    this.isPollingInProgress = true;
    const currentSeq = ++this.pollSequence;

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const data = await invoke<SystemMediaTrack>('get_system_media_track');

      // Mencegah respons lama yang tertunda menimpa status lagu yang lebih baru
      if (currentSeq < this.latestAppliedSequence) {
        return this.currentTrack;
      }
      this.latestAppliedSequence = currentSeq;

      if (data && data.has_session && data.title && data.title.trim().length > 0) {
        // Deteksi lagu selesai: jika sebelumnya memutar (wasPlaying = true),
        // lalu berubah menjadi is_playing = false dengan lagu yang sama tanpa lagu baru
        if (this.wasPlaying && !data.is_playing && data.title === this.lastTitle) {
          this.notifySongFinished();
        }

        this.wasPlaying = data.is_playing;
        this.lastTitle = data.title;
        this.currentTrack = data;
        this.notify(data);
        return data;
      } else {
        if (this.wasPlaying) {
          this.notifySongFinished();
        }
        this.wasPlaying = false;
        if (this.currentTrack !== null) {
          this.currentTrack = null;
          this.notify(null);
        }
        return null;
      }
    } catch {
      if (currentSeq >= this.latestAppliedSequence) {
        this.latestAppliedSequence = currentSeq;
        if (this.wasPlaying) {
          this.notifySongFinished();
        }
        this.wasPlaying = false;
        if (this.currentTrack !== null) {
          this.currentTrack = null;
          this.notify(null);
        }
      }
      return null;
    } finally {
      this.isPollingInProgress = false;
    }
  }

  private notifySongFinished(): void {
    for (const listener of this.songFinishedListeners) {
      try {
        listener();
      } catch (err) {
        console.error('Error in song finished listener:', err);
      }
    }
  }

  public async togglePlay(): Promise<boolean> {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const res = await invoke<boolean>('system_media_toggle_play');
      setTimeout(() => this.pollNow(), 150);
      return res;
    } catch {
      return false;
    }
  }

  public async nextTrack(): Promise<boolean> {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const res = await invoke<boolean>('system_media_next');
      setTimeout(() => this.pollNow(), 300);
      return res;
    } catch {
      return false;
    }
  }

  public async prevTrack(): Promise<boolean> {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const res = await invoke<boolean>('system_media_prev');
      setTimeout(() => this.pollNow(), 300);
      return res;
    } catch {
      return false;
    }
  }

  public async seekTo(positionSecs: number): Promise<boolean> {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const res = await invoke<boolean>('system_media_seek', { positionSecs });
      if (res) {
        // Naikkan urutan aktif agar respons polling lama yang sedang berjalan tidak menimpa hasil seek
        this.latestAppliedSequence = ++this.pollSequence;
        setTimeout(() => this.pollNow(), 300);
      }
      return res;
    } catch {
      return false;
    }
  }

  /**
   * Mengambil artwork dari sesi media yang sama dengan sumber judul, artis,
   * album, posisi, dan status pemutaran. Dipanggil hanya saat identitas
   * rekaman berubah (bukan setiap polling posisi).
   * Mengembalikan null bila thumbnail tidak tersedia / gagal dibaca / format
   * tidak didukung, sehingga pemanggil bisa menampilkan placeholder.
   */
  public async fetchArtwork(track: SystemMediaTrack): Promise<SystemMediaArtwork | null> {
    if (!this.isTauriAvailable) return null;
    if (!track || !track.session_key || !track.record_key) return null;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const art = await invoke<SystemMediaArtwork | null>('get_system_media_artwork', {
        sessionKey: track.session_key,
        recordKey: track.record_key,
      });
      if (!art || !art.data_base64) return null;
      // Tolak respons milik sesi/rekaman yang sudah tidak aktif
      if (art.session_key !== track.session_key || art.record_key !== track.record_key) {
        return null;
      }
      return art;
    } catch {
      return null;
    }
  }

  public getCurrentTrack(): SystemMediaTrack | null {
    return this.currentTrack;
  }

  private notify(track: SystemMediaTrack | null) {
    for (const listener of this.listeners) {
      try {
        listener(track);
      } catch (err) {
        console.error('Error in media listener:', err);
      }
    }
  }
}
