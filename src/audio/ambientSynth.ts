export type AmbientTrack = 'rain' | 'stream' | 'breeze' | 'off';

export interface TrackInfo {
  id: AmbientTrack;
  title: string;
  description: string;
}

export const AMBIENT_TRACKS: TrackInfo[] = [
  { id: 'rain', title: 'Hujan di Hutan Lumut', description: 'Suara gemersik rintik hujan lembut' },
  { id: 'stream', title: 'Aliran Sungai Hening', description: 'Gemercik air jernih mengalir santai' },
  { id: 'breeze', title: 'Angin Lembah Pinus', description: 'Desau angin sejuk pegunungan' },
];

export class AmbientSynth {
  private ctx: AudioContext | null = null;
  private currentTrack: AmbientTrack = 'off';
  private noiseNode: AudioBufferSourceNode | null = null;
  private filterNode: BiquadFilterNode | null = null;
  private gainNode: GainNode | null = null;
  private volume: number = 0.5;

  private initContext() {
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  public setVolume(val: number) {
    this.volume = Math.max(0, Math.min(1, val));
    if (this.gainNode && this.ctx) {
      this.gainNode.gain.setValueAtTime(this.volume, this.ctx.currentTime);
    }
  }

  public getVolume(): number {
    return this.volume;
  }

  public play(track: AmbientTrack) {
    this.stop();
    if (track === 'off') {
      this.currentTrack = 'off';
      return;
    }

    this.initContext();
    if (!this.ctx) return;

    this.currentTrack = track;

    // Generate Pink/Brown Noise Buffer untuk suara ambient sintetis
    const bufferSize = this.ctx.sampleRate * 2;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);

    let lastOut = 0.0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      data[i] = (lastOut + 0.02 * white) / 1.02;
      lastOut = data[i];
      data[i] *= 3.5;
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;

    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();

    if (track === 'rain') {
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(700, this.ctx.currentTime);
      gain.gain.setValueAtTime(this.volume * 0.8, this.ctx.currentTime);
    } else if (track === 'stream') {
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(450, this.ctx.currentTime);
      filter.Q.setValueAtTime(1.2, this.ctx.currentTime);
      gain.gain.setValueAtTime(this.volume * 0.7, this.ctx.currentTime);
    } else if (track === 'breeze') {
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(250, this.ctx.currentTime);
      gain.gain.setValueAtTime(this.volume * 0.6, this.ctx.currentTime);
    }

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);

    noise.start();
    this.noiseNode = noise;
    this.filterNode = filter;
    this.gainNode = gain;
  }

  public stop() {
    if (this.noiseNode) {
      try {
        this.noiseNode.stop();
        this.noiseNode.disconnect();
      } catch {
        // Abaikan jika sudah berhenti
      }
      this.noiseNode = null;
    }

    if (this.filterNode) {
      try {
        this.filterNode.disconnect();
      } catch {
        // Abaikan
      }
      this.filterNode = null;
    }

    if (this.gainNode) {
      try {
        this.gainNode.disconnect();
      } catch {
        // Abaikan
      }
      this.gainNode = null;
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

  public getTrack(): AmbientTrack {
    return this.currentTrack;
  }
}
