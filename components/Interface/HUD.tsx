import React, { useState, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Terminal,
  Cpu,
  Activity,
  ScanLine,
  Camera,
  X,
  Box,
  Settings,
  FileText,
  ChevronRight,
  StopCircle,
  Send,
  Share2,
  Copy,
  RotateCcw,
} from 'lucide-react';
import { VoiceModule } from './VoiceModule';
import {
  SystemAnalysis,
  SystemComponent,
  Message,
  DiagnosticResult,
} from '../../types';
import { analyzeSystem, chatWithFriday, runDiagnostics } from '../../services/geminiService';
import { saveSystem } from '../../services/storage';
import { useToast } from '../../hooks/useToast';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';

const InitializationSequence: React.FC<{ onCancel?: () => void; estMs?: number }> = ({
  onCancel,
  estMs = 30_000,
}) => {
  const [progress, setProgress] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [statusIndex, setStatusIndex] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [displayedText, setDisplayedText] = useState('');
  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const statuses = useMemo(
    () => [
      'BOOT_SEQUENCE_INITIATED',
      'CONNECTING_TO_NEURAL_MAINFRAME',
      'ALLOCATING_QUANTUM_VOXELS',
      'COMPILING_GEOMETRIC_SHADERS',
      'OPTIMIZING_POLYGON_MESH_DENSITY',
      'CALIBRATING_PHYSICS_ENGINE',
      'SYNTHESIZING_HOLOGRAPHIC_PROJECTION',
      'FINALIZING_SYSTEM_INTEGRITY',
    ],
    [],
  );

  useEffect(() => {
    const started = Date.now();
    const tick = () => {
      const elapsed = Date.now() - started;
      setElapsedMs(elapsed);
      const pctRaw = (elapsed / estMs) * 95;
      const pct = pctRaw < 95 ? pctRaw : 95 + Math.min(4, (elapsed - estMs) / 5_000);
      setProgress(Math.min(99, pct));
      const total = statuses.length;
      const si = Math.min(total - 1, Math.floor((pct / 95) * total));
      setStatusIndex((prev) => (prev !== si ? si : prev));
    };
    tick();
    const iv = setInterval(tick, 200);
    return () => clearInterval(iv);
  }, [estMs, statuses.length]);

  useEffect(() => {
    const targetText = statuses[statusIndex];
    let iteration = 0;
    const interval = setInterval(() => {
      setDisplayedText(
        targetText
          .split('')
          .map((letter, index) =>
            index < iteration
              ? letter
              : 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()'[Math.floor(Math.random() * 36)],
          )
          .join(''),
      );
      if (iteration >= targetText.length) clearInterval(interval);
      iteration += 2;
    }, 30);
    return () => clearInterval(interval);
  }, [statusIndex, statuses]);

  useEffect(() => {
    if (prefersReducedMotion) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = window.innerWidth;
    const height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;

    const stars: { x: number; y: number; z: number }[] = [];
    for (let i = 0; i < 800; i++) {
      stars.push({
        x: (Math.random() - 0.5) * width,
        y: (Math.random() - 0.5) * height,
        z: Math.random() * width,
      });
    }

    let animId: number;
    const render = () => {
      ctx.fillStyle = 'rgba(3, 7, 18, 0.4)';
      ctx.fillRect(0, 0, width, height);
      const cx = width / 2;
      const cy = height / 2;

      stars.forEach((star) => {
        star.z -= 15;
        if (star.z <= 0) {
          star.z = width;
          star.x = (Math.random() - 0.5) * width;
          star.y = (Math.random() - 0.5) * height;
        }
        const x = (star.x / star.z) * width + cx;
        const y = (star.y / star.z) * height + cy;
        const size = (1 - star.z / width) * 4;
        const alpha = 1 - star.z / width;
        ctx.beginPath();
        ctx.fillStyle = `rgba(0, 240, 255, ${alpha})`;
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
      });
      animId = requestAnimationFrame(render);
    };
    render();
    return () => cancelAnimationFrame(animId);
  }, [prefersReducedMotion]);

  const displayProgress = Math.floor(progress);

  return (
    <div
      role="dialog"
      aria-label="Generating 3D model"
      aria-busy="true"
      className="absolute inset-0 z-50 bg-[#030712] flex items-center justify-center font-mono overflow-hidden"
    >
      <canvas ref={canvasRef} className="absolute inset-0 opacity-60" aria-hidden />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,#030712_90%)]" />

      <div className="relative z-10 flex flex-col items-center">
        <div className="relative w-64 h-64 flex items-center justify-center mb-8">
          <motion.div
            animate={prefersReducedMotion ? undefined : { rotate: 360 }}
            transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
            className="absolute inset-0 border-2 border-dashed border-cyan-500/30 rounded-full"
          />
          <motion.div
            animate={prefersReducedMotion ? undefined : { rotate: -360 }}
            transition={{ duration: 4, repeat: Infinity, ease: 'linear' }}
            className="absolute inset-4 border border-t-transparent border-l-transparent border-cyan-400/60 rounded-full"
          />
          <div className="flex flex-col items-center justify-center bg-black/50 backdrop-blur-sm w-40 h-40 rounded-full border border-white/10">
            <span className="text-4xl font-black text-white tracking-tighter" aria-live="polite">
              {displayProgress}
              <span className="text-sm text-gray-500">%</span>
            </span>
            <span className="text-[10px] font-mono text-cyan-400/60 mt-1 tracking-wider">
              {(elapsedMs / 1000).toFixed(1)}s
              {elapsedMs > estMs ? ' · deep analysis' : ''}
            </span>
          </div>
        </div>

        <div className="h-12 flex flex-col items-center">
          <div className="text-cyan-400 text-sm font-bold tracking-[0.2em] mb-2 drop-shadow-[0_0_8px_rgba(0,240,255,0.8)]">
            {displayedText}
          </div>
          <div className="w-64 h-1 bg-gray-800 rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-gradient-to-r from-cyan-600 to-cyan-400"
              animate={{ width: `${displayProgress}%` }}
              transition={{ type: 'tween', ease: 'linear', duration: 0.1 }}
            />
          </div>
        </div>

        {onCancel && (
          <button
            onClick={onCancel}
            className="mt-6 px-4 py-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/40 rounded text-[10px] font-bold tracking-widest uppercase text-red-400"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
};

interface HUDProps {
  systemData: SystemAnalysis | null;
  selectedComponent: SystemComponent | null;
  onSystemLoad: (data: SystemAnalysis) => void;
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;
  expansion: number;
  setExpansion: (val: number) => void;
  isScanning: boolean;
  setIsScanning: (scanning: boolean) => void;
  diagnosticResult: DiagnosticResult[];
  setDiagnosticResult: (res: DiagnosticResult[]) => void;
  setSelectedComponentId: (id: string | null) => void;
}

export const HUD: React.FC<HUDProps> = ({
  systemData,
  selectedComponent,
  onSystemLoad,
  isLoading,
  setIsLoading,
  expansion,
  setExpansion,
  isScanning,
  setIsScanning,
  diagnosticResult,
  setDiagnosticResult,
  setSelectedComponentId,
}) => {
  const [systemName, setSystemName] = useState('');
  const [description, setDescription] = useState('');
  const [activeTab, setActiveTab] = useState<'create' | 'info' | 'logs'>('create');
  const [messages, setMessages] = useState<Message[]>([
    { id: '1', role: 'system', content: 'FRIDAY v1.0 initialized. Neural Engine Standby.', timestamp: Date.now() },
  ]);
  const [chatInput, setChatInput] = useState('');
  const [isChatting, setIsChatting] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const analyzeControllerRef = useRef<AbortController | null>(null);
  const diagControllerRef = useRef<AbortController | null>(null);
  const { push: toast } = useToast();
  const [lastQuery, setLastQuery] = useState<{ name: string; desc: string; image?: string } | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activeTab]);

  const logSystem = (content: string) =>
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'system', content, timestamp: Date.now() }]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 6_000_000) {
      toast('Image too large (max 6MB). Downsize and retry.', 'warning');
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => setSelectedImage(reader.result as string);
    reader.readAsDataURL(file);
  };

  const clearImage = () => {
    setSelectedImage(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const triggerAnalysis = async (cmdName?: string, cmdDesc?: string) => {
    if (isLoading) return;
    const finalName = cmdName || systemName;
    const finalDesc = cmdDesc || description;

    if (!finalName.trim() && !selectedImage && !finalDesc.trim()) {
      toast('Enter a system name, description, or upload a blueprint.', 'info');
      return;
    }

    const controller = new AbortController();
    analyzeControllerRef.current = controller;

    setIsLoading(true);
    setDiagnosticResult([]);
    setIsScanning(false);
    setLastQuery({ name: finalName, desc: finalDesc, image: selectedImage || undefined });

    let query = '';
    if (finalName) query += `System Name: ${finalName}. `;
    if (finalDesc) query += `Technical Requirements: ${finalDesc}`;

    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: 'user',
        content: `Initialize Project: ${finalName || 'Visual Analysis'}`,
        timestamp: Date.now(),
      },
    ]);

    try {
      const base64 = selectedImage || undefined;
      const result = await analyzeSystem(
        {
          query,
          imageBase64: base64,
          signal: controller.signal,
        },
        (reason) => {
          toast(reason, 'warning', 6000);
          logSystem(reason);
        },
      );
      onSystemLoad(result);
      logSystem(
        `Project '${result.systemName}' compiled. ${result.components.length} subsystems generated.`,
      );
      toast(`'${result.systemName}' ready.`, 'success');
      if (selectedImage) clearImage();
      setActiveTab('info');
      setSystemName('');
      setDescription('');
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        logSystem('Generation cancelled.');
      } else {
        const msg = (error as Error).message || 'unknown';
        logSystem(`Generation failed: ${msg}`);
        toast(msg.includes('quota') ? 'Quota exceeded. Try again later.' : 'Generation failed.', 'error');
      }
    } finally {
      setIsLoading(false);
      analyzeControllerRef.current = null;
    }
  };

  const cancelAnalysis = () => {
    analyzeControllerRef.current?.abort();
  };

  const regenerate = () => {
    if (!lastQuery || isLoading) return;
    setSystemName(lastQuery.name);
    setDescription(lastQuery.desc);
    if (lastQuery.image) setSelectedImage(lastQuery.image);
    triggerAnalysis(lastQuery.name, lastQuery.desc);
  };

  const handleDeepScan = async () => {
    if (!systemData) return;
    setIsScanning(true);
    logSystem('Running Deep Scan Diagnostics...');
    const controller = new AbortController();
    diagControllerRef.current = controller;
    try {
      const results = await runDiagnostics(systemData, controller.signal);
      setDiagnosticResult(results);
      logSystem(`Diagnostics complete. ${results.length} anomalies detected.`);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        logSystem(`Diagnostic scan failed: ${(e as Error).message}`);
        toast('Diagnostics failed.', 'error');
      }
    } finally {
      setIsScanning(false);
      diagControllerRef.current = null;
    }
  };

  const stopScan = () => {
    diagControllerRef.current?.abort();
    setIsScanning(false);
    logSystem('Diagnostic aborted by user.');
  };

  const handleShare = async () => {
    if (!systemData) return;
    try {
      const saved = await saveSystem(systemData);
      const url = `${window.location.origin}/?s=${saved.shareHash}`;
      await navigator.clipboard.writeText(url);
      toast('Share link copied to clipboard.', 'success');
      logSystem(`System saved with share hash: ${saved.shareHash}`);
    } catch (e) {
      toast(`Share failed: ${(e as Error).message}`, 'error');
    }
  };

  const handleChatSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!chatInput.trim() || isChatting) return;

    const userMsg = chatInput.trim();
    setChatInput('');
    const newMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: userMsg,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, newMsg]);
    setIsChatting(true);

    try {
      const apiHistory = [...messages, newMsg]
        .filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role, content: m.content }));

      const context = systemData
        ? `System: ${systemData.systemName}. Description: ${systemData.description}. Components: ${systemData.components.map((c) => c.name).join(', ')}.`
        : undefined;

      const response = await chatWithFriday(apiHistory, userMsg, context);
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: 'model', content: response, timestamp: Date.now() },
      ]);
    } catch (e) {
      logSystem(`Chat failed: ${(e as Error).message}`);
    } finally {
      setIsChatting(false);
    }
  };

  useKeyboardShortcuts([
    { key: 'g', handler: () => setActiveTab('create'), description: 'Focus Create tab' },
    { key: 'i', handler: () => setActiveTab('info'), when: () => !!systemData },
    { key: 'l', handler: () => setActiveTab('logs') },
    { key: 's', handler: handleDeepScan, when: () => !!systemData && !isScanning },
    { key: 'e', handler: () => setExpansion(expansion > 0 ? 0 : 0.5), when: () => !!systemData },
    { key: 'r', handler: regenerate, when: () => !!lastQuery && !isLoading },
    {
      key: 'Escape',
      handler: () => {
        if (isLoading) cancelAnalysis();
        else if (isScanning) stopScan();
        else if (selectedComponent) setSelectedComponentId(null);
      },
    },
  ]);

  return (
    <div className="absolute inset-0 pointer-events-none flex overflow-hidden font-sans select-none">
      <AnimatePresence>
        {isLoading && <InitializationSequence onCancel={cancelAnalysis} estMs={55_000} />}
      </AnimatePresence>

      <motion.div
        initial={{ x: -100, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.6, ease: 'circOut' }}
        className="fixed top-4 left-4 bottom-4 w-96 flex flex-col pointer-events-auto z-20"
        role="complementary"
        aria-label="Control panel"
      >
        <div className="relative w-full h-full bg-[#030712]/80 backdrop-blur-2xl border border-white/10 rounded-3xl shadow-[0_0_40px_rgba(0,0,0,0.5)] flex flex-col overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-cyan-500/50 to-transparent opacity-50" />
          <div className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-purple-500/50 to-transparent opacity-50" />

          <div className="relative z-10 px-6 pt-8 pb-4 border-b border-white/5 bg-gradient-to-b from-white/5 to-transparent">
            <div className="flex items-center gap-4">
              <div className="relative w-12 h-12 flex items-center justify-center" aria-hidden>
                <div className="absolute inset-0 bg-cyan-500/20 blur-xl rounded-full animate-pulse" />
                <svg viewBox="0 0 512 512" className="w-10 h-10 drop-shadow-[0_0_10px_rgba(34,211,238,0.8)]">
                  <defs>
                    <linearGradient id="logo-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#22d3ee" />
                      <stop offset="100%" stopColor="#3b82f6" />
                    </linearGradient>
                  </defs>
                  <g transform="translate(256 256)">
                    <path
                      d="m0-140 121.2 70V70L0 140l-121.2-70V-70Z"
                      fill="none"
                      stroke="url(#logo-gradient)"
                      strokeWidth="14"
                      strokeLinejoin="round"
                    />
                    <path stroke="#ffffff" strokeWidth="30" strokeLinecap="round" d="M-35-75V75m0-150h75m-75 60h65" />
                    <circle cx="70" cy="60" r="12" fill="#22d3ee" />
                  </g>
                </svg>
              </div>
              <div>
                <h1 className="text-xl font-black text-white tracking-[0.2em] font-mono leading-none flex items-center gap-2">
                  FRIDAY <span className="text-[10px] text-cyan-400 font-normal px-1 border border-cyan-500/30 rounded">OS</span>
                </h1>
                <div className="text-[9px] text-gray-400 font-mono tracking-widest mt-1 flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_5px_#22c55e] animate-pulse" />
                  NEURAL ENGINE v1.0
                </div>
              </div>
            </div>
          </div>

          <div className="px-6 py-4" role="tablist" aria-label="Panel navigation">
            <div className="flex bg-black/40 rounded-lg p-1 border border-white/5">
              {(['create', 'info', 'logs'] as const).map((tab) => (
                <button
                  key={tab}
                  role="tab"
                  aria-selected={activeTab === tab}
                  aria-controls={`panel-${tab}`}
                  onClick={() => setActiveTab(tab)}
                  className={`flex-1 py-2 text-[11px] font-bold tracking-widest uppercase rounded-md transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400 ${
                    activeTab === tab
                      ? tab === 'create'
                        ? 'bg-white/10 text-cyan-400'
                        : tab === 'info'
                          ? 'bg-white/10 text-purple-400'
                          : 'bg-white/10 text-green-400'
                      : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-hidden relative flex flex-col min-h-0 bg-gradient-to-b from-transparent to-black/20">
            <AnimatePresence mode="wait">
              {activeTab === 'create' && (
                <motion.div
                  id="panel-create"
                  role="tabpanel"
                  key="create"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.2 }}
                  className="p-6 pt-0 overflow-y-auto h-full space-y-6"
                >
                  <div className="space-y-1">
                    <label
                      htmlFor="system-name"
                      className="flex items-center gap-2 text-[11px] uppercase text-cyan-500 font-bold tracking-widest"
                    >
                      <Terminal size={12} aria-hidden /> System Designation
                    </label>
                    <input
                      id="system-name"
                      type="text"
                      value={systemName}
                      onChange={(e) => setSystemName(e.target.value)}
                      placeholder="V8 Engine, TPU, Warp Drive..."
                      className="w-full bg-white/5 border border-white/10 rounded-lg p-3 text-xs text-white placeholder-gray-600 focus:border-cyan-500/50 focus:bg-cyan-500/5 focus-visible:outline-none focus:ring-1 focus:ring-cyan-500/30 font-mono"
                    />
                  </div>

                  <div className="space-y-1">
                    <label
                      htmlFor="system-desc"
                      className="flex items-center gap-2 text-[11px] uppercase text-purple-500 font-bold tracking-widest"
                    >
                      <FileText size={12} aria-hidden /> Technical Parameters
                    </label>
                    <textarea
                      id="system-desc"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Input constraints and mechanics..."
                      rows={4}
                      className="w-full bg-white/5 border border-white/10 rounded-lg p-3 text-xs text-white placeholder-gray-600 focus:border-purple-500/50 focus:bg-purple-500/5 focus-visible:outline-none focus:ring-1 focus:ring-purple-500/30 font-mono resize-none"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="flex items-center gap-2 text-[11px] uppercase text-green-500 font-bold tracking-widest">
                      <ScanLine size={12} aria-hidden /> Visual Blueprint
                    </label>
                    {selectedImage ? (
                      <div className="relative group rounded-lg overflow-hidden border border-green-500/30">
                        <img src={selectedImage} alt="Uploaded blueprint" className="w-full h-32 object-cover" />
                        <button
                          onClick={clearImage}
                          aria-label="Remove uploaded image"
                          className="absolute top-2 right-2 p-1.5 bg-black/60 backdrop-blur rounded text-red-400 hover:bg-red-500/20"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full border border-dashed border-white/10 rounded-lg h-24 flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-green-500/40 hover:bg-green-500/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-green-400"
                      >
                        <Camera size={16} className="text-gray-500" aria-hidden />
                        <span className="text-[11px] text-gray-500 uppercase tracking-wider">Scan Reference</span>
                      </button>
                    )}
                    <input
                      type="file"
                      ref={fileInputRef}
                      className="hidden"
                      accept="image/*"
                      onChange={handleImageUpload}
                      aria-label="Upload blueprint image"
                    />
                  </div>

                  <div className="flex gap-2 mt-4">
                    <button
                      onClick={() => triggerAnalysis()}
                      disabled={isLoading}
                      className="flex-1 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/50 text-cyan-400 py-4 rounded-lg flex items-center justify-center gap-3 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
                    >
                      <Cpu size={16} className={isLoading ? 'animate-spin' : ''} aria-hidden />
                      <span className="text-xs font-black tracking-[0.2em]">INITIATE</span>
                    </button>
                    {lastQuery && (
                      <button
                        onClick={regenerate}
                        disabled={isLoading}
                        aria-label="Regenerate last system"
                        title="Re-roll (R)"
                        className="px-4 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/50 text-purple-400 rounded-lg disabled:opacity-50"
                      >
                        <RotateCcw size={14} aria-hidden />
                      </button>
                    )}
                  </div>
                </motion.div>
              )}

              {activeTab === 'info' && (
                <motion.div
                  id="panel-info"
                  role="tabpanel"
                  key="info"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.2 }}
                  className="p-6 pt-0 overflow-y-auto h-full space-y-6"
                >
                  {systemData ? (
                    <>
                      <div className="p-4 bg-gradient-to-br from-white/5 to-transparent rounded-lg border border-white/10 relative overflow-hidden">
                        <div className="absolute top-0 right-0 p-2 opacity-20">
                          <Activity size={40} aria-hidden />
                        </div>
                        <h3 className="text-cyan-400 font-bold font-mono text-sm mb-2">{systemData.systemName}</h3>
                        <p className="text-xs text-gray-400 leading-relaxed border-l-2 border-white/10 pl-3">
                          {systemData.description}
                        </p>
                        <div className="mt-3 flex gap-2">
                          <button
                            onClick={handleShare}
                            className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 bg-white/5 hover:bg-white/10 rounded text-[10px] text-gray-300 border border-white/10"
                          >
                            <Share2 size={10} aria-hidden /> Share
                          </button>
                          <button
                            onClick={regenerate}
                            className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 bg-white/5 hover:bg-white/10 rounded text-[10px] text-gray-300 border border-white/10"
                          >
                            <RotateCcw size={10} aria-hidden /> Regen
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="p-3 bg-black/40 rounded-lg border border-white/10 text-center">
                          <div className="text-2xl font-black text-white">
                            {systemData.components.length}
                          </div>
                          <div className="text-[9px] text-gray-500 uppercase tracking-widest mt-1">Modules</div>
                        </div>
                        <div className="p-3 bg-black/40 rounded-lg border border-white/10 text-center">
                          <div className="text-2xl font-black text-purple-400">
                            {systemData.components.reduce((a, c) => a + c.structure.length, 0)}
                          </div>
                          <div className="text-[9px] text-gray-500 uppercase tracking-widest mt-1">Primitives</div>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="flex justify-between items-end border-b border-white/5 pb-1 mb-2">
                          <span className="text-[10px] uppercase text-gray-400 font-bold tracking-widest">
                            Subsystems
                          </span>
                          <span className="text-[9px] text-gray-600 font-mono">LIST_VIEW</span>
                        </div>
                        <ul className="space-y-2" role="list">
                          {systemData.components.map((comp) => (
                            <li key={comp.id}>
                              <button
                                onClick={() => setSelectedComponentId(comp.id)}
                                aria-current={selectedComponent?.id === comp.id}
                                className={`w-full p-3 rounded-lg border flex items-center justify-between text-xs transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400 ${
                                  selectedComponent?.id === comp.id
                                    ? 'bg-cyan-500/10 border-cyan-500/50 text-cyan-100'
                                    : 'bg-white/5 border-transparent text-gray-400 hover:bg-white/10'
                                }`}
                              >
                                <span className="font-mono">{comp.name}</span>
                                <ChevronRight
                                  size={12}
                                  className={
                                    selectedComponent?.id === comp.id
                                      ? 'text-cyan-400 translate-x-1'
                                      : 'text-gray-600'
                                  }
                                  aria-hidden
                                />
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-48 text-gray-600">
                      <Box size={48} strokeWidth={1} className="mb-4 opacity-20" aria-hidden />
                      <span className="text-[10px] uppercase tracking-widest">No Active System</span>
                    </div>
                  )}
                </motion.div>
              )}

              {activeTab === 'logs' && (
                <motion.div
                  id="panel-logs"
                  role="tabpanel"
                  key="logs"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.2 }}
                  className="flex flex-col h-full"
                >
                  <ul
                    className="flex-1 overflow-y-auto px-6 space-y-3 pb-4"
                    aria-live="polite"
                    role="log"
                  >
                    {messages.map((msg) => (
                      <li
                        key={msg.id}
                        className={`p-3 rounded-lg border text-[11px] leading-relaxed ${
                          msg.role === 'user'
                            ? 'bg-cyan-950/30 border-cyan-500/20 text-cyan-100 ml-4'
                            : msg.role === 'model'
                              ? 'bg-[#0a0f1e] border-white/5 text-gray-300 mr-4'
                              : 'bg-black/40 border-white/5 text-green-400/80 font-mono w-full text-center border-dashed'
                        }`}
                      >
                        <div className="flex justify-between items-center mb-1 opacity-40 text-[9px] uppercase tracking-wider font-mono border-b border-white/5 pb-1">
                          <span>{msg.role === 'model' ? 'FRIDAY' : msg.role}</span>
                          <span>
                            {new Date(msg.timestamp).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                        <div className="whitespace-pre-wrap font-mono mt-1">{msg.content}</div>
                      </li>
                    ))}
                    {isChatting && (
                      <li className="flex items-center gap-2 p-2 text-[10px] text-cyan-500 animate-pulse font-mono justify-center">
                        <Activity size={12} aria-hidden />
                        <span>PROCESSING QUERY...</span>
                      </li>
                    )}
                    <div ref={messagesEndRef} />
                  </ul>

                  <div className="p-4 bg-black/40 border-t border-white/5">
                    <form onSubmit={handleChatSubmit} className="relative">
                      <label htmlFor="chat-input" className="sr-only">
                        Ask FRIDAY
                      </label>
                      <input
                        id="chat-input"
                        type="text"
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        placeholder="Execute command..."
                        disabled={isChatting}
                        className="w-full bg-[#0a0f1e] border border-white/10 rounded-lg pl-3 pr-10 py-3 text-xs text-white placeholder-gray-600 focus:border-green-500/40 focus-visible:outline-none focus:ring-1 focus:ring-green-500/20 font-mono disabled:opacity-50"
                      />
                      <button
                        type="submit"
                        disabled={!chatInput.trim() || isChatting}
                        aria-label="Send message"
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-gray-500 hover:text-green-400 disabled:text-gray-700"
                      >
                        <Send size={14} aria-hidden />
                      </button>
                    </form>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="relative z-10 bg-black/60 border-t border-white/10 backdrop-blur-md">
            <VoiceModule onCommand={(cmd) => triggerAnalysis(cmd)} />
          </div>
        </div>
      </motion.div>

      <AnimatePresence>
        {systemData && (
          <motion.div
            initial={{ x: 100, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 100, opacity: 0 }}
            className="fixed right-4 top-4 bottom-4 w-80 pointer-events-auto z-20 flex flex-col"
            role="complementary"
            aria-label="Inspector"
          >
            <div className="w-full h-full bg-[#030712]/80 backdrop-blur-2xl border border-white/10 rounded-3xl flex flex-col overflow-hidden">
              <div className="p-4 border-b border-white/10 flex justify-between items-center bg-gradient-to-b from-white/5 to-transparent">
                <span className="text-[10px] uppercase font-bold text-gray-400 tracking-widest flex items-center gap-2">
                  <Settings size={12} aria-hidden /> Inspector Tools
                </span>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-6">
                <div className="space-y-3 p-3 bg-white/5 rounded-lg border border-white/5">
                  <div className="flex justify-between items-center text-xs text-gray-300">
                    <label
                      htmlFor="expansion"
                      className="flex items-center gap-2 font-bold text-[10px] uppercase tracking-wider"
                    >
                      <Box size={14} className="text-cyan-400" aria-hidden /> Assembly View
                    </label>
                    <span className="font-mono text-cyan-400">{(expansion * 100).toFixed(0)}%</span>
                  </div>
                  <input
                    id="expansion"
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={expansion}
                    onChange={(e) => setExpansion(parseFloat(e.target.value))}
                    className="w-full h-1 bg-gray-800 rounded-lg appearance-none cursor-pointer"
                  />
                </div>

                <div className="space-y-2">
                  {isScanning ? (
                    <button
                      onClick={stopScan}
                      className="w-full bg-red-500/10 border border-red-500/50 text-red-400 py-3 rounded-lg flex items-center justify-center gap-2 animate-pulse"
                    >
                      <StopCircle size={16} aria-hidden />
                      <span className="text-xs font-bold tracking-widest">ABORT SCAN</span>
                    </button>
                  ) : (
                    <button
                      onClick={handleDeepScan}
                      className="w-full bg-green-500/10 hover:bg-green-500/20 border border-green-500/50 text-green-400 py-3 rounded-lg flex items-center justify-center gap-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-green-400"
                    >
                      <ScanLine size={16} aria-hidden />
                      <span className="text-xs font-bold tracking-widest">DEEP SCAN</span>
                    </button>
                  )}

                  <AnimatePresence>
                    {diagnosticResult.length > 0 && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="space-y-2 overflow-hidden"
                      >
                        <div className="text-[10px] text-red-400 font-bold uppercase mt-2 border-b border-red-500/20 pb-1">
                          Anomalies
                        </div>
                        {diagnosticResult.map((res) => (
                          <div
                            key={`${res.componentId}-${res.issue}`}
                            className="bg-red-900/10 border border-red-500/30 p-2 rounded"
                          >
                            <div className="flex justify-between text-[10px] font-bold text-red-200 mb-1">
                              <span>{res.componentId}</span>
                              <span className="uppercase px-1 bg-red-500/20 rounded text-[8px]">
                                {res.severity}
                              </span>
                            </div>
                            <div className="text-[10px] text-gray-400 leading-tight">{res.issue}</div>
                            <div className="text-[10px] text-green-400/70 leading-tight mt-1">
                              → {res.recommendation}
                            </div>
                          </div>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <AnimatePresence>
                  {selectedComponent && (
                    <motion.div
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 20 }}
                      className="bg-white/5 border border-white/10 rounded-xl p-4 relative backdrop-blur-md"
                    >
                      <button
                        onClick={() => setSelectedComponentId(null)}
                        aria-label="Close component details"
                        className="absolute top-2 right-2 text-gray-500 hover:text-white"
                      >
                        <X size={14} />
                      </button>
                      <div className="mb-4">
                        <div className="text-[9px] text-gray-500 uppercase tracking-widest mb-1 flex items-center gap-1">
                          <Cpu size={10} aria-hidden /> Component
                        </div>
                        <h3 className="text-lg font-bold text-white font-mono leading-none">
                          {selectedComponent.name}
                        </h3>
                        <div className="flex items-center gap-2 mt-3">
                          <span
                            className={`text-[9px] px-2 py-0.5 rounded border uppercase font-bold tracking-wider ${
                              selectedComponent.status === 'optimal'
                                ? 'border-green-500 text-green-500 bg-green-500/10'
                                : selectedComponent.status === 'warning'
                                  ? 'border-yellow-500 text-yellow-500 bg-yellow-500/10'
                                  : 'border-red-500 text-red-500 bg-red-500/10'
                            }`}
                          >
                            {selectedComponent.status}
                          </span>
                          <span className="text-[9px] px-2 py-0.5 rounded border border-purple-500 text-purple-400 bg-purple-500/10 uppercase tracking-wider">
                            {selectedComponent.type}
                          </span>
                        </div>
                      </div>
                      <p className="text-xs text-gray-300 leading-relaxed font-mono bg-black/20 p-2 rounded border border-white/5">
                        {selectedComponent.description}
                      </p>
                      <div className="grid grid-cols-2 gap-2 text-[10px] font-mono text-gray-400 mt-3 pt-2 border-t border-white/5">
                        <div>POS: [{selectedComponent.relativePosition.map((n) => n.toFixed(1)).join(',')}]</div>
                        <div>PRIMS: {selectedComponent.structure.length}</div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {!systemData && !isLoading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-10 pointer-events-none">
          <h1 className="text-8xl font-black text-white/5 tracking-[0.5em] font-mono select-none blur-sm">
            FRIDAY
          </h1>
          <div className="h-px w-64 bg-gradient-to-r from-transparent via-cyan-500/20 to-transparent mt-8" />
          <div className="mt-2 text-[10px] text-white/10 font-mono tracking-[0.5em] uppercase">
            System Standby
          </div>
          <div className="mt-6 text-[9px] text-white/20 font-mono">
            Press <kbd className="px-1 border border-white/10 rounded">G</kbd> to generate ·{' '}
            <kbd className="px-1 border border-white/10 rounded">?</kbd> for help
          </div>
        </div>
      )}
    </div>
  );
};
