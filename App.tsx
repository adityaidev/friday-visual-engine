import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Scene3D } from './components/Simulation/Scene3D';
import { HUD } from './components/Interface/HUD';
import { HandControls } from './components/Simulation/HandControls';
import { ErrorBoundary } from './components/Interface/ErrorBoundary';
import { ToastStack } from './components/Interface/ToastStack';
import { SystemAnalysis, DiagnosticResult, CursorState } from './types';
import { Hand } from 'lucide-react';
import { loadSystem } from './services/storage';
import { pushToast } from './hooks/useToast';

const App: React.FC = () => {
  const [systemData, setSystemData] = useState<SystemAnalysis | null>(null);
  const [selectedComponentId, setSelectedComponentId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [expansion, setExpansion] = useState(0);
  const [isScanning, setIsScanning] = useState(false);
  const [diagnosticResult, setDiagnosticResult] = useState<DiagnosticResult[]>([]);

  const [isHandTrackingEnabled, setIsHandTrackingEnabled] = useState(false);
  const [cursorState, setCursorState] = useState<CursorState>({
    x: 0.5,
    y: 0.5,
    active: false,
    mode: 'IDLE',
  });

  const controlsRef = useRef<unknown>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const hash = params.get('s');
    if (!hash) return;
    loadSystem(hash)
      .then((data) => {
        const merged: SystemAnalysis = {
          systemName: data.systemName,
          description: data.description,
          components: (data as unknown as { components?: SystemAnalysis['components'] }).components || [],
          shareHash: data.shareHash,
        };
        setSystemData(merged);
        pushToast(`Loaded shared system: ${data.systemName}`, 'success');
      })
      .catch((e) => pushToast(`Failed to load shared system: ${(e as Error).message}`, 'error'));
  }, []);

  const handleSystemLoad = (data: SystemAnalysis) => {
    setSystemData(data);
    setSelectedComponentId(null);
    setExpansion(0);
    setDiagnosticResult([]);
  };

  const selectedComponent = systemData?.components.find((c) => c.id === selectedComponentId) || null;

  const handleRotate = useCallback((deltaX: number, deltaY: number) => {
    const c = controlsRef.current as {
      getAzimuthalAngle: () => number;
      getPolarAngle: () => number;
      setAzimuthalAngle: (a: number) => void;
      setPolarAngle: (a: number) => void;
      update: () => void;
    } | null;
    if (!c) return;
    c.setAzimuthalAngle(c.getAzimuthalAngle() + deltaX);
    c.setPolarAngle(c.getPolarAngle() + deltaY);
    c.update();
  }, []);

  const handleZoom = useCallback((delta: number) => {
    const c = controlsRef.current as {
      dollyIn: (s: number) => void;
      dollyOut: (s: number) => void;
      update: () => void;
    } | null;
    if (!c) return;
    const scale = 1 + Math.abs(delta);
    if (delta > 0) c.dollyIn(scale);
    else c.dollyOut(scale);
    c.update();
  }, []);

  const handleExplode = useCallback((value: number) => setExpansion(value), []);

  const handleResetCamera = useCallback(() => {
    const c = controlsRef.current as { reset: () => void } | null;
    c?.reset();
    setExpansion(0);
  }, []);

  return (
    <div className="relative w-screen h-screen bg-lumina-base overflow-hidden">
      <a
        href="#main-3d-view"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[200] focus:bg-cyan-500 focus:text-black focus:px-3 focus:py-1 focus:rounded"
      >
        Skip to 3D viewport
      </a>

      <div
        className="absolute inset-0 z-0 opacity-20 pointer-events-none"
        style={{
          backgroundImage:
            'linear-gradient(rgba(0, 240, 255, 0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 240, 255, 0.05) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
        aria-hidden
      />

      <main
        id="main-3d-view"
        className="absolute inset-0 z-0 transition-all duration-500 ease-in-out"
        aria-label="3D simulation viewport"
      >
        <ErrorBoundary>
          <Scene3D
            components={systemData?.components || []}
            selectedId={selectedComponentId}
            onSelect={setSelectedComponentId}
            expansion={expansion}
            isScanning={isScanning}
            controlsRef={controlsRef}
            cursorState={cursorState}
          />
        </ErrorBoundary>
      </main>

      <ErrorBoundary>
        <HUD
          systemData={systemData}
          selectedComponent={selectedComponent}
          onSystemLoad={handleSystemLoad}
          isLoading={isLoading}
          setIsLoading={setIsLoading}
          expansion={expansion}
          setExpansion={setExpansion}
          isScanning={isScanning}
          setIsScanning={setIsScanning}
          diagnosticResult={diagnosticResult}
          setDiagnosticResult={setDiagnosticResult}
          setSelectedComponentId={setSelectedComponentId}
        />
      </ErrorBoundary>

      <div className="absolute bottom-6 right-8 z-40 flex flex-col items-end gap-3 pointer-events-none">
        <button
          onClick={() => setIsHandTrackingEnabled(!isHandTrackingEnabled)}
          aria-pressed={isHandTrackingEnabled}
          aria-label={isHandTrackingEnabled ? 'Disable gesture control' : 'Enable gesture control'}
          className={`pointer-events-auto flex items-center gap-2 px-4 py-2 rounded-full border backdrop-blur-md transition-all duration-300 font-mono text-[10px] uppercase font-bold tracking-widest focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400 ${
            isHandTrackingEnabled
              ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-400 shadow-[0_0_20px_rgba(0,240,255,0.2)]'
              : 'bg-black/40 border-white/10 text-gray-500 hover:text-white hover:border-white/30'
          }`}
        >
          <Hand size={14} className={isHandTrackingEnabled ? 'animate-pulse' : ''} aria-hidden />
          {isHandTrackingEnabled ? 'Gestures Active' : 'Enable Gestures'}
        </button>

        <ErrorBoundary fallback={() => null}>
          <HandControls
            onRotate={handleRotate}
            onZoom={handleZoom}
            onExplode={handleExplode}
            onCursorMove={setCursorState}
            onResetCamera={handleResetCamera}
            enabled={isHandTrackingEnabled}
          />
        </ErrorBoundary>
      </div>

      <ToastStack />
    </div>
  );
};

export default App;
