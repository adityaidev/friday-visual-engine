import React, { useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Mic, MicOff, Power } from 'lucide-react';
import { useLiveSession } from '../../hooks/useLiveSession';

interface Point3D {
  baseX: number;
  baseY: number;
  baseZ: number;
  phase: number;
}

interface VoiceModuleProps {
  onCommand?: (command: string) => void;
}

export const VoiceModule: React.FC<VoiceModuleProps> = ({ onCommand }) => {
  const { connect, disconnect, isConnected, voiceState, volumeRef, error, isMuted, toggleMute } =
    useLiveSession(onCommand);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Point3D[]>([]);
  const rotationRef = useRef({ x: 0, y: 0 });
  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    const particles: Point3D[] = [];
    const count = prefersReducedMotion ? 120 : 400;
    for (let i = 0; i < count; i++) {
      const phi = Math.acos(1 - (2 * (i + 0.5)) / count);
      const theta = Math.PI * (1 + Math.sqrt(5)) * i;
      const r = 90;
      particles.push({
        baseX: r * Math.sin(phi) * Math.cos(theta),
        baseY: r * Math.sin(phi) * Math.sin(theta),
        baseZ: r * Math.cos(phi),
        phase: Math.random() * Math.PI * 2,
      });
    }
    particlesRef.current = particles;
  }, [prefersReducedMotion]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !isConnected) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    let time = 0;

    const render = () => {
      const width = canvas.width;
      const height = canvas.height;
      const cx = width / 2;
      const cy = height / 2;
      ctx.clearRect(0, 0, width, height);

      const inputVol = volumeRef.current.input;
      const outputVol = volumeRef.current.output;
      const activeVol = Math.max(inputVol, outputVol);

      let baseColor = '100, 116, 139';
      let glowColor = 'rgba(0,0,0,0)';
      let expansion = 1;
      let jitter = 0;
      let rotationSpeedY = 0.002;
      const rotationSpeedX = 0.001;
      let connectionDistance = 0;

      if (voiceState === 'listening') {
        baseColor = '34, 211, 238';
        glowColor = 'rgba(34, 211, 238, 0.15)';
        expansion = 1.05 + activeVol * 0.1;
        jitter = activeVol * 2;
        rotationSpeedY = 0.01;
      } else if (voiceState === 'speaking') {
        baseColor = '192, 132, 252';
        glowColor = 'rgba(192, 132, 252, 0.25)';
        expansion = 1.1 + activeVol * 0.6;
        jitter = activeVol * 8;
        rotationSpeedY = 0.02 + activeVol * 0.02;
        connectionDistance = 40;
      } else if (voiceState === 'thinking') {
        baseColor = '255, 255, 255';
        glowColor = 'rgba(255, 255, 255, 0.2)';
        rotationSpeedY = 0.05;
        expansion = 0.9;
      }

      rotationRef.current.y += rotationSpeedY;
      rotationRef.current.x += rotationSpeedX;
      time += 0.05;

      if (voiceState !== 'idle') {
        const gradient = ctx.createRadialGradient(cx, cy, 20, cx, cy, 140 * expansion);
        gradient.addColorStop(0, glowColor);
        gradient.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
      }

      const projected = particlesRef.current.map((p) => {
        let x1 = p.baseX * Math.cos(rotationRef.current.y) - p.baseZ * Math.sin(rotationRef.current.y);
        const z1 = p.baseX * Math.sin(rotationRef.current.y) + p.baseZ * Math.cos(rotationRef.current.y);
        let y1 = p.baseY * Math.cos(rotationRef.current.x) - z1 * Math.sin(rotationRef.current.x);
        const z2 = p.baseY * Math.sin(rotationRef.current.x) + z1 * Math.cos(rotationRef.current.x);

        const pulse = 1 + Math.sin(time + p.phase) * 0.02 + activeVol * 0.4 * Math.sin(p.phase * 3);
        x1 *= pulse * expansion;
        y1 *= pulse * expansion;
        const z = z2 * pulse * expansion;

        if (jitter > 0) {
          x1 += (Math.random() - 0.5) * jitter;
          y1 += (Math.random() - 0.5) * jitter;
        }

        const fov = 250;
        const scale = fov / (fov + z);
        return { x: cx + x1 * scale, y: cy + y1 * scale, scale, z };
      });

      projected.sort((a, b) => b.z - a.z);

      projected.forEach((p, index) => {
        const alpha = Math.max(0.1, p.scale);
        if (voiceState === 'speaking' && index % 2 === 0) {
          for (let j = 1; j < 3; j++) {
            const p2 = projected[index + j];
            if (p2) {
              const dx = p.x - p2.x;
              const dy = p.y - p2.y;
              const d = Math.sqrt(dx * dx + dy * dy);
              if (d < connectionDistance * p.scale) {
                ctx.beginPath();
                ctx.strokeStyle = `rgba(${baseColor}, ${0.15 * alpha})`;
                ctx.lineWidth = 0.5;
                ctx.moveTo(p.x, p.y);
                ctx.lineTo(p2.x, p2.y);
                ctx.stroke();
              }
            }
          }
        }
        const size = Math.max(0.8, 2.5 * p.scale + activeVol * 1.5);
        ctx.beginPath();
        ctx.fillStyle = `rgba(${baseColor}, ${alpha})`;
        ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
        ctx.fill();
      });

      animationId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animationId);
  }, [isConnected, voiceState, volumeRef]);

  if (!isConnected) {
    return (
      <div className="w-full mt-auto flex flex-col items-center justify-center py-8">
        <button
          onClick={connect}
          aria-label="Connect voice session"
          className="group relative flex items-center justify-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400 rounded-full"
        >
          <div className="absolute inset-0 bg-cyan-500/20 rounded-full animate-[ping_3s_cubic-bezier(0,0,0.2,1)_infinite] opacity-20" />
          <div className="absolute -inset-6 bg-cyan-500/5 rounded-full animate-[pulse_4s_ease-in-out_infinite] opacity-30" />
          <div className="relative w-16 h-16 bg-[#0a0f1e] rounded-full border border-cyan-500/30 shadow-[0_0_40px_rgba(0,240,255,0.15)] flex items-center justify-center transition-all duration-500 group-hover:scale-110 group-hover:border-cyan-400/80 group-hover:shadow-[0_0_60px_rgba(0,240,255,0.4)]">
            <Mic className="text-cyan-400 w-6 h-6 group-hover:text-white transition-colors" />
          </div>
        </button>
        <div className="mt-6 flex flex-col items-center gap-1">
          <span className="text-[10px] font-mono text-cyan-400 font-bold tracking-[0.2em] uppercase">
            Talk to FRIDAY
          </span>
          <span className="text-[9px] text-cyan-500/50">Status: Offline</span>
        </div>
        {error && (
          <div
            role="alert"
            className="mt-2 text-[9px] text-red-400 bg-red-900/20 px-2 py-1 rounded border border-red-500/20"
          >
            {error}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative w-full h-56 bg-gradient-to-t from-[#030712] to-transparent flex flex-col items-center justify-end overflow-hidden">
      <div className="absolute top-4 left-0 right-0 flex justify-center z-10 pointer-events-none">
        <div className="flex items-center gap-3 px-4 py-1.5 bg-[#030712]/60 backdrop-blur-md rounded-full border border-white/5 shadow-lg">
          <motion.div
            animate={{ opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 2, repeat: Infinity }}
            className={`w-1.5 h-1.5 rounded-full ${
              voiceState === 'speaking'
                ? 'bg-purple-400'
                : voiceState === 'listening'
                  ? 'bg-cyan-400'
                  : 'bg-gray-500'
            }`}
          />
          <span
            className="text-[9px] font-mono text-gray-200 uppercase tracking-widest font-bold"
            role="status"
            aria-live="polite"
          >
            {voiceState === 'speaking'
              ? 'Voice Active'
              : voiceState === 'listening'
                ? 'Listening'
                : 'Processing'}
          </span>
        </div>
      </div>

      <canvas
        ref={canvasRef}
        width={360}
        height={260}
        className="absolute inset-0 w-full h-full object-cover pointer-events-none"
        aria-hidden
      />

      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="relative z-20 mb-4 flex items-center gap-3"
      >
        <div className="flex items-center gap-1 bg-[#0f172a]/40 backdrop-blur-xl border border-white/10 rounded-full p-1.5 shadow-[0_8px_32px_rgba(0,0,0,0.3)]">
          <button
            onClick={toggleMute}
            aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
            aria-pressed={isMuted}
            className={`p-3 rounded-full transition-all duration-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400 ${
              isMuted
                ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                : 'hover:bg-white/5 text-gray-400 hover:text-white'
            }`}
          >
            {isMuted ? <MicOff size={16} /> : <Mic size={16} />}
          </button>
          <div className="w-px h-4 bg-white/10 mx-1" />
          <button
            onClick={disconnect}
            aria-label="Disconnect voice session"
            className="p-3 rounded-full hover:bg-red-500/20 text-gray-400 hover:text-red-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-400"
          >
            <Power size={16} />
          </button>
        </div>
      </motion.div>

      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyan-500/20 to-transparent opacity-50" />
    </div>
  );
};
