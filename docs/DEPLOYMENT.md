# FRIDAY - Deployment Guide

## TL;DR for future deploys

```bash
git push origin main   # Vercel auto-deploys on push
```

## Initial setup (one-time)

### 1. Prerequisites

- Node ≥ 22
- Gemini API key - https://aistudio.google.com/apikey
- Vercel account - `vercel login`
- Supabase account - `supabase login`
- GitHub CLI - `gh auth login`

### 2. Clone & install

```bash
git clone https://github.com/<you>/friday-visual-engine.git
cd friday-visual-engine
npm install
```

### 3. Supabase

```bash
# Create a new project via CLI or dashboard
supabase projects create friday-visual-engine \
  --org-id <YOUR_ORG> \
  --db-password <STRONG_PASSWORD> \
  --region <nearest_region>

# Link and apply migrations
supabase link --project-ref <PROJECT_REF>
supabase db push

# Grab the keys
supabase projects api-keys --project-ref <PROJECT_REF>
```

### 4. Environment variables

```bash
cp .env.example .env.local
# Fill in:
#   GEMINI_API_KEY              (server-only)
#   SUPABASE_URL                (server)
#   SUPABASE_SERVICE_ROLE_KEY   (server)
#   VITE_SUPABASE_URL           (client)
#   VITE_SUPABASE_ANON_KEY      (client)
```

### 5. Vercel

```bash
vercel link --project friday-visual-engine

# Add env vars (do this for each: production, preview, development)
vercel env add GEMINI_API_KEY production
vercel env add SUPABASE_URL production
vercel env add SUPABASE_SERVICE_ROLE_KEY production
vercel env add VITE_SUPABASE_URL production
vercel env add VITE_SUPABASE_ANON_KEY production

# Deploy
vercel --prod
```

### 6. Verify

```bash
# API key should NOT be in the bundle:
curl https://your-app.vercel.app/assets/*.js | grep -i "AIza"   # must return nothing

# Health check:
curl https://your-app.vercel.app/api/health

# Rate limit + analyze smoke test:
curl -X POST https://your-app.vercel.app/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"query":"a simple bolt","tier":"flash"}'
```

## Environment matrix

| Variable | Server | Client | Purpose |
|---|:---:|:---:|---|
| `GEMINI_API_KEY` | ✅ | ❌ | Gemini REST + Live |
| `SUPABASE_URL` | ✅ | ❌ | Server DB URL |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | ❌ | Bypasses RLS for save/rate-limit |
| `VITE_SUPABASE_URL` | ❌ | ✅ | Browser → Supabase |
| `VITE_SUPABASE_ANON_KEY` | ❌ | ✅ | Safe; RLS-protected |
| `VITE_API_BASE` | ❌ | ✅ | Override for local dev |
| `ALLOWED_ORIGINS` | ✅ | ❌ | CORS allowlist (comma-sep) |
| `IP_HASH_SALT` | ✅ | ❌ | Rate-limit IP hashing |

## Rollback

Vercel retains every deployment. To roll back:

```bash
vercel ls friday-visual-engine
vercel promote <deployment-url>
```

## Monitoring

- Vercel Analytics dashboard (built-in)
- Supabase → Reports → API (query volumes + latency)
- Gemini usage at https://aistudio.google.com/billing

## Cost ceiling

- Vercel Free: 100 GB bandwidth / 1M edge invocations
- Supabase Free: 500 MB DB / 50K monthly active users
- Gemini: pay-as-you-go; set billing alerts

One typical Pro generation = ~$0.05–$0.10. Budget: ~$5 per 100 generations.

## Deprecation playbook

When a Gemini model is deprecated:

1. Update `api/_shared/gemini.ts` → `MODELS`.
2. Push to main.
3. Vercel redeploys.
4. Old model IDs become unreachable; no DB migration required.
