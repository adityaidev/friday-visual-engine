# Contributing to FRIDAY

Thanks for your interest! This doc captures how we work.

## Dev setup

```bash
git clone https://github.com/<you>/friday-visual-engine.git
cd friday-visual-engine
nvm use             # picks Node 22 from .nvmrc
npm install
cp .env.example .env.local   # fill in keys
npm run dev
```

## Branch / commit conventions

- Branch: `feat/short-description`, `fix/short-description`, `docs/short-description`.
- Commit: [Conventional Commits](https://www.conventionalcommits.org/) - `feat:`, `fix:`, `docs:`, `refactor:`, `perf:`, `test:`, `chore:`.
- One logical change per PR.

## Pre-commit checklist

```bash
npm run typecheck   # must pass
npm run lint        # warnings ok, errors not
npm test            # all green
npm run build       # must succeed
```

## Adding a new Edge Function

1. Create `api/<name>.ts` with `export const config = { runtime: 'edge' }`.
2. Import from `./_shared/*` for CORS, rate limiting, validation.
3. Add JSDoc above the handler.
4. Document request/response in `docs/API.md`.
5. Add a test covering the happy path.

## Adding a new React component

1. Place in `components/Interface/` or `components/Simulation/`.
2. Export as a named arrow-function React FC with typed props.
3. Include ARIA attributes on any interactive element.
4. Respect `prefers-reduced-motion` for animation.
5. Wrap mutation of imperative handles in `useEffect` / `useImperativeHandle`.

## Working with Gemini

- Never log full API responses to server logs (prompt content may be sensitive).
- Always use `responseSchema` for structured output.
- Always validate server-side before returning to client.
- Do not weaken the refusal contract in `api/_shared/gemini.ts`.

## Supabase migrations

```bash
supabase migration new <description>
# Edit generated SQL in supabase/migrations/
supabase db push   # applies to linked project
```

## Code style

- Prettier + ESLint are authoritative.
- Prefer `const` → `let` → `var` (never `var`).
- No `any` without a `// TODO: tighten` comment.
- No commented-out code; delete it.
- Functions over classes unless React/stateful patterns demand otherwise.

## Security-first

- Never commit `.env.local`, keys, or any secret.
- API keys go in Vercel env vars, client gets them via the `/api` proxy.
- Validate all user input at the API boundary.
- Hash IPs before storing.
