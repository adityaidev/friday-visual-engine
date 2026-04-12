export enum NodeType {
  COMPUTE = 'COMPUTE',
  STORAGE = 'STORAGE',
  NETWORK = 'NETWORK',
  SENSOR = 'SENSOR',
  MECHANICAL = 'MECHANICAL',
  POWER = 'POWER',
  UNKNOWN = 'UNKNOWN',
}

export enum PrimitiveShape {
  BOX = 'BOX',
  CYLINDER = 'CYLINDER',
  SPHERE = 'SPHERE',
  CAPSULE = 'CAPSULE',
  CONE = 'CONE',
  TORUS = 'TORUS',
}

export interface GeometricPrimitive {
  shape: PrimitiveShape;
  args: number[];
  position: [number, number, number];
  rotation: [number, number, number];
  colorHex?: string;
}

export interface SystemComponent {
  id: string;
  name: string;
  type: NodeType;
  description: string;
  details: Record<string, string>;
  connections: string[];
  relativePosition: [number, number, number];
  structure: GeometricPrimitive[];
  status: 'optimal' | 'warning' | 'critical';
}

export interface SystemAnalysis {
  systemName: string;
  description: string;
  components: SystemComponent[];
  id?: string;
  createdAt?: string;
  shareHash?: string;
}

export interface Message {
  id: string;
  role: 'user' | 'model' | 'system';
  content: string;
  timestamp: number;
}

export interface DiagnosticResult {
  componentId: string;
  issue: string;
  recommendation: string;
  severity: 'low' | 'medium' | 'high';
}

export interface CursorState {
  x: number;
  y: number;
  active: boolean;
  mode: 'IDLE' | 'ROTATE' | 'ZOOM' | 'EXPLODE' | 'RESET';
}

export interface LiveToken {
  token: string;
  expiresAt: number;
}

export type ModelTier = 'pro' | 'flash' | 'flash-lite';

export interface ApiError {
  code: 'RATE_LIMIT' | 'QUOTA_EXCEEDED' | 'UNAUTHORIZED' | 'BAD_REQUEST' | 'UPSTREAM' | 'UNKNOWN';
  message: string;
  retryAfterMs?: number;
}
