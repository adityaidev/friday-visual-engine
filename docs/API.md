# FRIDAY — Edge Function API

All endpoints live under `/api/` and run on Vercel's Edge Runtime.

## Common

- **Origin**: CORS controlled by `ALLOWED_ORIGINS` env var (default `*`).
- **Rate limiting**: per-IP, tracked in Supabase. Response headers:
  - `X-RateLimit-Remaining`
  - `X-RateLimit-Reset` (unix seconds)
  - `Retry-After` (seconds, only on 429)
- **Errors**: `{ "error": { "code": "...", "message": "...", "retryAfterMs"?: number } }`

### Error codes

| Code | HTTP | Meaning |
|---|---|---|
| `BAD_REQUEST` | 400 | Payload missing/invalid |
| `METHOD_NOT_ALLOWED` | 405 | Wrong HTTP verb |
| `RATE_LIMIT` | 429 | Per-IP limit hit |
| `QUOTA_EXCEEDED` | 429 | Gemini quota depleted |
| `NOT_FOUND` | 404 | Record not found |
| `UPSTREAM` | 502 | Gemini or Supabase error |

---

## POST /api/analyze

Generate a 3D `SystemAnalysis` from text and/or image.

**Request**
```json
{
  "query": "V8 engine",
  "imageBase64": "data:image/png;base64,....",
  "tier": "pro" | "flash"
}
```

**Rate limit**: 10/hour per IP.

**Response** (200)
```json
{
  "systemName": "V8 Engine",
  "description": "...",
  "components": [
    {
      "id": "piston-head",
      "name": "Piston Head",
      "type": "MECHANICAL",
      "status": "optimal",
      "relativePosition": [0, 0, 0],
      "structure": [{ "shape": "CYLINDER", "args": [...], "position": [...], "rotation": [...] }],
      "connections": ["connecting-rod"],
      "description": "..."
    }
  ]
}
```

---

## POST /api/diagnostics

Run reliability analysis on a known system.

**Request**
```json
{
  "systemName": "V8 Engine",
  "components": [{ "id": "piston-head", "name": "Piston Head", "status": "optimal", "type": "MECHANICAL" }]
}
```

**Rate limit**: 20/hour per IP.

**Response** (200)
```json
{ "issues": [{ "componentId": "piston-head", "issue": "...", "recommendation": "...", "severity": "medium" }] }
```

---

## POST /api/chat

Technical chat with FRIDAY about the active system.

**Request**
```json
{
  "message": "What material is the crankshaft?",
  "history": [{ "role": "user", "content": "..." }, { "role": "model", "content": "..." }],
  "systemContext": "System: V8 Engine ..."
}
```

**Rate limit**: 100/hour per IP.

**Response** (200) — `{ "text": "..." }`

---

## POST /api/live-token

Mint an ephemeral Gemini Live API token (10 min TTL).

**Request**: none.

**Rate limit**: 20/day per IP.

**Response** (200)
```json
{ "token": "...", "expiresAt": 1745953850000, "fallback": false }
```

The client then opens a WebSocket directly to `generativelanguage.googleapis.com` using this token.

---

## POST /api/systems/save

Persist a generated system and get a shareable hash.

**Request**
```json
{
  "systemName": "V8 Engine",
  "description": "...",
  "data": { "components": [...] }
}
```

**Response** (201)
```json
{ "id": "uuid", "shareHash": "a1b2c3d4e5f6", "createdAt": "..." }
```

---

## GET /api/systems/load?hash=...

Fetch a shared system. Cached 1h at the edge.

**Response** (200) — full `SystemAnalysis`.

---

## GET /api/systems/list

List the 20 most recently saved public systems.

**Response** (200) — `{ "systems": [{ "id", "system_name", "share_hash", "created_at" }] }`

---

## GET /api/health

Uptime + model version probe.

**Response** (200)
```json
{
  "status": "ok",
  "version": "1.0.0",
  "timestamp": "...",
  "models": { "reasoning": "gemini-3.1-pro-preview", "fast": "gemini-3.1-flash", "live": "gemini-live-2.5-flash-native-audio" }
}
```
