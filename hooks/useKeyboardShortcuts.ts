import { useEffect } from 'react';

export interface Shortcut {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
  handler: (e: KeyboardEvent) => void;
  when?: () => boolean;
  description?: string;
}

export function useKeyboardShortcuts(shortcuts: Shortcut[]): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (target?.isContentEditable) return;

      for (const s of shortcuts) {
        if (s.when && !s.when()) continue;
        if (e.key.toLowerCase() !== s.key.toLowerCase()) continue;
        if (!!s.ctrl !== e.ctrlKey) continue;
        if (!!s.shift !== e.shiftKey) continue;
        if (!!s.alt !== e.altKey) continue;
        if (!!s.meta !== e.metaKey) continue;
        e.preventDefault();
        s.handler(e);
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shortcuts]);
}
