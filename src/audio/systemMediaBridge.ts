export interface SystemMediaTrack {
  title: string;
  artist: string;
  album: string;
  is_playing: boolean;
  playback_status?: 'playing' | 'paused' | 'stopped' | 'changing' | 'opened' | 'closed' | 'unknown';
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
  playback_rate?: number;
  repeat_mode?: 'off' | 'one' | 'all' | null;
  capabilities?: { toggle: boolean; next: boolean; previous: boolean; seek: boolean; repeat: boolean };
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
  private transitionTimer: ReturnType<typeof setTimeout> | null = null;
  public get waitingForTrack(): boolean { return this.transitionTimer !== null; }

  private cancelTrackWait(): void {
    if (this.transitionTimer !== null) clearTimeout(this.transitionTimer);
    this.transitionTimer = null;
  }

  private trackUnavailable(): void {
    this.wasPlaying = false;
    if (!this.currentTrack) return;
    this.currentTrack = null;
    this.transitionTimer = setTimeout(() => {
      this.transitionTimer = null;
      this.notify(null);
    }, 5000);
    this.notify(null);
  }
  private timer: number | null = null;
  private currentTrack: SystemMediaTrack | null = null;
  private wasPlaying: boolean = false;
  private listeners: MediaUpdateCallback[] = [];
  private songFinishedListeners: SongFinishedCallback[] = [];
  private isPollingInProgress: boolean = false;
  private refreshAfterPoll = false;
  private pollSequence: number = 0;
  private latestAppliedSequence: number = 0;
  private selectedSession: string | null = null;
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
    this.cancelTrackWait();
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
    const selectedSession = this.selectedSession;

    try {
      if (selectedSession === 'local') {
        this.currentTrack = null;
        this.wasPlaying = false;
        this.notify(null);
        return null;
      }
      const { invoke } = await import('@tauri-apps/api/core');
      const data = await invoke<SystemMediaTrack>('get_system_media_track', { sessionKey: selectedSession });

      // Mencegah respons lama yang tertunda menimpa status lagu yang lebih baru
      if (currentSeq < this.latestAppliedSequence || selectedSession !== this.selectedSession) {
        return this.currentTrack;
      }
      this.latestAppliedSequence = currentSeq;

      if (data && data.has_session && data.title && data.title.trim().length > 0) {
        this.cancelTrackWait();
        // Stopped pada rekaman yang sama dan posisi akhir, bukan pause atau sesi yang hilang.
        if (this.wasPlaying && !data.is_playing && data.playback_status === 'stopped'
          && data.session_key === this.currentTrack?.session_key && data.record_key === this.currentTrack?.record_key) {
          const isNearEnd =
            data.duration_secs > 0 && data.position_secs >= data.duration_secs - 0.5;
          if (isNearEnd) {
            this.notifySongFinished();
          }
        }

        this.wasPlaying = data.is_playing;
        this.currentTrack = data;
        this.notify(data);
        return data;
      } else {
        this.trackUnavailable();
        return null;
      }
    } catch {
      if (currentSeq >= this.latestAppliedSequence) {
        this.latestAppliedSequence = currentSeq;
        this.trackUnavailable();
      }
      return null;
    } finally {
      this.isPollingInProgress = false;
      if (this.refreshAfterPoll) {
        this.refreshAfterPoll = false;
        void this.pollNow();
      }
    }
  }

  public async selectSession(sessionKey: string | null): Promise<SystemMediaTrack | null> {
    this.cancelTrackWait();
    this.selectedSession = sessionKey;
    this.latestAppliedSequence = ++this.pollSequence;
    this.currentTrack = null;
    this.wasPlaying = false;
    this.notify(null);
    if (this.isPollingInProgress) {
      this.refreshAfterPoll = true;
      return null;
    }
    return this.pollNow();
  }

  public getSelectedSession(): string | null { return this.selectedSession; }

  public async listSessions(): Promise<SystemMediaTrack[]> {
    if (!this.isTauriAvailable) return [];
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke<SystemMediaTrack[]>('get_system_media_sessions') || [];
    } catch (error) {
      console.warn('Gagal membaca daftar sesi media:', error);
      return [];
    }
  }

  public async setRepeat(mode: 'off' | 'one' | 'all'): Promise<boolean> {
    const sessionKey = this.currentTrack?.session_key;
    if (!sessionKey || !this.currentTrack?.capabilities?.repeat) return false;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const success = await invoke<boolean>('system_media_repeat', { sessionKey, mode });
      await this.pollNow();
      return success;
    } catch { return false; }
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
    const sessionKey = this.currentTrack?.session_key;
    if (!sessionKey?.trim()) return false;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      // Kontrol terikat pada sesi yang sedang ditampilkan agar tidak mengendalikan
      // sesi lain ketika sesi baru muncul sebelum klik diterima
      const res = await invoke<boolean>('system_media_toggle_play', {
        sessionKey,
      });
      setTimeout(() => this.pollNow(), 150);
      return res;
    } catch {
      return false;
    }
  }

  public async nextTrack(): Promise<boolean> {
    const sessionKey = this.currentTrack?.session_key;
    if (!sessionKey?.trim()) return false;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const res = await invoke<boolean>('system_media_next', {
        sessionKey,
      });
      setTimeout(() => this.pollNow(), 300);
      return res;
    } catch {
      return false;
    }
  }

  public async prevTrack(): Promise<boolean> {
    const sessionKey = this.currentTrack?.session_key;
    if (!sessionKey?.trim()) return false;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const res = await invoke<boolean>('system_media_prev', {
        sessionKey,
      });
      setTimeout(() => this.pollNow(), 300);
      return res;
    } catch {
      return false;
    }
  }

  public async seekTo(positionSecs: number): Promise<boolean> {
    const track = this.currentTrack;
    const sessionKey = track?.session_key;
    const recordKey = track?.record_key;
    if (!sessionKey?.trim() || !recordKey?.trim()) return false;
    const selectedSession = this.selectedSession;
    const sequenceAtStart = this.pollSequence;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const res = await invoke<boolean>('system_media_seek', {
        positionSecs,
        sessionKey,
        recordKey,
      });
      if (res) {
        if (this.selectedSession !== selectedSession || this.currentTrack?.session_key !== sessionKey
          || this.currentTrack?.record_key !== recordKey) return false;
        // Naikkan urutan aktif agar respons polling lama yang sedang berjalan tidak menimpa hasil seek
        if (this.pollSequence === sequenceAtStart) this.latestAppliedSequence = ++this.pollSequence;
        setTimeout(() => this.pollNow(), 300);
      }
      return res;
    } catch {
      return false;
    }
  }

  /**
   * Mengambil artwork dari sesi media yang sama dengan sumber judul, artis,
   * album, posisi, dan status pemutaran. Pemanggil mengatur retry bila
   * thumbnail belum tersedia, tanpa mengunduh ulang sampul yang berhasil.
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
    } catch (error) {
      console.warn('Gagal membaca sampul sesi media:', error);
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
