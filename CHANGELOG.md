# Changelog

All notable changes to FRIDAY will be documented here. Format based on [Keep a Changelog](https://keepachangelog.com/).

## [1.0.0] — 2026-04-12

### Added
- **Server-side Gemini proxy** — all Gemini API calls now route through Vercel Edge Functions (`/api/analyze`, `/api/diagnostics`, `/api/chat`, `/api/live-token`). API key is never shipped to the browser.
- **Ephemeral token flow** for Gemini Live audio — client gets short-lived tokens from the server before opening the WebSocket.
- **Supabase integration** — persistent system storage with share links (`/?s=<hash>`), Postgres-backed rate limiter, and row-level security.
- **Per-IP rate limiting** — 10 analyze / 20 diagnostic / 100 chat / 20 live-token per hour (or day) with exponential backoff and circuit-breaker behavior.
- **AudioWorklet-based mic pipeline** — proper 16 kHz downsampling in a dedicated audio thread, Int16 clamping, no more `ScriptProcessorNode`.
- **Keyboard shortcuts** — `G`/`I`/`L` tab switching, `S` deep scan, `E` explode toggle, `R` regenerate, `Esc` cancel.
- **Accessibility pass** — ARIA labels, roles, focus-visible rings, `prefers-reduced-motion`, skip-link, screen-reader status regions.
- **ErrorBoundary** wrapping Scene3D / HUD / HandControls, with user-facing recovery.
- **Toast system** for async feedback.
- **Share / Regenerate / Cancel** actions on the HUD.
- **PWA manifest**, favicon, Open Graph tags, sitemap, `robots.txt`, `<noscript>` fallback.
- **Strict TypeScript**, ESLint, Prettier, EditorConfig, GitHub Actions CI.
- **Vitest** with tests covering PCM encoding, API schema normalization, and service layer.
- **Full docs**: README, ARCHITECTURE, DEPLOYMENT, API, CONTRIBUTING, SECURITY.

### Changed
- **Migrated Gemini models**: `gemini-3-pro-preview` → `gemini-3.1-pro-preview`; `gemini-2.5-flash-native-audio-preview-09-2025` → `gemini-live-2.5-flash-native-audio`.
- **System prompt** rewritten to remove IP-violation phrasing and add explicit refusal contract for prompt injection.
- **3D rendering**: ACES Filmic tone mapping, adaptive DPR, quality-tier downgrade on low FPS, `PerformanceMonitor`, lazy-loaded MediaPipe, Three.js resource disposal.
- **Message timestamps** switched from `Date` to `number` for serialization safety.

### Fixed
- Int16 PCM overflow at full-scale samples.
- Sample-rate mismatch between mic input and Gemini Live expectation.
- Geometry + material leaks in `Scene3D`.
- `nodeRefs` retention across system swaps.
- `substr` (deprecated) → `substring` + `crypto.randomUUID()`.
- Image upload MIME type now inferred from the data URL, not hardcoded to JPEG.
- Missing `index.css` 404.

### Security
- API key removed from client bundle (was previously injected via `vite.config.ts` define).
- Supabase RLS enabled on all tables; rate-limit table locked to `service_role` via RPC.
- Permissions-Policy + X-Frame-Options + X-Content-Type-Options headers on all responses.
