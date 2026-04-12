import React, { useMemo, useRef, useEffect } from 'react';
import { Canvas, useFrame, useThree, ThreeEvent } from '@react-three/fiber';
import {
  OrbitControls,
  Stars,
  Text,
  Edges,
  Billboard,
  AdaptiveDpr,
  AdaptiveEvents,
  PerformanceMonitor,
  Bounds,
} from '@react-three/drei';
import * as THREE from 'three';
import { SystemComponent, NodeType, PrimitiveShape, GeometricPrimitive, CursorState } from '../../types';

// Blueprint CAD palette — bright mint/cyan edges on clean white surfaces,
// matching the reference screenshot's technical-drawing aesthetic.
const EDGE_COLOR = '#4ce1a3'; // mint green — primary edge line
const EDGE_SELECTED = '#ffffff';
const LABEL_COLORS: Record<NodeType, string> = {
  [NodeType.COMPUTE]: '#61d9ff',
  [NodeType.STORAGE]: '#ffcd6b',
  [NodeType.NETWORK]: '#c792ea',
  [NodeType.SENSOR]: '#ff7a7a',
  [NodeType.MECHANICAL]: '#4ce1a3',
  [NodeType.POWER]: '#ffb347',
  [NodeType.UNKNOWN]: '#4ce1a3',
};

const TypeColors: Record<NodeType, string> = {
  [NodeType.COMPUTE]: '#f4f6fa',
  [NodeType.STORAGE]: '#f4f6fa',
  [NodeType.NETWORK]: '#f4f6fa',
  [NodeType.SENSOR]: '#f4f6fa',
  [NodeType.MECHANICAL]: '#f4f6fa',
  [NodeType.POWER]: '#f4f6fa',
  [NodeType.UNKNOWN]: '#f4f6fa',
};

const GeometryRenderer: React.FC<{ shape: PrimitiveShape; args: number[] }> = React.memo(
  ({ shape, args }) => {
    switch (shape) {
      case PrimitiveShape.BOX:
        return <boxGeometry args={[args[0] || 1, args[1] || 1, args[2] || 1]} />;
      case PrimitiveShape.CYLINDER:
        return <cylinderGeometry args={[args[0] || 0.5, args[1] || 0.5, args[2] || 1, 32]} />;
      case PrimitiveShape.SPHERE:
        return <sphereGeometry args={[args[0] || 0.5, 32, 32]} />;
      case PrimitiveShape.CAPSULE:
        return <capsuleGeometry args={[args[0] || 0.5, args[1] || 1, 4, 16]} />;
      case PrimitiveShape.CONE:
        return <coneGeometry args={[args[0] || 0.5, args[1] || 1, 32]} />;
      case PrimitiveShape.TORUS:
        return <torusGeometry args={[args[0] || 0.5, args[1] || 0.2, 16, 32]} />;
      default:
        return <boxGeometry args={[1, 1, 1]} />;
    }
  },
);

const ProceduralMesh: React.FC<{
  primitive: GeometricPrimitive;
  baseColor: string;
  isSelected: boolean;
  scanY: number;
  isScanning: boolean;
}> = ({ primitive, baseColor, isSelected, scanY, isScanning }) => {
  const { shape, args, position, rotation, colorHex } = primitive;
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);
  const meshRef = useRef<THREE.Mesh>(null);

  // Clean CAD-blueprint look: near-white diffuse with a hint of the material
  // color the model picked. Not metallic, not glossy.
  const surfaceColor = useMemo(() => {
    const base = new THREE.Color('#f2f4f8');
    if (colorHex) {
      const tint = new THREE.Color(colorHex);
      base.lerp(tint, 0.18); // 82% white / 18% material tint
    }
    return base;
  }, [colorHex]);

  useFrame(() => {
    const m = materialRef.current;
    const mesh = meshRef.current;
    if (!m || !mesh) return;
    m.color.lerp(surfaceColor, 0.2);

    if (isScanning) {
      const worldY = mesh.getWorldPosition(new THREE.Vector3()).y;
      const dist = Math.abs(worldY - scanY);
      const glow = Math.max(0, 0.6 - dist * 0.35);
      m.emissive.setRGB(0, glow * 0.6, glow * 0.4);
      m.emissiveIntensity = 1;
    } else if (isSelected) {
      m.emissive.setRGB(0.12, 0.25, 0.18);
      m.emissiveIntensity = 1;
    } else {
      m.emissive.setRGB(0.02, 0.04, 0.05);
      m.emissiveIntensity = 1;
    }
  });

  useEffect(() => {
    return () => {
      materialRef.current?.dispose();
    };
  }, []);

  const edgeColor = isSelected ? EDGE_SELECTED : baseColor;

  return (
    <group position={position} rotation={rotation}>
      <mesh ref={meshRef} castShadow receiveShadow>
        <GeometryRenderer shape={shape} args={args} />
        <meshStandardMaterial
          ref={materialRef}
          color={surfaceColor}
          metalness={0.08}
          roughness={0.75}
          envMapIntensity={0.4}
        />
        <Edges threshold={14} color={edgeColor} scale={1.002} renderOrder={1} />
      </mesh>
    </group>
  );
};

const TechPart: React.FC<{
  data: SystemComponent;
  onSelect: (id: string) => void;
  isSelected: boolean;
  expansion: number;
  registerRef: (id: string, obj: THREE.Object3D | null) => void;
  scanY: number;
  isScanning: boolean;
}> = ({ data, onSelect, isSelected, expansion, registerRef, scanY, isScanning }) => {
  const { type, relativePosition, id, structure } = data;
  const groupRef = useRef<THREE.Group>(null);
  const targetPos = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    targetPos.set(
      relativePosition[0] * (1 + expansion * 2),
      relativePosition[1] * (1 + expansion * 2),
      relativePosition[2] * (1 + expansion * 2),
    );
    groupRef.current.position.lerp(targetPos, 0.1);
    if (isSelected) {
      groupRef.current.rotation.y += delta * 0.5;
    } else {
      groupRef.current.rotation.y = THREE.MathUtils.lerp(groupRef.current.rotation.y, 0, 0.1);
    }
  });

  useEffect(() => {
    registerRef(id, groupRef.current);
    return () => registerRef(id, null);
  }, [id, registerRef]);

  const baseColor = EDGE_COLOR;
  const labelColor = LABEL_COLORS[type] || LABEL_COLORS.UNKNOWN;

  return (
    <group
      ref={groupRef}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        onSelect(id);
      }}
      onPointerOver={() => {
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={() => {
        document.body.style.cursor = 'auto';
      }}
    >
      {structure && structure.length > 0 ? (
        structure.map((prim, idx) => (
          <ProceduralMesh
            key={`${id}-prim-${idx}`}
            primitive={prim}
            baseColor={baseColor}
            isSelected={isSelected}
            scanY={scanY}
            isScanning={isScanning}
          />
        ))
      ) : (
        <ProceduralMesh
          primitive={{
            shape: PrimitiveShape.BOX,
            args: [1, 1, 1],
            position: [0, 0, 0],
            rotation: [0, 0, 0],
          }}
          baseColor={baseColor}
          isSelected={isSelected}
          scanY={scanY}
          isScanning={isScanning}
        />
      )}
      <Billboard position={[0, 1.6, 0]} follow>
        <Text
          fontSize={isSelected ? 0.32 : 0.24}
          color={isSelected ? '#ffffff' : labelColor}
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.035}
          outlineColor="#030712"
          outlineBlur={0.05}
          renderOrder={2}
          depthOffset={-1}
          material-depthTest={false}
          material-transparent={true}
          material-toneMapped={false}
        >
          {data.name}
        </Text>
      </Billboard>
    </group>
  );
};

const DynamicLine: React.FC<{
  startId: string;
  endId: string;
  nodeRefs: React.MutableRefObject<Record<string, THREE.Object3D | null>>;
}> = ({ startId, endId, nodeRefs }) => {
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    return geo;
  }, []);
  const materialRef = useRef<THREE.LineDashedMaterial>(null);

  useEffect(() => {
    return () => {
      geometry.dispose();
      materialRef.current?.dispose();
    };
  }, [geometry]);

  useFrame(() => {
    const s = nodeRefs.current[startId];
    const e = nodeRefs.current[endId];
    if (!s || !e) return;
    const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
    pos.setXYZ(0, s.position.x, s.position.y, s.position.z);
    pos.setXYZ(1, e.position.x, e.position.y, e.position.z);
    pos.needsUpdate = true;
    geometry.computeBoundingSphere();
  });

  const lineObj = useMemo(() => {
    const mat = new THREE.LineDashedMaterial({
      color: '#777777',
      transparent: true,
      opacity: 0.4,
      dashSize: 0.2,
      gapSize: 0.1,
      depthTest: false,
    });
    materialRef.current = mat;
    return new THREE.Line(geometry, mat);
  }, [geometry]);

  return <primitive object={lineObj} />;
};

const DataStreams: React.FC<{
  components: SystemComponent[];
  nodeRefs: React.MutableRefObject<Record<string, THREE.Object3D | null>>;
}> = ({ components, nodeRefs }) => {
  const connections = useMemo(() => {
    const seen = new Set<string>();
    const conns: { start: string; end: string }[] = [];
    components.forEach((comp) => {
      comp.connections.forEach((target) => {
        const key = [comp.id, target].sort().join('::');
        if (seen.has(key)) return;
        seen.add(key);
        conns.push({ start: comp.id, end: target });
      });
    });
    return conns;
  }, [components]);

  return (
    <group>
      {connections.map((c) => (
        <DynamicLine key={`${c.start}::${c.end}`} startId={c.start} endId={c.end} nodeRefs={nodeRefs} />
      ))}
    </group>
  );
};

const ScanningPlane: React.FC<{ scanning: boolean; scanYRef: React.MutableRefObject<number> }> = ({
  scanning,
  scanYRef,
}) => {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (!ref.current) return;
    if (scanning) {
      const y = Math.sin(state.clock.elapsedTime * 2) * 10;
      ref.current.position.y = y;
      scanYRef.current = y;
      ref.current.visible = true;
    } else {
      ref.current.visible = false;
      scanYRef.current = -100;
    }
  });
  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
      <planeGeometry args={[50, 50]} />
      <meshBasicMaterial
        color="#00ff9d"
        transparent
        opacity={0.1}
        side={THREE.DoubleSide}
        blending={THREE.AdditiveBlending}
      />
      <Edges color="#00ff9d" />
    </mesh>
  );
};

const HoloCursor: React.FC<{ cursorState: CursorState }> = ({ cursorState }) => {
  const meshRef = useRef<THREE.Group>(null);
  const { viewport } = useThree();
  const target = useMemo(() => new THREE.Vector3(), []);

  useFrame((state, delta) => {
    if (!meshRef.current) return;
    target.set(
      (cursorState.x - 0.5) * viewport.width,
      -(cursorState.y - 0.5) * viewport.height,
      0,
    );
    meshRef.current.position.lerp(target, 0.2);
    meshRef.current.rotation.z += delta * 2;
    meshRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 3) * 0.2;
    const targetScale = cursorState.active ? 1.5 : 1;
    meshRef.current.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), 0.1);
  });

  if (!cursorState.active && cursorState.mode === 'IDLE') return null;

  const color =
    cursorState.mode === 'ROTATE'
      ? '#4ade80'
      : cursorState.mode === 'ZOOM'
        ? '#c084fc'
        : cursorState.mode === 'EXPLODE'
          ? '#facc15'
          : '#22d3ee';

  return (
    <group ref={meshRef}>
      <mesh>
        <torusGeometry args={[0.3, 0.02, 16, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.8} />
      </mesh>
    </group>
  );
};

const SceneContent: React.FC<{
  components: SystemComponent[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  expansion: number;
  isScanning: boolean;
  controlsRef: React.MutableRefObject<unknown>;
  cursorState: CursorState;
  qualityTier: number;
}> = ({ components, selectedId, onSelect, expansion, isScanning, controlsRef, cursorState, qualityTier }) => {
  const nodeRefs = useRef<Record<string, THREE.Object3D | null>>({});
  const scanYRef = useRef<number>(-100);

  const registerRef = useMemo(
    () => (id: string, obj: THREE.Object3D | null) => {
      if (obj) nodeRefs.current[id] = obj;
      else delete nodeRefs.current[id];
    },
    [],
  );

  useEffect(() => {
    const currentIds = new Set(components.map((c) => c.id));
    Object.keys(nodeRefs.current).forEach((id) => {
      if (!currentIds.has(id)) delete nodeRefs.current[id];
    });
  }, [components]);

  const componentsKey = useMemo(
    () => components.map((c) => c.id).join('|'),
    [components],
  );

  return (
    <>
      <color attach="background" args={['#030712']} />
      <fog attach="fog" args={['#030712', 55, 140]} />

      {/* Even CAD-blueprint lighting — no harsh shadows, everything readable */}
      <ambientLight intensity={0.9} />
      <hemisphereLight args={['#e8eef7', '#1a2030', 0.6]} />
      <directionalLight position={[14, 20, 10]} intensity={0.6} color="#ffffff" />
      <directionalLight position={[-14, 12, -8]} intensity={0.35} color="#b7e4ff" />

      <ScanningPlane scanning={isScanning} scanYRef={scanYRef} />
      <HoloCursor cursorState={cursorState} />

      <Bounds key={componentsKey} fit clip observe margin={1.3} maxDuration={0.8}>
        <group>
          {components.map((comp) => (
            <TechPart
              key={comp.id}
              data={comp}
              isSelected={selectedId === comp.id}
              onSelect={onSelect}
              expansion={expansion}
              registerRef={registerRef}
              scanY={scanYRef.current}
              isScanning={isScanning}
            />
          ))}
        </group>
      </Bounds>

      <DataStreams components={components} nodeRefs={nodeRefs} />

      <Stars
        radius={180}
        depth={60}
        count={qualityTier >= 2 ? 2000 : 500}
        factor={2}
        saturation={0}
        fade
        speed={0.2}
      />

      <gridHelper args={[80, 80, 0x1a3a2a, 0x0a1410]} position={[0, -8, 0]} />
      <OrbitControls
        ref={controlsRef as React.MutableRefObject<null>}
        enablePan
        enableZoom
        enableRotate
        autoRotate={false}
        dampingFactor={0.08}
        minDistance={2}
        maxDistance={80}
      />
    </>
  );
};

export const Scene3D: React.FC<{
  components: SystemComponent[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  expansion: number;
  isScanning: boolean;
  cursorState: CursorState;
  controlsRef?: React.MutableRefObject<unknown>;
}> = ({ controlsRef, ...props }) => {
  const internalRef = useRef<unknown>(null);
  const finalRef = controlsRef || internalRef;
  const [qualityTier, setQualityTier] = React.useState(2);

  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  return (
    <div className="w-full h-full bg-lumina-base">
      <Canvas
        shadows={qualityTier >= 2}
        camera={{ position: [14, 9, 14], fov: 38, near: 0.1, far: 200 }}
        dpr={[1, Math.min(2, qualityTier >= 2 ? 2 : 1.5)]}
        gl={{
          antialias: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.05,
          powerPreference: 'high-performance',
        }}
      >
        <PerformanceMonitor
          onDecline={() => setQualityTier((t) => Math.max(1, t - 1))}
          onIncline={() => setQualityTier((t) => Math.min(2, t + 1))}
        />
        <AdaptiveDpr pixelated />
        <AdaptiveEvents />
        <SceneContent
          {...props}
          controlsRef={finalRef}
          qualityTier={prefersReducedMotion ? 1 : qualityTier}
        />
      </Canvas>
    </div>
  );
};
