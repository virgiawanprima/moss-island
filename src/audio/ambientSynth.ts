import { STUDY_TRACKS, type StudyTrackId } from './studyMusic';
import { BeatDetector } from './beatDetector';
export type AmbientTrack = StudyTrackId | 'off';
export const AMBIENT_TRACKS = STUDY_TRACKS;

export interface AudioPlaybackFailure {
  name: string;
  mediaCode: number | null;
  detail: string;
  message: string;
  file: string;
}

export function describeAudioFailure(error: unknown, file: string, mediaCode: number | null = null): AudioPlaybackFailure {
  const candidate = error && typeof error === 'object' ? error as { name?: unknown; message?: unknown } : {};
  const name = typeof candidate.name === 'string' ? candidate.name : 'MediaError';
  const detail = typeof candidate.message === 'string' ? candidate.message.slice(0, 200) : '';
  const reason = name === 'NotAllowedError' ? 'WebView menolak izin pemutaran audio.'
    : mediaCode === 2 ? 'Berkas audio tidak berhasil dimuat.'
    : mediaCode === 3 ? 'WebView gagal mendekode audio.'
    : mediaCode === 4 || name === 'NotSupportedError' ? 'WebView tidak dapat membuka berkas atau format audio.'
    : name === 'AbortError' ? 'Pemutaran audio terputus.' : 'Audio gagal diputar.';
  return { name, mediaCode, detail, file,
    message: `${reason} [${name}${mediaCode === null ? '' : `; media ${mediaCode}`}].${detail ? ` ${detail}` : ''}` };
}

export class AmbientSynth {
  public onPlaybackState: ((state: 'loading' | 'playing' | 'error') => void) | null = null;
  public onBeat: (() => void) | null = null;
  private ctx: AudioContext | null = null;
  private media: HTMLAudioElement | null = null;
  private offset = 0;
  private currentTrack: AmbientTrack = 'off';
  private loadedTrack: AmbientTrack = 'off';
  private volume = 0.5;
  private request = 0;
  private failure: AudioPlaybackFailure | null = null;
  private analysisContext: AudioContext | null = null;
  private analysisSource: MediaElementAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private animationFrame: number | null = null;
  private readonly beatDetector = new BeatDetector();
  private beatVisible = false;

  public setBeatVisible(visible: boolean) {
    this.beatVisible = visible;
    if (!visible) this.stopBeatSampling();
    else this.startBeatSampling();
  }

  private stopBeatSampling() {
    if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
    this.beatDetector.reset();
  }

  private startBeatSampling() {
    if (!this.beatVisible || !this.analyser || this.animationFrame !== null) return;
    const analyser = this.analyser;
    const binWidth = (this.analysisContext?.sampleRate ?? 48000) / analyser.fftSize;
    const bins = new Uint8Array(analyser.frequencyBinCount);
    const end = Math.min(bins.length, Math.max(2, Math.ceil(220 / binWidth)));
    const sample = (now: number) => {
      if (!this.beatVisible || this.analyser !== analyser || !this.media || this.media.paused) {
        this.animationFrame = null;
        return;
      }
      analyser.getByteFrequencyData(bins);
      if (this.beatDetector.update(bins.subarray(1, end), now)) this.onBeat?.();
      this.animationFrame = requestAnimationFrame(sample);
    };
    this.animationFrame = requestAnimationFrame(sample);
  }

  private async attachBeatAnalysis(media: HTMLAudioElement, request: number) {
    if (typeof AudioContext === 'undefined' || !this.onBeat) return;
    let context: AudioContext | null = null;
    let source: MediaElementAudioSourceNode | null = null;
    try {
      context = new AudioContext();
      await context.resume();
      if (request !== this.request || this.media !== media || context.state !== 'running') {
        await context.close();
        return;
      }
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.35;
      // Setelah source dibuat, elemen dirutekan melalui graph ke output sekali saja.
      analyser.connect(context.destination);
      source = context.createMediaElementSource(media);
      try {
        source.connect(analyser);
      } catch (error) {
        // Media sudah terikat graph; pertahankan suara walau analisis gagal.
        source.connect(context.destination);
        this.analysisContext = context;
        this.analysisSource = source;
        console.warn('Analisis irama lokal tidak tersedia:', error);
        return;
      }
      this.analysisContext = context;
      this.analysisSource = source;
      this.analyser = analyser;
      this.startBeatSampling();
    } catch (error) {
      console.warn('Analisis irama lokal tidak tersedia:', error);
      if (source && context && request === this.request && this.media === media) {
        try {
          source.connect(context.destination);
          this.analysisContext = context;
          this.analysisSource = source;
          return;
        } catch { /* Pemutaran elemen akan melaporkan error jika output tidak tersedia. */ }
      }
      if (context && context.state !== 'closed') await context.close().catch(() => {});
    }
  }

  public getPlaybackFailure(): Readonly<AudioPlaybackFailure> | null { return this.failure; }

  public resetPlayback() {
    this.stop();
    this.offset = 0;
  }

  private initContext() {
    this.ctx ??= new AudioContext();
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  public setVolume(val: number) {
    this.volume = Math.max(0, Math.min(1, val));
    if (this.media) this.media.volume = this.volume;
  }

  public getVolume() { return this.volume; }

  public async play(track: AmbientTrack): Promise<boolean> {
    this.stop();
    this.failure = null;
    if (track === 'off') return false;
    const request = this.request;
    const info = STUDY_TRACKS.find((item) => item.id === track);
    if (!info) return false;
    if (this.loadedTrack !== track) this.offset = 0;
    this.loadedTrack = track;
    try {
      // Playlist berjam-jam harus didekode bertahap, bukan menjadi satu AudioBuffer.
      const media = new Audio(info.file);
      media.preload = 'metadata';
      media.loop = true;
      media.volume = this.volume;
      this.media = media;
      const fail = (error: unknown) => {
        if (request !== this.request || this.media !== media) return;
        this.failure = describeAudioFailure(error, info.file, media.error?.code ?? null);
        console.error('Audio lokal gagal:', this.failure, { readyState: media.readyState, networkState: media.networkState });
        this.stop();
        this.onPlaybackState?.('error');
      };
      const notify = (state: 'loading' | 'playing' | 'error') => {
        if (request !== this.request || this.media !== media) return;
        if (state === 'error') { fail(media.error); return; }
        this.onPlaybackState?.(state);
      };
      media.addEventListener('waiting', () => notify('loading'));
      media.addEventListener('playing', () => notify('playing'));
      media.addEventListener('error', () => notify('error'));
      if (this.offset > 0) {
        const resumeAt = this.offset;
        const seek = () => {
          if (request !== this.request || this.media !== media) return;
          try { media.currentTime = Number.isFinite(media.duration) ? Math.min(resumeAt, Math.max(0, media.duration - 0.01)) : resumeAt; }
          catch (error) { fail(error); }
        };
        if (media.readyState >= 1) seek();
        else media.addEventListener('loadedmetadata', seek, { once: true });
      }
      notify('loading');
      await media.play();
      if (request !== this.request) {
        media.pause();
        return false;
      }
      this.currentTrack = track;
      void this.attachBeatAnalysis(media, request);
      return true;
    } catch (error) {
      if (request === this.request) {
        this.failure = describeAudioFailure(error, info.file, this.media?.error?.code ?? null);
        console.error('Audio lokal gagal:', this.failure);
        this.stop();
        this.onPlaybackState?.('error');
      }
      return false;
    }
  }

  public stop() {
    this.request++;
    this.stopBeatSampling();
    this.analysisSource?.disconnect();
    this.analyser?.disconnect();
    this.analysisSource = null;
    this.analyser = null;
    const analysisContext = this.analysisContext;
    this.analysisContext = null;
    if (analysisContext && analysisContext.state !== 'closed') void analysisContext.close().catch(() => {});
    if (this.media) {
      this.offset = Number.isFinite(this.media.currentTime) ? this.media.currentTime : 0;
      this.media.pause();
      this.media.removeAttribute('src');
      this.media.load();
      this.media = null;
    }
    this.currentTrack = 'off';
  }

  public playChime(soundEnabled: boolean = true) {
    if (!soundEnabled) return;

    this.initContext();
    if (!this.ctx) return;

    // Genta kayu lembut penanda sesi selesai
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1760, this.ctx.currentTime + 0.05);
    osc.frequency.exponentialRampToValueAtTime(440, this.ctx.currentTime + 0.8);

    const chimeVol = this.volume * 0.6;
    gain.gain.setValueAtTime(chimeVol, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 1.2);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start();
    osc.stop(this.ctx.currentTime + 1.2);
  }


  public getTrack(): AmbientTrack { return this.currentTrack; }
}
