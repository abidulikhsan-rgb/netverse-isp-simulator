import { describe, expect, it, vi } from 'vitest';
import type { AudioListener } from 'three';
import {
  AMBIENCE_FILES,
  ASSET_FILES,
  SOUND_NAMES,
  assetUrl,
  audio,
  buildInstallWave,
  buildPowerOnWave,
  buildUnplugWave,
  playPowerOn,
  resolveSoundSource,
} from './audio';

function peak(data: Float32Array, start: number, end: number): number {
  let value = 0;
  for (let index = start; index < end; index++) value = Math.max(value, Math.abs(data[index] ?? 0));
  return value;
}

function zeroCrossings(data: Float32Array, start: number, end: number): number {
  let count = 0;
  let previous = 0;
  for (let index = start; index < end; index++) {
    const value = data[index] ?? 0;
    if (value !== 0 && previous !== 0 && Math.sign(value) !== Math.sign(previous)) count += 1;
    if (value !== 0) previous = value;
  }
  return count;
}

function fakeListener(state: 'running' | 'suspended'): AudioListener {
  const gain = { value: 1 };
  const context = {
    sampleRate: 8000,
    state,
    destination: {},
    createGain: () => ({ gain, connect: () => undefined, disconnect: () => undefined }),
    createBuffer: (_channels: number, length: number) => ({ length, getChannelData: () => new Float32Array(length) }),
  };
  return { context } as unknown as AudioListener;
}

function trackingListener(): { listener: AudioListener; startedLengths: number[] } {
  let currentState: 'running' | 'suspended' = 'suspended';
  const startedLengths: number[] = [];
  const context = {
    sampleRate: 8000,
    currentTime: 0,
    get state() { return currentState; },
    resume: async () => { currentState = 'running'; },
    destination: {},
    createGain: () => ({ gain: { value: 1 }, connect: () => undefined, disconnect: () => undefined }),
    createBuffer: (_channels: number, length: number) => ({ length, getChannelData: () => new Float32Array(length) }),
    createBufferSource: () => {
      let assigned: unknown = null;
      return {
        get buffer() { return assigned; },
        set buffer(value: unknown) { assigned = value; },
        playbackRate: { value: 1 },
        connect: () => undefined,
        start: () => {
          const length = assigned && typeof assigned === 'object' && 'length' in assigned ? Number(assigned.length) : 0;
          startedLengths.push(length);
        },
      };
    },
  };
  return { listener: { context } as unknown as AudioListener, startedLengths };
}

type HybridListener = {
  listener: AudioListener;
  startedLengths: number[];
};

function hybridListener(decode: (data: ArrayBuffer) => Promise<AudioBuffer>): HybridListener {
  const startedLengths: number[] = [];
  const context = {
    sampleRate: 8000,
    currentTime: 0,
    state: 'running' as 'running' | 'suspended',
    resume: async () => undefined,
    destination: {},
    createGain: () => ({ gain: { value: 1, setTargetAtTime: () => undefined }, connect: () => undefined, disconnect: () => undefined }),
    createBuffer: (_channels: number, length: number) => ({ length, getChannelData: () => new Float32Array(length) }),
    createBufferSource: () => {
      let assigned: unknown = null;
      return {
        get buffer() { return assigned; },
        set buffer(value: unknown) { assigned = value; },
        playbackRate: { value: 1 },
        detune: { value: 0 },
        connect: () => undefined,
        start: () => {
          const length = assigned && typeof assigned === 'object' && 'length' in assigned ? Number(assigned.length) : 0;
          startedLengths.push(length);
        },
      };
    },
    createPanner: () => ({
      connect: () => undefined,
      disconnect: () => undefined,
      positionX: { value: 0 },
      positionY: { value: 0 },
      positionZ: { value: 0 },
    }),
    decodeAudioData: decode,
  };
  const listener = { context, getInput: () => ({}) } as unknown as AudioListener;
  return { listener, startedLengths };
}

describe('recorded asset mapping', () => {
  it('maps every sound name to its CC0 asset file', () => {
    expect([...SOUND_NAMES].sort()).toEqual(Object.keys(ASSET_FILES).sort());
    expect(ASSET_FILES).toEqual({
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
    });
  });

  it('points the room ambiences at the recorded loops', () => {
    expect(AMBIENCE_FILES).toEqual({ dc: 'dc_ambience', noc: 'noc_ambience' });
  });

  it('builds asset urls below the public audio folder', () => {
    expect(assetUrl('dc_ambience')).toContain('audio/netverse/dc_ambience.ogg');
  });

  it('prefers a loaded asset and falls back to procedural synthesis', () => {
    expect(resolveSoundSource('door', new Set(['door_open']))).toEqual({ kind: 'asset', file: 'door_open' });
    expect(resolveSoundSource('doorclose', new Set(['door_close']))).toEqual({ kind: 'asset', file: 'door_close' });
    expect(resolveSoundSource('resolve', new Set(['install']))).toEqual({ kind: 'asset', file: 'install' });
    expect(resolveSoundSource('click', new Set())).toEqual({ kind: 'procedural', name: 'click' });
    expect(resolveSoundSource('alarm-critical', new Set(['alarm_warning']))).toEqual({ kind: 'procedural', name: 'alarm-critical' });
  });
});

describe('hybrid recorded assets with procedural fallback', () => {
  it('plays the recorded asset and loops the recorded ambience when decoding succeeds', async () => {
    const assetBuffer = { length: 4321, duration: 0.5 } as unknown as AudioBuffer;
    const requested: string[] = [];
    vi.stubGlobal('fetch', async (input: unknown) => {
      requested.push(String(input));
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(16) };
    });
    const { listener, startedLengths } = hybridListener(async () => assetBuffer);
    audio.attach(listener);
    try {
      await audio.whenAssetsLoaded();
      audio.play('click');
      expect(startedLengths).toContain(4321);
      expect(startedLengths).not.toContain(Math.floor(8000 * 0.05));
      expect(requested.length).toBeGreaterThan(0);
      expect(requested.every(url => url.includes('audio/netverse/'))).toBe(true);
      const emitter = audio.makeEmitter('dc');
      expect(emitter?.buffer).toBe(assetBuffer);
      expect(emitter?.isPlaying).toBe(false);
    } finally {
      audio.detach(listener);
      vi.unstubAllGlobals();
    }
  });

  it('keeps the procedural fallback when assets cannot be fetched or decoded', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('network offline'); });
    const { listener, startedLengths } = hybridListener(async () => { throw new Error('decode failed'); });
    expect(() => audio.attach(listener)).not.toThrow();
    try {
      await expect(audio.whenAssetsLoaded()).resolves.toBeUndefined();
      expect(() => audio.play('click')).not.toThrow();
      expect(startedLengths).toContain(Math.floor(8000 * 0.05));
      const emitter = audio.makeEmitter('dc');
      expect(emitter?.buffer?.length).toBe(Math.floor(8000 * 3));
    } finally {
      audio.detach(listener);
      vi.unstubAllGlobals();
    }
  });
});

describe('maintenance audio synthesis', () => {
  it('creates a short unplug noise burst that decays', () => {
    const sampleRate = 8000;
    const wave = buildUnplugWave(sampleRate);
    expect(wave.length).toBe(Math.floor(sampleRate * 0.14));
    expect(wave.every(Number.isFinite)).toBe(true);
    expect(peak(wave, Math.floor(wave.length * 0.65), wave.length)).toBeLessThan(peak(wave, 0, Math.floor(wave.length * 0.35)));
  });

  it('creates an install sound with two separated rising tones', () => {
    const sampleRate = 8000;
    const wave = buildInstallWave(sampleRate);
    const first = peak(wave, Math.floor(sampleRate * 0.02), Math.floor(sampleRate * 0.08));
    const gap = peak(wave, Math.floor(sampleRate * 0.095), Math.floor(sampleRate * 0.115));
    const second = peak(wave, Math.floor(sampleRate * 0.14), Math.floor(sampleRate * 0.21));
    expect(wave.length).toBe(Math.floor(sampleRate * 0.24));
    expect(first).toBeGreaterThan(gap * 3);
    expect(second).toBeGreaterThan(gap * 3);
  });

  it('creates a power-on sound with three separated rising tones', () => {
    const sampleRate = 8000;
    const wave = buildPowerOnWave(sampleRate);
    const firstStart = Math.floor(sampleRate * 0.015);
    const firstEnd = Math.floor(sampleRate * 0.075);
    const secondStart = Math.floor(sampleRate * 0.14);
    const secondEnd = Math.floor(sampleRate * 0.2);
    const thirdStart = Math.floor(sampleRate * 0.28);
    const thirdEnd = Math.floor(sampleRate * 0.38);
    const first = peak(wave, firstStart, firstEnd);
    const firstGap = peak(wave, Math.floor(sampleRate * 0.09), Math.floor(sampleRate * 0.125));
    const second = peak(wave, secondStart, secondEnd);
    const secondGap = peak(wave, Math.floor(sampleRate * 0.225), Math.floor(sampleRate * 0.265));
    const third = peak(wave, thirdStart, thirdEnd);
    const firstRate = zeroCrossings(wave, firstStart, firstEnd) / 0.06;
    const secondRate = zeroCrossings(wave, secondStart, secondEnd) / 0.06;
    const thirdRate = zeroCrossings(wave, thirdStart, thirdEnd) / 0.1;

    expect(wave.length).toBe(Math.floor(sampleRate * 0.42));
    expect(first).toBeGreaterThan(firstGap * 3);
    expect(second).toBeGreaterThan(secondGap * 3);
    expect(third).toBeGreaterThan(secondGap * 3);
    expect(secondRate).toBeGreaterThan(firstRate);
    expect(thirdRate).toBeGreaterThan(secondRate);
  });

  it('unlocks a suspended context and plays the power-on tone', async () => {
    const { listener, startedLengths } = trackingListener();
    audio.attach(listener);
    try {
      await playPowerOn();
      expect(audio.isReady()).toBe(true);
      expect(startedLengths).toContain(Math.floor(8000 * 0.42));
    } finally {
      audio.detach(listener);
    }
  });

  it('detaches the previous listener before a scene remount', () => {
    const first = fakeListener('running');
    audio.attach(first);
    expect(audio.isReady()).toBe(true);
    audio.detach(first);
    expect(audio.isReady()).toBe(false);
    const second = fakeListener('suspended');
    audio.attach(second);
    expect(audio.isReady()).toBe(false);
    audio.detach(second);
  });
});
