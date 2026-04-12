import React, { useMemo, useRef, useEffect } from 'react';
import { Canvas, useFrame, useThree, ThreeEvent } from '@react-three/fiber';
import { OrbitControls, Stars, Environment, Text, Edges, Billboard, AdaptiveDpr, AdaptiveEvents, PerformanceMonitor } from '@react-three/drei';
import * as THREE from 'three';
import { SystemComponent, NodeType, PrimitiveShape, GeometricPrimitive, CursorState } from '../../types';

const HologramShader = {
  uniforms: {
    time: { value: 0 },
    color: { value: new THREE.Color('#00f0ff') },
    scanPos: { value: -100.0 },
  },
  vertexShader: `
    varying vec3 vNormal;
    varying vec3 vPosition;
    void main() {
      vNormal = normalize(normalMatrix * normal);
      vPosition = (modelMatrix * vec4(position, 1.0)).xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform float time;
    uniform vec3 color;
    uniform float scanPos;
    varying vec3 vNormal;
    varying vec3 vPosition;
    void main() {
      vec3 viewDirection = normalize(cameraPosition - vPosition);
      float fresnel = pow(1.0 - dot(viewDirection, vNormal), 3.0);
      float scanline = sin(vPosition.y * 50.0 + time * 2.0) * 0.1 + 0.9;
      float scanDist = abs(vPosition.y - scanPos);
      float scanBeam = smoothstep(0.5, 0.0, scanDist) * 2.0;
      vec3 finalColor = color * scanline + color * fresnel + vec3(1.0) * scanBeam;
      float alpha = 0.15 + fresnel * 0.5 + scanBeam;
      gl_FragColor = vec4(finalColor, alpha);
    }
  `,
};

const TypeColors: Record<NodeType, string> = {
  [NodeType.COMPUTE]: '#00f0ff',
  [NodeType.STORAGE]: '#ffd700',
  [NodeType.NETWORK]: '#bd00ff',
  [NodeType.SENSOR]: '#ff0055',
  [NodeType.MECHANICAL]: '#55ff55',
  [NodeType.POWER]: '#ffa500',
  [NodeType.UNKNOWN]: '#ffffff',
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
}> = ({ primitive, baseColor, isSelected, scanY }) => {
  const { shape, args, position, rotation, colorHex } = primitive;
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const finalColor = useMemo(
    () => new THREE.Color(isSelected ? '#ffffff' : colorHex || baseColor),
    [isSelected, colorHex, baseColor],
  );

  useFrame((state) => {
    const m = materialRef.current;
    if (!m) return;
    m.uniforms.time.value = state.clock.elapsedTime;
    m.uniforms.color.value.lerp(finalColor, 0.1);
    m.uniforms.scanPos.value = scanY;
  });

  useEffect(() => {
    return () => {
      materialRef.current?.dispose();
    };
  }, []);

  return (
    <group position={position} rotation={rotation}>
      <mesh>
        <GeometryRenderer shape={shape} args={args} />
        <shaderMaterial
          ref={materialRef}
          args={[HologramShader]}
          transparent
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      <mesh>
        <GeometryRenderer shape={shape} args={args} />
        <meshBasicMaterial color={finalColor} wireframe transparent opacity={0.2} />
      </mesh>
      <mesh>
        <GeometryRenderer shape={shape} args={args} />
        <Edges threshold={15} color={isSelected ? 'white' : baseColor} scale={1} />
        <meshBasicMaterial visible={false} />
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
}> = ({ data, onSelect, isSelected, expansion, registerRef, scanY }) => {
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

  const baseColor = TypeColors[type] || TypeColors.UNKNOWN;

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
        />
      )}
      <Billboard position={[0, 1.5, 0]}>
        <Text fontSize={0.2} color={isSelected ? '#ffffff' : baseColor} anchorX="center" anchorY="middle">
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

  return (
    <>
      <ambientLight intensity={0.2} />
      <pointLight position={[20, 20, 20]} intensity={2} color="#ffffff" />
      <pointLight position={[-20, -10, -10]} intensity={1} color="#00aaff" />
      {qualityTier >= 2 && <spotLight position={[0, 30, 0]} angle={0.6} penumbra={1} intensity={2} castShadow />}

      <ScanningPlane scanning={isScanning} scanYRef={scanYRef} />
      <HoloCursor cursorState={cursorState} />

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
          />
        ))}
      </group>

      <DataStreams components={components} nodeRefs={nodeRefs} />

      {qualityTier >= 2 && <Environment preset="city" blur={0.8} />}
      <Stars
        radius={150}
        depth={50}
        count={qualityTier >= 2 ? 5000 : 1000}
        factor={4}
        saturation={0}
        fade
        speed={0.5}
      />

      <gridHelper args={[60, 60, 0x111111, 0x050505]} position={[0, -8, 0]} />
      <OrbitControls
        ref={controlsRef as React.MutableRefObject<null>}
        enablePan
        enableZoom
        enableRotate
        autoRotate={false}
        dampingFactor={0.05}
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
        camera={{ position: [12, 8, 12], fov: 40 }}
        dpr={[1, Math.min(2, qualityTier >= 2 ? 2 : 1.5)]}
        gl={{
          antialias: qualityTier >= 2,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.1,
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
