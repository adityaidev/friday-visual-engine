import { describe, it, expect } from 'vitest';

// Replicate the clamping logic from the worklet for testability.
function encodeInt16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

describe('PCM Int16 encoder', () => {
  it('maps +1.0 to max Int16 (no overflow)', () => {
    const out = encodeInt16(new Float32Array([1.0]));
    expect(out[0]).toBe(32767);
  });
  it('maps -1.0 to min Int16', () => {
    const out = encodeInt16(new Float32Array([-1.0]));
    expect(out[0]).toBe(-32768);
  });
  it('clamps out-of-range inputs', () => {
    const out = encodeInt16(new Float32Array([1.5, -2.0]));
    expect(out[0]).toBe(32767);
    expect(out[1]).toBe(-32768);
  });
  it('encodes zero to zero', () => {
    const out = encodeInt16(new Float32Array([0, 0, 0]));
    expect(Array.from(out)).toEqual([0, 0, 0]);
  });
});
