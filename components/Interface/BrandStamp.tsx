import React from 'react';

/**
 * Cross-site lockup for the adityaai.dev lab.
 *
 * This is the FRIDAY fork of the shared BrandStamp component. The
 * canonical copy lives at:
 *   https://github.com/adityaidev/adityaai.dev (src/components/BrandStamp.tsx)
 *
 * Keep the two in sync - when the root lockup changes, mirror it here.
 */
const BrandStamp: React.FC<{ className?: string }> = ({ className = '' }) => {
  return (
    <a
      href="https://adityaai.dev"
      aria-label="Back to adityaai.dev"
      className={`pointer-events-auto inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/40 backdrop-blur-md px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-gray-400 hover:text-cyan-300 hover:border-cyan-500/40 transition-colors duration-300 ${className}`}
    >
      <svg
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <line x1="17" y1="17" x2="7" y2="7" />
        <polyline points="7 17 7 7 17 7" />
      </svg>
      <span>adityaai</span>
      <span className="opacity-50">·</span>
      <span className="opacity-70">lab</span>
    </a>
  );
};

export default BrandStamp;
