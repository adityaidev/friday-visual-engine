import { PrimitiveShape } from '../../types.js';

export function normalizeAnalysis(raw: unknown): {
  systemName: string;
  description: string;
  components: Array<{
    id: string;
    name: string;
    type: string;
    description: string;
    details: Record<string, string>;
    connections: string[];
    relativePosition: [number, number, number];
    structure: Array<{
      shape: string;
      args: number[];
      position: [number, number, number];
      rotation: [number, number, number];
      colorHex?: string;
    }>;
    status: string;
  }>;
} {
  const data = (raw ?? {}) as Record<string, unknown>;
  const components = Array.isArray(data.components) ? (data.components as unknown[]) : [];
  if (components.length === 0) throw new Error('Model returned no components');

  const slug = (s: string) =>
    s
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || `comp-${crypto.randomUUID().slice(0, 8)}`;

  const processed = components.map((c) => {
    const comp = (c ?? {}) as Record<string, unknown>;
    const name = typeof comp.name === 'string' ? comp.name : 'Unnamed';
    const structure = Array.isArray(comp.structure) ? (comp.structure as unknown[]) : [];
    const rp = Array.isArray(comp.relativePosition)
      ? (comp.relativePosition as number[])
      : [0, 0, 0];
    return {
      id: slug(name),
      name,
      type: typeof comp.type === 'string' ? comp.type : 'UNKNOWN',
      description: typeof comp.description === 'string' ? comp.description : '',
      details:
        comp.details && typeof comp.details === 'object'
          ? Object.fromEntries(
              Object.entries(comp.details as Record<string, unknown>)
                .filter(([, v]) => typeof v === 'string')
                .map(([k, v]) => [k, v as string]),
            )
          : {},
      connections: Array.isArray(comp.connections)
        ? (comp.connections as unknown[]).filter((x): x is string => typeof x === 'string')
        : [],
      relativePosition: [
        Number(rp[0]) || 0,
        Number(rp[1]) || 0,
        Number(rp[2]) || 0,
      ] as [number, number, number],
      structure: structure.map((p) => {
        const prim = (p ?? {}) as Record<string, unknown>;
        const shape = Object.values(PrimitiveShape).includes(prim.shape as PrimitiveShape)
          ? (prim.shape as string)
          : 'BOX';
        const args = Array.isArray(prim.args) && (prim.args as unknown[]).length > 0
          ? (prim.args as number[]).map((n) => Number(n) || 1)
          : [1, 1, 1];
        const pos = Array.isArray(prim.position) ? (prim.position as number[]) : [0, 0, 0];
        const rot = Array.isArray(prim.rotation) ? (prim.rotation as number[]) : [0, 0, 0];
        return {
          shape,
          args,
          position: [Number(pos[0]) || 0, Number(pos[1]) || 0, Number(pos[2]) || 0] as [
            number,
            number,
            number,
          ],
          rotation: [Number(rot[0]) || 0, Number(rot[1]) || 0, Number(rot[2]) || 0] as [
            number,
            number,
            number,
          ],
          colorHex: typeof prim.colorHex === 'string' ? prim.colorHex : undefined,
        };
      }),
      status: ['optimal', 'warning', 'critical'].includes(comp.status as string)
        ? (comp.status as string)
        : 'optimal',
    };
  });

  const nameToId = new Map<string, string>();
  processed.forEach((c) => nameToId.set(c.name.toLowerCase(), c.id));
  processed.forEach((c) => {
    c.connections = c.connections.map((n) => nameToId.get(n.toLowerCase()) || slug(n));
  });

  return {
    systemName: typeof data.systemName === 'string' ? data.systemName : 'Unknown System',
    description:
      typeof data.description === 'string' ? data.description : 'No description available.',
    components: processed,
  };
}

export function sanitizeQuery(q: unknown, maxLen = 2000): string {
  if (typeof q !== 'string') return '';
  return q.slice(0, maxLen).replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
}
