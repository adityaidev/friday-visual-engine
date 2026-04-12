import { useCallback, useEffect, useState } from 'react';

export interface Toast {
  id: string;
  message: string;
  variant: 'info' | 'success' | 'warning' | 'error';
  durationMs: number;
}

type Listener = (toasts: Toast[]) => void;
const listeners = new Set<Listener>();
let toasts: Toast[] = [];

function emit() {
  listeners.forEach((l) => l(toasts));
}

export function pushToast(
  message: string,
  variant: Toast['variant'] = 'info',
  durationMs = 4000,
): string {
  const id = crypto.randomUUID();
  toasts = [...toasts, { id, message, variant, durationMs }];
  emit();
  if (durationMs > 0) setTimeout(() => dismissToast(id), durationMs);
  return id;
}

export function dismissToast(id: string): void {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function useToast(): {
  toasts: Toast[];
  push: (msg: string, variant?: Toast['variant'], durationMs?: number) => string;
  dismiss: (id: string) => void;
} {
  const [state, setState] = useState<Toast[]>(toasts);
  useEffect(() => {
    listeners.add(setState);
    return () => {
      listeners.delete(setState);
    };
  }, []);
  const push = useCallback(
    (msg: string, variant: Toast['variant'] = 'info', durationMs = 4000) =>
      pushToast(msg, variant, durationMs),
    [],
  );
  return { toasts: state, push, dismiss: dismissToast };
}
