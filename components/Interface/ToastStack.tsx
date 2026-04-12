import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, CheckCircle, Info, XCircle, X } from 'lucide-react';
import { useToast, Toast } from '../../hooks/useToast';

const ICONS: Record<Toast['variant'], React.ReactNode> = {
  info: <Info size={14} className="text-cyan-400" />,
  success: <CheckCircle size={14} className="text-green-400" />,
  warning: <AlertTriangle size={14} className="text-yellow-400" />,
  error: <XCircle size={14} className="text-red-400" />,
};

const BORDERS: Record<Toast['variant'], string> = {
  info: 'border-cyan-500/40',
  success: 'border-green-500/40',
  warning: 'border-yellow-500/40',
  error: 'border-red-500/40',
};

export const ToastStack: React.FC = () => {
  const { toasts, dismiss } = useToast();
  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 pointer-events-none"
    >
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            role="status"
            className={`pointer-events-auto flex items-center gap-3 px-4 py-2 bg-[#030712]/90 backdrop-blur-xl border ${BORDERS[t.variant]} rounded-lg text-xs font-mono text-white shadow-lg`}
          >
            {ICONS[t.variant]}
            <span className="max-w-sm">{t.message}</span>
            <button
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss notification"
              className="text-gray-500 hover:text-white"
            >
              <X size={12} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
};
