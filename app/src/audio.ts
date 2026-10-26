import * as THREE from 'three';

// NetVerse audio engine — hybrid source of sound: recorded CC0 game assets
// (Kenney Interface Sounds + Sci-Fi Sounds, public domain) are the primary
// material for ambience and one-shots, while the procedural Web Audio
// synthesis below stays as the mandatory fallback whenever an asset is
// missing, fails to fetch, or fails to decode. These are game assets, not
// field recordings of a real server room, and loading never blocks rendering.

export const SOUND_NAMES = [
  'click',
  'blip',
  'step',
  'door',
  'doorclose',
  'unplug',
  'install',
  'poweron',
  'alarm-warning',
  'alarm-offline',
  'alarm-linkdown',
  'alarm-critical',
  'resolve',
] as const;

export type SoundName = (typeof SOUND_NAMES)[number];
export type AudioSettings = { master: number; ambience: number; effects: number; alarms: number; muted: boolean };
type Bus = 'ambience' | 'effects' | 'alarms';

export const ASSET_FILES: Record<SoundName, string> = {
  click: 'click',
  blip: 'blip',
  step: 'step',
  door: 'door_open',
  doorclose: 'door_close',
  unplug: 'unplug',
  install: 'install',
  poweron: 'poweron',
  'alarm-warning': 'alarm_warning',
  'alarm-offline': 'alarm_offline',
  'alarm-linkdown': 'alarm_linkdown',
  'alarm-critical': 'alarm_critical',
  resolve: 'install',
};

export const AMBIENCE_FILES: Record<'dc' | 'noc', string> = {
  dc: 'dc_ambience',
  noc: 'noc_ambience',
};

export type SoundSource =
  | { kind: 'asset'; file: string }
  | { kind: 'procedural'; name: SoundName };

export function resolveSoundSource(name: SoundName, loaded: ReadonlySet<string>): SoundSource {
  const file = ASSET_FILES[name];
  if (loaded.has(file)) return { kind: 'asset', file };
  return { kind: 'procedural', name };
}

export function assetUrl(file: string): string {
  return `${import.meta.env.BASE_URL || '/'}audio/netverse/${file}.ogg`;
}

const STORAGE_KEY = 'netverse-audio-v1';
const DEFAULTS: AudioSettings = { master: 0.7, ambience: 0.6, effects: 0.8, alarms: 0.8, muted: false };

const MIX: Record<SoundName, { bus: Bus; gain: number; rate: number; jitter: number }> = {
  click: { bus: 'effects', gain: 0.5, rate: 0.9, jitter: 0.2 },
  blip: { bus: 'effects', gain: 0.25, rate: 1, jitter: 0 },
  step: { bus: 'effects', gain: 0.3, rate: 0.85, jitter: 0.3 },
  door: { bus: 'effects', gain: 0.5, rate: 1, jitter: 0 },
  doorclose: { bus: 'effects', gain: 0.5, rate: 1, jitter: 0 },
  unplug: { bus: 'effects', gain: 0.32, rate: 1, jitter: 0 },
  install: { bus: 'effects', gain: 0.3, rate: 1, jitter: 0 },
  poweron: { bus: 'effects', gain: 0.34, rate: 1, jitter: 0 },
  'alarm-warning': { bus: 'alarms', gain: 0.4, rate: 1, jitter: 0 },
  'alarm-offline': { bus: 'alarms', gain: 0.45, rate: 1, jitter: 0 },
  'alarm-linkdown': { bus: 'alarms', gain: 0.28, rate: 1, jitter: 0 },
  'alarm-critical': { bus: 'alarms', gain: 0.38, rate: 1, jitter: 0 },
  resolve: { bus: 'alarms', gain: 0.3, rate: 1, jitter: 0 },
};

export function buildUnplugWave(sampleRate: number): Float32Array {
  const length = Math.max(1, Math.floor(sampleRate * 0.14));
  const wave = new Float32Array(length);
  let low = 0;
  let seed = 0x6d2b79f5;
  for (let index = 0; index < length; index++) {
    const time = index / sampleRate;
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const noise = seed / 0x80000000 - 1;
    low += 0.24 * (noise - low);
    const pitch = 1000 - 4200 * time;
    wave[index] = (low * 0.65 + Math.sin(2 * Math.PI * pitch * time) * 0.35) * Math.exp(-time * 18);
  }
  return wave;
}

export function buildInstallWave(sampleRate: number): Float32Array {
  const length = Math.max(1, Math.floor(sampleRate * 0.24));
  const wave = new Float32Array(length);
  let phase = 0;
  for (let index = 0; index < length; index++) {
    const time = index / sampleRate;
    let frequency = 0;
    let envelope = 0;
    if (time < 0.085) {
      const progress = time / 0.085;
      frequency = 480 + 220 * progress;
      envelope = Math.sin(Math.PI * progress);
    } else if (time >= 0.115 && time < 0.225) {
      const progress = (time - 0.115) / 0.11;
      frequency = 760 + 300 * progress;
      envelope = Math.sin(Math.PI * progress);
    }
    phase += 2 * Math.PI * frequency / sampleRate;
    wave[index] = Math.sin(phase) * envelope * 0.55;
  }
  return wave;
}

export function buildPowerOnWave(sampleRate: number): Float32Array {
  const length = Math.max(1, Math.floor(sampleRate * 0.42));
  const wave = new Float32Array(length);
  let phase = 0;
  for (let index = 0; index < length; index++) {
    const time = index / sampleRate;
    let frequency = 0;
    let envelope = 0;
    if (time >= 0.01 && time < 0.08) {
      const progress = (time - 0.01) / 0.07;
      frequency = 420 + 260 * progress;
      envelope = Math.sin(Math.PI * progress);
    } else if (time >= 0.135 && time < 0.215) {
      const progress = (time - 0.135) / 0.08;
      frequency = 560 + 300 * progress;
      envelope = Math.sin(Math.PI * progress);
    } else if (time >= 0.275 && time < 0.395) {
      const progress = (time - 0.275) / 0.12;
      frequency = 700 + 420 * progress;
      envelope = Math.sin(Math.PI * progress);
    }
    phase += 2 * Math.PI * frequency / sampleRate;
    wave[index] = Math.sin(phase) * envelope * 0.5;
  }
  return wave;
}

export function loadAudioSettings(): AudioSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<AudioSettings>) };
  } catch { /* ignore */ }
  return { ...DEFAULTS };
}

class Engine {
  private listener: THREE.AudioListener | null = null;
  private settings: AudioSettings = loadAudioSettings();
  private master: GainNode | null = null;
  private buses: Record<Bus, GainNode> | null = null;
  private buf: Record<string, AudioBuffer> = {};
  private assets: Map<string, AudioBuffer> = new Map();
  private assetLoad: Promise<void> = Promise.resolve();
  private emitters: THREE.PositionalAudio[] = [];

  getSettings(): AudioSettings { return { ...this.settings }; }

  attach(listener: THREE.AudioListener) {
    if (this.listener) return;
    this.listener = listener;
    const ctx = listener.context;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    const bus = (): GainNode => { const g = ctx.createGain(); g.connect(this.master!); return g; };
    this.buses = { ambience: bus(), effects: bus(), alarms: bus() };
    this.buildBuffers(ctx);
    this.applySettings();
    this.assetLoad = this.loadAssets(ctx).catch(() => undefined);
  }

  detach(listener: THREE.AudioListener) {
    if (this.listener !== listener) return;
    this.clearEmitters();
    this.master?.disconnect();
    if (this.buses) Object.values(this.buses).forEach(bus => bus.disconnect());
    this.listener = null;
    this.master = null;
    this.buses = null;
    this.buf = {};
    this.assets.clear();
    this.assetLoad = Promise.resolve();
  }

  whenAssetsLoaded(): Promise<void> {
    return this.assetLoad;
  }

  private buildBuffers(ctx: AudioContext) {
    const sr = ctx.sampleRate;
    const mk = (secs: number): AudioBuffer => ctx.createBuffer(1, Math.max(1, Math.floor(sr * secs)), sr);
    const fan = mk(3);
    {
      const d = fan.getChannelData(0);
      let lp = 0, lp2 = 0;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        const n = Math.random() * 2 - 1;
        lp += 0.015 * (n - lp);
        lp2 += 0.003 * (lp - lp2);
        const hum = 0.4 * Math.sin(2 * Math.PI * 52 * t) + 0.2 * Math.sin(2 * Math.PI * 104 * t + 1.3);
        const wob = 0.85 + 0.15 * Math.sin(2 * Math.PI * t / 3);
        d[i] = (lp2 * 3 + lp * 0.8 + hum * 0.3) * wob;
      }
    }
    const noc = mk(3);
    {
      const d = noc.getChannelData(0);
      let lp = 0;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        const n = Math.random() * 2 - 1;
        lp += 0.006 * (n - lp);
        const hum = 0.15 * Math.sin(2 * Math.PI * 100 * t) * (0.8 + 0.2 * Math.sin(2 * Math.PI * t / 3));
        d[i] = lp * 1.6 + hum;
      }
    }
    const step = mk(0.09);
    {
      const d = step.getChannelData(0);
      let lp = 0;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        const n = Math.random() * 2 - 1;
        lp += 0.08 * (n - lp);
        d[i] = (lp * 1.4 + (n - lp) * 0.4) * Math.exp(-t * 38);
      }
    }
    const door = mk(0.45);
    {
      const d = door.getChannelData(0);
      let lp = 0.9;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        const n = Math.random() * 2 - 1;
        const coeff = 0.4 * Math.exp(-t * 6) + 0.015;
        lp += coeff * (n - lp);
        d[i] = lp * Math.sin(Math.PI * Math.min(1, t / 0.45)) * 1.2;
      }
    }
    const doorclose = mk(0.32);
    {
      const d = doorclose.getChannelData(0);
      let lp = 0.6;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        const n = Math.random() * 2 - 1;
        const coeff = 0.35 * Math.exp(-t * 9) + 0.01;
        lp += coeff * (n - lp);
        const thunk = Math.sin(2 * Math.PI * 120 * t) * Math.exp(-t * 14);
        d[i] = (lp * 1.1 + thunk * 0.45) * Math.exp(-t * 5);
      }
    }
    const click = mk(0.05);
    {
      const d = click.getChannelData(0);
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        d[i] = Math.sin(2 * Math.PI * 950 * t) * Math.exp(-t * 90) * 0.8;
      }
    }
    const unplug = mk(0.14);
    unplug.getChannelData(0).set(buildUnplugWave(sr));
    const install = mk(0.24);
    install.getChannelData(0).set(buildInstallWave(sr));
    const poweron = mk(0.42);
    poweron.getChannelData(0).set(buildPowerOnWave(sr));
    this.buf = { fan, noc, step, door, doorclose, click, unplug, install, poweron };
  }

  private async loadAssets(ctx: AudioContext): Promise<void> {
    const files = [...new Set([...Object.values(ASSET_FILES), ...Object.values(AMBIENCE_FILES)])];
    await Promise.all(files.map(async file => {
      try {
        const buffer = await this.fetchAsset(ctx, file);
        if (!buffer) return;
        if (this.listener?.context !== ctx) return;
        this.assets.set(file, buffer);
      } catch { /* asset unavailable — procedural fallback stays in charge */ }
    }));
    if (this.listener?.context !== ctx) return;
    this.upgradeEmitters();
  }

  private async fetchAsset(ctx: AudioContext, file: string): Promise<AudioBuffer | null> {
    if (typeof fetch !== 'function') return null;
    if (typeof ctx.decodeAudioData !== 'function') return null;
    const response = await fetch(assetUrl(file));
    if (!response || !response.ok) return null;
    const data = await response.arrayBuffer();
    if (!data || data.byteLength === 0) return null;
    return await ctx.decodeAudioData(data);
  }

  private upgradeEmitters() {
    this.emitters.forEach(e => {
      const kind = e.userData.kind as 'dc' | 'noc' | undefined;
      if (!kind) return;
      const file = AMBIENCE_FILES[kind];
      const buffer = this.assets.get(file);
      if (!buffer || e.userData.assetFile === file) return;
      const wasPlaying = e.isPlaying;
      if (wasPlaying) e.stop();
      e.setBuffer(buffer);
      e.userData.assetFile = file;
      if (wasPlaying) e.play();
    });
  }

  private applySettings() {
    if (!this.master || !this.buses) return;
    this.master.gain.value = this.settings.muted ? 0 : this.settings.master;
    this.buses.ambience.gain.value = this.settings.ambience;
    this.buses.effects.gain.value = this.settings.effects;
    this.buses.alarms.gain.value = this.settings.alarms;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings)); } catch { /* ignore */ }
  }

  setSettings(patch: Partial<AudioSettings>): AudioSettings {
    this.settings = { ...this.settings, ...patch };
    this.applySettings();
    return this.getSettings();
  }

  isReady(): boolean {
    return !!this.listener && this.listener.context.state === 'running';
  }

  async unlock() {
    if (!this.listener) return;
    const ctx = this.listener.context;
    if (ctx.state === 'suspended') {
      try { await ctx.resume(); } catch { /* blocked */ }
    }
    this.emitters.forEach(e => { if (!e.isPlaying) e.play(); });
  }

  makeEmitter(kind: 'dc' | 'noc'): THREE.PositionalAudio | null {
    if (!this.listener || !this.buses) return null;
    const e = new THREE.PositionalAudio(this.listener);
    const file = AMBIENCE_FILES[kind];
    const asset = this.assets.get(file);
    e.setBuffer(asset ?? (kind === 'dc' ? this.buf.fan : this.buf.noc));
    e.userData.kind = kind;
    e.userData.assetFile = asset ? file : '';
    e.setLoop(true);
    e.setRefDistance(2.5);
    e.setDistanceModel('exponential');
    e.setRolloffFactor(1.4);
    e.setVolume(kind === 'dc' ? 0.9 : 0.7);
    e.panner.disconnect();
    e.panner.connect(this.buses.ambience);
    this.emitters.push(e);
    return e;
  }

  clearEmitters() {
    this.emitters.forEach(e => { if (e.isPlaying) e.stop(); });
    this.emitters = [];
  }

  setRoomMix(room: 'dc' | 'noc' | 'power' | 'gudang') {
    this.emitters.forEach(e => {
      if (e.userData.kind === 'dc') e.setVolume(room === 'dc' ? 0.9 : 0.12);
      else e.setVolume(room === 'noc' || room === 'gudang' ? 0.7 : 0.08);
    });
  }

  private shot(buf: AudioBuffer, bus: Bus, gain: number, rate = 1, when?: number) {
    if (!this.listener || this.listener.context.state !== 'running') return;
    const ctx = this.listener.context;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g);
    g.connect(this.buses![bus]);
    src.start(when ?? ctx.currentTime);
  }

  private beep(freq: number, t0: number, dur: number, type: OscillatorType, bus: Bus, gain: number) {
    if (!this.listener || this.listener.context.state !== 'running') return;
    const ctx = this.listener.context;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
    g.gain.setValueAtTime(gain, t0 + Math.max(0.01, dur - 0.02));
    g.gain.linearRampToValueAtTime(0, t0 + dur);
    o.connect(g);
    g.connect(this.buses![bus]);
    o.start(t0);
    o.stop(t0 + dur + 0.03);
  }

  play(name: SoundName, delay = 0) {
    if (!this.listener || this.listener.context.state !== 'running' || !this.buses) return;
    const when = this.listener.context.currentTime + 0.01 + delay;
    const source = resolveSoundSource(name, new Set(this.assets.keys()));
    if (source.kind === 'asset') {
      const buffer = this.assets.get(source.file);
      if (buffer) {
        const mix = MIX[name];
        this.shot(buffer, mix.bus, mix.gain, mix.rate + Math.random() * mix.jitter, when);
        return;
      }
    }
    this.playProcedural(name, when);
  }

  private playProcedural(name: SoundName, t: number) {
    switch (name) {
      case 'click': this.shot(this.buf.click, 'effects', 0.5, 0.9 + Math.random() * 0.2, t); break;
      case 'blip':
        this.beep(880, t, 0.07, 'sine', 'effects', 0.25);
        this.beep(1320, t + 0.08, 0.09, 'sine', 'effects', 0.25);
        break;
      case 'step': this.shot(this.buf.step, 'effects', 0.3, 0.85 + Math.random() * 0.3, t); break;
      case 'door': this.shot(this.buf.door, 'effects', 0.5, 1, t); break;
      case 'doorclose': this.shot(this.buf.doorclose, 'effects', 0.5, 1, t); break;
      case 'unplug': this.shot(this.buf.unplug, 'effects', 0.32, 1, t); break;
      case 'install': this.shot(this.buf.install, 'effects', 0.3, 1, t); break;
      case 'poweron': this.shot(this.buf.poweron, 'effects', 0.34, 1, t); break;
      case 'alarm-warning': this.beep(660, t, 0.16, 'sine', 'alarms', 0.4); break;
      case 'alarm-offline':
        this.beep(520, t, 0.14, 'sine', 'alarms', 0.45);
        this.beep(392, t + 0.18, 0.2, 'sine', 'alarms', 0.45);
        break;
      case 'alarm-linkdown':
        [0, 0.16, 0.32].forEach(dt => this.beep(300, t + dt, 0.1, 'square', 'alarms', 0.28));
        break;
      case 'alarm-critical':
        [0, 0.18, 0.36, 0.54].forEach((dt, i) => this.beep(i % 2 ? 660 : 880, t + dt, 0.12, 'square', 'alarms', 0.38));
        break;
      case 'resolve':
        this.beep(523, t, 0.1, 'sine', 'alarms', 0.3);
        this.beep(784, t + 0.1, 0.14, 'sine', 'alarms', 0.3);
        break;
    }
  }
}

export const audio = new Engine();

export async function playPowerOn(): Promise<void> {
  await audio.unlock();
  audio.play('poweron');
}
