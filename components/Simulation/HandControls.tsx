import React, { useEffect, useRef, useState } from 'react';
import { Scan, RefreshCcw, Move, ZoomIn, Layers, Settings, X, HelpCircle } from 'lucide-react';
import { CursorState } from '../../types';

declare global {
  interface Window {
    Hands?: new (options: { locateFile: (file: string) => string }) => {
      setOptions: (o: Record<string, unknown>) => void;
      onResults: (cb: (r: HandsResult) => void) => void;
      send: (input: { image: HTMLVideoElement }) => Promise<void>;
    };
    Camera?: new (
      video: HTMLVideoElement,
      options: { onFrame: () => Promise<void>; width: number; height: number },
    ) => { start: () => Promise<void>; stop: () => void };
    drawConnectors?: (
      ctx: CanvasRenderingContext2D,
      landmarks: Landmark[],
      connections: unknown,
      style?: Record<string, unknown>,
    ) => void;
    drawLandmarks?: (
      ctx: CanvasRenderingContext2D,
      landmarks: Landmark[],
      style?: Record<string, unknown>,
    ) => void;
    HAND_CONNECTIONS?: unknown;
  }
}

interface Landmark {
  x: number;
  y: number;
  z: number;
}

interface HandsResult {
  multiHandLandmarks?: Landmark[][];
  multiHandedness?: Array<{ score: number }>;
  image: HTMLVideoElement | HTMLImageElement;
}

interface HandControlsProps {
  onRotate: (deltaX: number, deltaY: number) => void;
  onZoom: (delta: number) => void;
  onExplode: (value: number) => void;
  onCursorMove: (cursor: CursorState) => void;
  onResetCamera: () => void;
  enabled: boolean;
}

const MEDIAPIPE_SCRIPTS = [
  'https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js',
  'https://cdn.jsdelivr.net/npm/@mediapipe/drawing_utils/drawing_utils.js',
  'https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js',
];

async function loadMediaPipe(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (window.Hands && window.Camera) return;
  for (const src of MEDIAPIPE_SCRIPTS) {
    if (document.querySelector(`script[src="${src}"]`)) continue;
    await new Promise<void>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.crossOrigin = 'anonymous';
      s.onload = () => resolve();
      s.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(s);
    });
  }
}

export const HandControls: React.FC<HandControlsProps> = ({
  onRotate,
  onZoom,
  onExplode,
  onCursorMove,
  onResetCamera,
  enabled,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [status, setStatus] = useState<'IDLE' | 'TRACKING' | 'ERROR'>('IDLE');
  const [activeGesture, setActiveGesture] = useState<string>('NONE');
  const [confidence, setConfidence] = useState<number>(0);
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [sensitivity, setSensitivity] = useState(() => {
    if (typeof localStorage === 'undefined') return { rotate: 3, zoom: 5, explode: 2.5 };
    return {
      rotate: parseFloat(localStorage.getItem('sens_rotate') || '3.0'),
      zoom: parseFloat(localStorage.getItem('sens_zoom') || '5.0'),
      explode: parseFloat(localStorage.getItem('sens_explode') || '2.5'),
    };
  });

  const saveSettings = (key: keyof typeof sensitivity, val: number) => {
    localStorage.setItem(`sens_${key}`, val.toString());
    setSensitivity((prev) => ({ ...prev, [key]: val }));
  };

  const onRotateRef = useRef(onRotate);
  const onZoomRef = useRef(onZoom);
  const onExplodeRef = useRef(onExplode);
  const onCursorMoveRef = useRef(onCursorMove);
  const onResetCameraRef = useRef(onResetCamera);
  const sensitivityRef = useRef(sensitivity);

  useEffect(() => {
    onRotateRef.current = onRotate;
    onZoomRef.current = onZoom;
    onExplodeRef.current = onExplode;
    onCursorMoveRef.current = onCursorMove;
    onResetCameraRef.current = onResetCamera;
    sensitivityRef.current = sensitivity;
  }, [onRotate, onZoom, onExplode, onCursorMove, onResetCamera, sensitivity]);

  const prevPinchRef = useRef<{ x: number; y: number } | null>(null);
  const prevDistRef = useRef<number | null>(null);
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;

    let cameraInstance: { start: () => Promise<void>; stop: () => void } | null = null;
    let handsInstance: {
      setOptions: (o: Record<string, unknown>) => void;
      onResults: (cb: (r: HandsResult) => void) => void;
      send: (input: { image: HTMLVideoElement }) => Promise<void>;
    } | null = null;
    let isMounted = true;

    const processGestures = (landmarks: Landmark[][]) => {
      if (!landmarks || landmarks.length === 0) {
        prevPinchRef.current = null;
        prevDistRef.current = null;
        setActiveGesture('STANDBY');
        onCursorMoveRef.current({ x: 0, y: 0, active: false, mode: 'IDLE' });
        if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
        return;
      }

      const dist = (p1: Landmark, p2: Landmark) => Math.hypot(p1.x - p2.x, p1.y - p2.y);
      const isPinching = (lm: Landmark[]) => dist(lm[4], lm[8]) < 0.08;
      const isOpen = (lm: Landmark[]) => dist(lm[4], lm[8]) > 0.1 && dist(lm[8], lm[12]) > 0.1;
      const isFist = (lm: Landmark[]) =>
        lm[8].y > lm[6].y && lm[12].y > lm[10].y && lm[16].y > lm[14].y && lm[20].y > lm[18].y;

      if (landmarks.length === 1 && isFist(landmarks[0])) {
        if (!resetTimerRef.current) {
          setActiveGesture('RESETTING...');
          resetTimerRef.current = window.setTimeout(() => {
            if (isMounted) {
              onResetCameraRef.current();
              setActiveGesture('RESET COMPLETE');
            }
          }, 1000);
        }
        return;
      } else if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
        resetTimerRef.current = null;
      }

      const hand = landmarks[0];
      const cursorX = 1 - hand[9].x;
      const cursorY = hand[9].y;
      const sens = sensitivityRef.current;

      if (landmarks.length === 2) {
        const hand1 = landmarks[0];
        const hand2 = landmarks[1];
        const handDistance = dist(hand1[9], hand2[9]);

        if (isOpen(hand1) && isOpen(hand2)) {
          setActiveGesture('EXPLODE');
          onCursorMoveRef.current({ x: cursorX, y: cursorY, active: true, mode: 'EXPLODE' });
          const val = Math.max(0, Math.min(1, (handDistance - 0.1) * sens.explode));
          onExplodeRef.current(val);
          prevPinchRef.current = null;
          prevDistRef.current = null;
          return;
        }

        if (isPinching(hand1) || isPinching(hand2)) {
          setActiveGesture('ZOOM');
          onCursorMoveRef.current({ x: cursorX, y: cursorY, active: true, mode: 'ZOOM' });
          if (prevDistRef.current !== null) {
            const delta = handDistance - prevDistRef.current;
            onZoomRef.current(delta * sens.zoom);
          }
          prevDistRef.current = handDistance;
          prevPinchRef.current = null;
          return;
        }
      }

      if (landmarks.length >= 1) {
        const activeHand = isPinching(landmarks[0])
          ? landmarks[0]
          : landmarks[1] && isPinching(landmarks[1])
            ? landmarks[1]
            : null;

        if (activeHand) {
          setActiveGesture('ROTATE');
          onCursorMoveRef.current({ x: cursorX, y: cursorY, active: true, mode: 'ROTATE' });
          const pinchCenter = {
            x: (activeHand[4].x + activeHand[8].x) / 2,
            y: (activeHand[4].y + activeHand[8].y) / 2,
          };
          if (prevPinchRef.current) {
            const dx = pinchCenter.x - prevPinchRef.current.x;
            const dy = pinchCenter.y - prevPinchRef.current.y;
            if (Math.abs(dx) > 0.005 || Math.abs(dy) > 0.005) {
              onRotateRef.current(-dx * sens.rotate, -dy * sens.rotate);
            }
          }
          prevPinchRef.current = pinchCenter;
          prevDistRef.current = null;
        } else {
          prevPinchRef.current = null;
          prevDistRef.current = null;
          if (landmarks.length === 1 && isOpen(landmarks[0])) {
            setActiveGesture('DETECTED');
            onCursorMoveRef.current({ x: cursorX, y: cursorY, active: true, mode: 'IDLE' });
          }
        }
      }
    };

    const onResults = (results: HandsResult) => {
      if (!isMounted) return;
      const hasHands = (results.multiHandLandmarks?.length || 0) > 0;
      setStatus(hasHands ? 'TRACKING' : 'IDLE');
      const score = results.multiHandedness?.[0]?.score || 0;
      setConfidence(hasHands ? (score > 0.9 ? 3 : score > 0.7 ? 2 : 1) : 0);

      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (canvas && ctx) {
        ctx.save();
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.scale(-1, 1);
        ctx.translate(-canvas.width, 0);
        ctx.drawImage(results.image as CanvasImageSource, 0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'rgba(3, 7, 18, 0.6)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        if (results.multiHandLandmarks && window.drawConnectors && window.drawLandmarks) {
          for (const lm of results.multiHandLandmarks) {
            window.drawConnectors(ctx, lm, window.HAND_CONNECTIONS, {
              color: '#00f0ff',
              lineWidth: 2,
            });
            window.drawLandmarks(ctx, lm, { color: '#bd00ff', lineWidth: 1, radius: 3 });
          }
        }
        ctx.restore();

        processGestures(results.multiHandLandmarks || []);
      }
    };

    (async () => {
      try {
        await loadMediaPipe();
      } catch (e) {
        if (isMounted) {
          setLoadError((e as Error).message);
          setStatus('ERROR');
        }
        return;
      }
      if (!isMounted || !window.Hands || !window.Camera) {
        if (isMounted) setStatus('ERROR');
        return;
      }
      try {
        handsInstance = new window.Hands({
          locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
        });
        handsInstance.setOptions({
          maxNumHands: 2,
          modelComplexity: 1,
          minDetectionConfidence: 0.6,
          minTrackingConfidence: 0.6,
        });
        handsInstance.onResults(onResults);

        if (videoRef.current) {
          cameraInstance = new window.Camera(videoRef.current, {
            onFrame: async () => {
              if (isMounted && videoRef.current && handsInstance) {
                try {
                  await handsInstance.send({ image: videoRef.current });
                } catch {
                  /* drop */
                }
              }
            },
            width: 320,
            height: 240,
          });
          await cameraInstance.start();
          if (isMounted) setIsInitializing(false);
        }
      } catch (e) {
        if (isMounted) {
          setStatus('ERROR');
          setLoadError((e as Error).message);
        }
      }
    })();

    return () => {
      isMounted = false;
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
      try {
        cameraInstance?.stop();
      } catch {
        /* ignore */
      }
      handsInstance = null;
      cameraInstance = null;
    };
  }, [enabled]);

  if (!enabled) return null;

  return (
    <div className="flex flex-col items-end gap-3 pointer-events-none">
      <div className="relative w-56 h-40 bg-[#030712]/90 backdrop-blur-xl border border-cyan-500/30 rounded-lg overflow-hidden shadow-[0_0_30px_rgba(0,240,255,0.1)] pointer-events-auto">
        <div className="absolute top-0 left-0 right-0 bg-cyan-500/10 p-1.5 flex justify-between items-center px-3 z-10 border-b border-cyan-500/20">
          <div className="flex items-center gap-1.5">
            <Scan size={12} className="text-cyan-400" aria-hidden />
            <span className="text-[9px] font-mono text-cyan-300 uppercase tracking-wider font-bold">
              Motion Capture
            </span>
          </div>
          <div className="flex gap-0.5" aria-label={`Tracking confidence ${confidence} of 3`}>
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                className={`w-1 h-3 rounded-sm ${
                  confidence >= n
                    ? n === 1
                      ? confidence === 1
                        ? 'bg-red-500'
                        : 'bg-green-400'
                      : n === 2
                        ? confidence === 2
                          ? 'bg-yellow-400'
                          : 'bg-green-400'
                        : 'bg-green-400'
                    : 'bg-gray-800'
                }`}
              />
            ))}
          </div>
        </div>

        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-cover opacity-20 transform scale-x-[-1]"
          playsInline
          muted
          aria-hidden
        />
        <canvas
          ref={canvasRef}
          width={320}
          height={240}
          className="absolute inset-0 w-full h-full object-cover transform scale-x-[-1]"
          aria-label="Hand tracking visualization"
        />

        {isInitializing && !loadError && (
          <div
            role="status"
            className="absolute inset-0 flex items-center justify-center bg-black/80 z-20"
          >
            <div className="flex flex-col items-center gap-2">
              <RefreshCcw size={20} className="text-cyan-500 animate-spin" />
              <span className="text-[9px] text-cyan-500/70 font-mono">INITIALIZING SENSORS...</span>
            </div>
          </div>
        )}

        {loadError && (
          <div
            role="alert"
            className="absolute inset-0 flex items-center justify-center bg-red-950/80 z-20 p-3"
          >
            <span className="text-[9px] text-red-300 font-mono text-center">
              {loadError.includes('Permission') || status === 'ERROR'
                ? 'Camera access denied or offline. Enable permissions and retry.'
                : loadError}
            </span>
          </div>
        )}

        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent p-2 pt-6 text-center">
          <span
            className={`text-[10px] font-mono font-bold tracking-[0.2em] uppercase transition-colors duration-300 ${
              activeGesture.includes('RESET')
                ? 'text-red-400 animate-pulse'
                : activeGesture === 'ROTATE'
                  ? 'text-green-400'
                  : activeGesture === 'ZOOM'
                    ? 'text-purple-400'
                    : activeGesture === 'EXPLODE'
                      ? 'text-yellow-400'
                      : 'text-gray-500'
            }`}
          >
            {activeGesture === 'STANDBY' ? 'WAITING FOR INPUT' : activeGesture}
          </span>
        </div>

        <div className="absolute top-8 right-2 flex flex-col gap-2">
          <button
            onClick={() => setShowSettings(!showSettings)}
            aria-label="Toggle sensitivity settings"
            className="p-1.5 bg-black/40 rounded hover:bg-cyan-500/20 text-gray-400 hover:text-cyan-400"
          >
            <Settings size={12} />
          </button>
          <button
            onClick={() => setShowHelp(!showHelp)}
            aria-label="Toggle gesture guide"
            className="p-1.5 bg-black/40 rounded hover:bg-cyan-500/20 text-gray-400 hover:text-cyan-400"
          >
            <HelpCircle size={12} />
          </button>
        </div>
      </div>

      {(showSettings || showHelp) && (
        <div className="bg-[#030712]/90 backdrop-blur border border-white/10 rounded-lg p-3 w-56 pointer-events-auto space-y-3 relative">
          <button
            onClick={() => {
              setShowSettings(false);
              setShowHelp(false);
            }}
            aria-label="Close panel"
            className="absolute top-2 right-2 text-gray-500 hover:text-white"
          >
            <X size={12} />
          </button>

          {showSettings && (
            <div className="space-y-3">
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest border-b border-white/10 pb-1">
                Sensitivity
              </div>
              {(
                [
                  { label: 'Rotation', key: 'rotate', max: 5 },
                  { label: 'Zoom', key: 'zoom', max: 10 },
                  { label: 'Explode', key: 'explode', max: 5 },
                ] as const
              ).map((opt) => (
                <div key={opt.key} className="space-y-1">
                  <div className="flex justify-between text-[9px] text-gray-400">
                    <label htmlFor={`sens-${opt.key}`}>{opt.label}</label>
                    <span>{sensitivity[opt.key].toFixed(1)}</span>
                  </div>
                  <input
                    id={`sens-${opt.key}`}
                    type="range"
                    min="0.5"
                    max={opt.max}
                    step="0.1"
                    value={sensitivity[opt.key]}
                    onChange={(e) => saveSettings(opt.key, parseFloat(e.target.value))}
                    className="w-full h-1 bg-gray-800 rounded-lg appearance-none cursor-pointer"
                  />
                </div>
              ))}
            </div>
          )}

          {showHelp && (
            <div className="space-y-2">
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest border-b border-white/10 pb-1">
                Gesture Guide
              </div>
              <div className="grid grid-cols-1 gap-2">
                <GestureRow
                  icon={<Move size={12} className="text-cyan-400" />}
                  label="Rotate"
                  desc="Pinch & Drag (1 Hand)"
                />
                <GestureRow
                  icon={<ZoomIn size={12} className="text-purple-400" />}
                  label="Zoom"
                  desc="Pinch In/Out (2 Hands)"
                />
                <GestureRow
                  icon={<Layers size={12} className="text-yellow-400" />}
                  label="Explode"
                  desc="Open Hands Apart"
                />
                <GestureRow
                  icon={<RefreshCcw size={12} className="text-red-400" />}
                  label="Reset"
                  desc="Hold Fist (1 sec)"
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const GestureRow: React.FC<{ icon: React.ReactNode; label: string; desc: string }> = ({
  icon,
  label,
  desc,
}) => (
  <div className="flex items-center justify-between text-[9px] text-gray-400">
    <div className="flex items-center gap-2">
      {icon}
      <span className="font-bold text-white">{label}</span>
    </div>
    <span>{desc}</span>
  </div>
);
