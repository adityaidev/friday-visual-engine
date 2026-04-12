import { Type } from '@google/genai';

export const AnalysisSchema = {
  type: Type.OBJECT,
  properties: {
    systemName: { type: Type.STRING },
    description: { type: Type.STRING },
    components: {
      type: Type.ARRAY,
      minItems: 1,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          type: {
            type: Type.STRING,
            enum: ['COMPUTE', 'STORAGE', 'NETWORK', 'SENSOR', 'MECHANICAL', 'POWER', 'UNKNOWN'],
          },
          relativePosition: {
            type: Type.ARRAY,
            items: { type: Type.NUMBER },
          },
          structure: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                shape: {
                  type: Type.STRING,
                  enum: ['BOX', 'CYLINDER', 'SPHERE', 'CAPSULE', 'CONE', 'TORUS'],
                },
                args: { type: Type.ARRAY, items: { type: Type.NUMBER } },
                position: { type: Type.ARRAY, items: { type: Type.NUMBER } },
                rotation: { type: Type.ARRAY, items: { type: Type.NUMBER } },
                colorHex: { type: Type.STRING },
              },
              required: ['shape', 'args', 'position', 'rotation'],
            },
          },
          description: { type: Type.STRING },
          connections: { type: Type.ARRAY, items: { type: Type.STRING } },
          status: { type: Type.STRING, enum: ['optimal', 'warning', 'critical'] },
        },
        required: ['name', 'type', 'structure', 'relativePosition', 'description', 'connections', 'status'],
      },
    },
  },
  required: ['systemName', 'description', 'components'],
};

export const DiagnosticSchema = {
  type: Type.OBJECT,
  properties: {
    issues: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          componentId: { type: Type.STRING },
          issue: { type: Type.STRING },
          recommendation: { type: Type.STRING },
          severity: { type: Type.STRING, enum: ['low', 'medium', 'high'] },
        },
        required: ['componentId', 'issue', 'recommendation', 'severity'],
      },
    },
  },
  required: ['issues'],
};
