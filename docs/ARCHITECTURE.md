# FRIDAY — Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                           BROWSER (SPA)                             │
│                                                                     │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌─────────────────┐   │
│  │ Scene3D  │   │   HUD    │   │  Voice   │   │  HandControls   │   │
│  │  (R3F)   │◀──│ (state)  │──▶│  Module  │   │   (MediaPipe)   │   │
│  └──────────┘   └──────────┘   └──────────┘   └─────────────────┘   │
│       ▲              │              │                │              │
│       │              ▼              ▼                ▼              │
│       │        ┌──────────────────────────────────────────┐         │
│       │        │  services/geminiService  (fetch client)  │         │
│       │        └──────────────────────────────────────────┘         │
│       │                            │                                │
│       │                            ▼                                │
│       │              ┌─────────────────────────┐   AudioWorklet     │
│       │              │  /api/*  (server proxy) │   (PCM encoder)    │
│       │              └─────────────────────────┘                    │
│       │                            │                                │
└───────┼────────────────────────────┼────────────────────────────────┘
        │                            │
        │                            ▼
        │           ┌─────────────────────────────────┐
        │           │       VERCEL EDGE RUNTIME       │
        │           │                                 │
        │           │  analyze ▸ diagnostics ▸ chat   │
        │           │  live-token ▸ systems/*         │
        │           └────┬──────────────────────┬─────┘
        │                │                      │
        │                ▼                      ▼
        │       ┌──────────────┐       ┌───────────────┐
        └──────▶│  Gemini API  │       │   Supabase    │
         WS     │   (REST +    │       │  (Postgres +  │
         direct │    Live)     │       │     RLS)      │
                └──────────────┘       └───────────────┘
```

## Request paths

### 1. Generate a system (text/image)
```
user → HUD.triggerAnalysis
     → services/geminiService.analyzeSystem
     → POST /api/analyze
     → Edge Function checks rate limit (Supabase RPC)
     → Edge Function calls Gemini 3.1 Pro with strict JSON schema
     → normalizeAnalysis() validates + slugs IDs + resolves connections
     → response streams back to Scene3D
```

### 2. Voice session
```
user taps mic
     → services/geminiService.fetchLiveToken
     → POST /api/live-token
     → Edge Function mints ephemeral token (10 min TTL)
     → browser opens WebSocket directly to Google Live endpoint using token
     → AudioWorklet (pcm-processor) downsamples mic to 16 kHz Int16
     → frames posted via WS; responses decoded at 24 kHz for playback
     → tool_call `generate_system` triggers analyze flow via onCommand()
```

### 3. Share a system
```
user clicks Share
     → services/storage.saveSystem → POST /api/systems/save
     → Supabase INSERT into `systems` with random share_hash
     → client copies `https://.../?s=<hash>` to clipboard
     → recipient loads page; App reads ?s= and calls GET /api/systems/load
```

## Folder map

```
├── api/                 Vercel Edge Functions
│   ├── _shared/         Shared helpers (cors, ratelimit, validate, schemas, gemini)
│   ├── systems/         save, load, list
│   ├── analyze.ts       Gemini Pro → SystemAnalysis
│   ├── diagnostics.ts   Gemini Flash → Diagnostic issues
│   ├── chat.ts          Gemini Flash → chat reply
│   ├── live-token.ts    Ephemeral Live API token
│   └── health.ts        /api/health for uptime checks
├── components/
│   ├── Interface/       HUD, VoiceModule, Toast, ErrorBoundary, GlassCard
│   └── Simulation/      Scene3D, HandControls
├── hooks/               useLiveSession, useToast, useKeyboardShortcuts
├── services/            geminiService (fetch client), storage, supabaseClient
├── public/              manifest, favicon, robots, sitemap, worklets/
├── supabase/            config.toml + migrations/
├── tests/               vitest setup + specs
└── docs/                ARCHITECTURE, DEPLOYMENT, API, CONTRIBUTING
```

## Key architectural decisions

1. **Server proxy over direct-from-browser calls.** Prevents API key leakage and gives us a natural rate-limit choke point. Cost: one extra hop (~40ms at the edge).
2. **Ephemeral tokens for Live API.** Avoids proxying WebSocket traffic (harder on serverless), while still never exposing the long-lived Gemini key.
3. **Supabase as the single backend store.** Covers DB (systems), rate-limit state, and future Auth — one vendor instead of Redis + Auth0 + Firestore.
4. **AudioWorklet over ScriptProcessor.** Off-main-thread, predictable timing, no UI jank, future-proof.
5. **Strict JSON schema on Gemini output** with server-side validation (`normalizeAnalysis`) — the WebGL layer can never crash from a missing field.
6. **Adaptive quality tier in R3F.** `PerformanceMonitor` downgrades shadows, environment, and star count on low-FPS devices.
7. **Error boundaries around each major subsystem.** A bad shader crash doesn't take down the HUD; a gesture failure doesn't take down the 3D view.

## Security posture

- `GEMINI_API_KEY` is server-only (Vercel env var, never in the bundle).
- Supabase service role key is server-only; browser uses the anon key protected by RLS.
- All user input is length-capped and control-character-stripped before hitting Gemini.
- Rate limits are per-IP (hashed with salt before storage).
- Permissions-Policy restricts camera/mic to same-origin.
- No inline `eval` / `dangerouslySetInnerHTML`.

## Performance budget

| Metric | Target |
|---|---|
| First Contentful Paint | < 1.5s |
| Largest Contentful Paint | < 2.5s |
| Time to Interactive | < 3.5s |
| Analyze (Gemini Pro) | P50 8s / P99 20s |
| Diagnostics (Gemini Flash) | P50 2s / P99 5s |
| Voice round-trip | P50 700ms / P99 1.5s |
| 3D frame budget @ tier 2 | 16.6 ms (60 FPS) |
| 3D frame budget @ tier 1 | 33.3 ms (30 FPS on low-end) |
