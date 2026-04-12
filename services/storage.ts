import type { SystemAnalysis } from '../types';

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) || '/api';

export async function saveSystem(
  system: SystemAnalysis,
): Promise<{ id: string; shareHash: string; createdAt: string }> {
  const res = await fetch(`${API_BASE}/systems/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemName: system.systemName,
      description: system.description,
      data: { components: system.components },
    }),
  });
  if (!res.ok) throw new Error(`Save failed (${res.status})`);
  return res.json();
}

export async function loadSystem(shareHash: string): Promise<SystemAnalysis> {
  const res = await fetch(`${API_BASE}/systems/load?hash=${encodeURIComponent(shareHash)}`);
  if (!res.ok) throw new Error(`Load failed (${res.status})`);
  return res.json();
}

export async function listSystems(): Promise<
  Array<{ id: string; system_name: string; share_hash: string; created_at: string }>
> {
  const res = await fetch(`${API_BASE}/systems/list`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.systems || [];
}
