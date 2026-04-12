import { vi } from 'vitest';

// Mock AudioContext
class MockAudioContext {
  sampleRate = 48000;
  state = 'running';
  destination = {};
  async resume() {}
  async close() {}
  createAnalyser() {
    return { fftSize: 0, smoothingTimeConstant: 0, frequencyBinCount: 32, connect: () => {}, getByteFrequencyData: () => {} };
  }
  createMediaStreamSource() {
    return { connect: () => {}, disconnect: () => {} };
  }
  createGain() {
    return { gain: { value: 0 }, connect: () => ({ connect: () => {} }) };
  }
  createBuffer() {
    return { duration: 0, getChannelData: () => new Float32Array() };
  }
  createBufferSource() {
    return { buffer: null, connect: () => {}, start: () => {}, stop: () => {} };
  }
  get audioWorklet() {
    return { addModule: async () => {} };
  }
}

// @ts-expect-error mocking global
globalThis.AudioContext = MockAudioContext;
// @ts-expect-error mocking global
globalThis.AudioWorkletNode = class {
  port = { postMessage: () => {}, onmessage: null };
  connect() {}
  disconnect() {}
};

if (typeof globalThis.crypto === 'undefined') {
  // @ts-expect-error partial polyfill
  globalThis.crypto = { randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2) };
}

vi.mock('@react-three/fiber', () => ({ Canvas: () => null, useFrame: () => {}, useThree: () => ({ viewport: { width: 0, height: 0 } }) }));
vi.mock('@react-three/drei', () => new Proxy({}, { get: () => () => null }));
