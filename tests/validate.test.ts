import { describe, it, expect } from 'vitest';
import { normalizeAnalysis, sanitizeQuery } from '../api/_shared/validate';

describe('normalizeAnalysis', () => {
  it('slugs component names into stable IDs', () => {
    const result = normalizeAnalysis({
      systemName: 'Test',
      description: 'desc',
      components: [
        {
          name: 'Piston Head',
          type: 'MECHANICAL',
          relativePosition: [0, 0, 0],
          structure: [
            { shape: 'CYLINDER', args: [1, 1, 2], position: [0, 0, 0], rotation: [0, 0, 0] },
          ],
          connections: [],
          status: 'optimal',
          description: '',
        },
      ],
    });
    expect(result.components[0].id).toBe('piston-head');
  });

  it('defaults missing fields', () => {
    const result = normalizeAnalysis({
      components: [
        { name: 'X', structure: [], connections: [], status: 'optimal', relativePosition: [] },
      ],
    });
    expect(result.systemName).toBe('Unknown System');
    expect(result.components[0].relativePosition).toEqual([0, 0, 0]);
  });

  it('rejects empty component list', () => {
    expect(() => normalizeAnalysis({ components: [] })).toThrow();
  });

  it('maps connections by name to IDs', () => {
    const result = normalizeAnalysis({
      systemName: 'S',
      description: 'd',
      components: [
        {
          name: 'Alpha',
          type: 'COMPUTE',
          relativePosition: [0, 0, 0],
          structure: [],
          connections: ['Beta'],
          status: 'optimal',
          description: '',
        },
        {
          name: 'Beta',
          type: 'NETWORK',
          relativePosition: [1, 0, 0],
          structure: [],
          connections: ['Alpha'],
          status: 'optimal',
          description: '',
        },
      ],
    });
    expect(result.components[0].connections).toContain('beta');
    expect(result.components[1].connections).toContain('alpha');
  });
});

describe('sanitizeQuery', () => {
  it('truncates long input', () => {
    const long = 'a'.repeat(5000);
    expect(sanitizeQuery(long, 100).length).toBe(100);
  });
  it('strips control characters', () => {
    expect(sanitizeQuery('hello\x00world')).toBe('hello world');
  });
  it('returns empty for non-strings', () => {
    expect(sanitizeQuery(null)).toBe('');
    expect(sanitizeQuery(123)).toBe('');
  });
});
