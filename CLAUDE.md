# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Documentation system (read this first)

This repo uses 4 base docs to keep continuity across sessions. At the start of every session,
read:

- `README.md` (root) — project description and current status.
- `INDEX.md` — folder/key-file map (not an exhaustive file-by-file listing).
- `BITACORA.md` — decisions/pending-items log. Read the full "Pendientes abiertos" section, plus
  at least the last 10 dated entries under "Historial" (most recent first) — go further back
  only if you need more historical context.
- `CLAUDE.md` (this file) — architecture (below) + these operating rules.

`docs/README.md` is a fifth, module-scoped doc: the technical API/contract spec (endpoints,
request/response shapes) per module. Read it before making backend API changes.

`README.md`, `INDEX.md`, and `BITACORA.md` are written in Spanish, matching how this project is
run day-to-day; `CLAUDE.md` and `docs/README.md` stay in English as technical references.

### Update rules — do this proactively, without being asked

- **`BITACORA.md`** — add an entry when something worth remembering happens: a decision, a
  completed task/feature, a new pending item, a file generated or restructured. Skip it for pure
  Q&A or exploration that changed nothing. New entries go at the top of "Historial". When an item
  gets done, remove/check it off in "Pendientes abiertos".
- **`README.md`** — update "Estado actual" when a module's status changes (e.g. pending →
  functional, or a major capability ships).
- **`INDEX.md`** — update when files/folders are added, removed, or repurposed in a way that
  changes the map.
- **`CLAUDE.md`** — update when architecture, conventions, or these operating rules change.

## What this is

Aion is a marketing-mix-modeling (MMM) analytics app: upload a dataset, transform/categorize
variables, fit regression models, analyze contribution/attribution, and build scenario-based
forecasts. It's a monorepo with a Next.js frontend and a FastAPI backend, organized as five
sequential "modules" that form a pipeline:

1. **Datasets** (`/datasets`) — upload, versioning, sampling, time-column config
2. **Transform** (`/transform`) — variable categorization (Group/Subgroup) and derived variables
3. **Modeling** (`/modeling`) — OLS regression models, hero/challenger comparison
4. **Analysis** (`/analysis`) — contribution/attribution breakdowns over time
5. **Predict** (`/predict`) — scenario planning and forecasting

Each module builds on state produced by the previous one (dataset → variables → model → analysis →
scenario), so when working on one module, check `docs/README.md` for the exact request/response
shapes the adjacent modules depend on.

`docs/README.md` is the living spec — it documents every endpoint added per module. Read it before
making API changes, and update it when you add or change an endpoint/contract (this is the
pattern the project already follows in git history). The backlog of open work items lives in
`BITACORA.md` under "Pendientes abiertos", not here.

## Commands

### Backend (FastAPI)
```powershell
python -m venv .venv; . .venv/Scripts/Activate.ps1   # first time
pip install -r backend/requirements.txt
cd backend; alembic upgrade head                     # apply schema migrations
uvicorn app.main:app --reload --port 8000 --app-dir backend
```
Needs `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_JWT_SECRET` set (see
`backend/.env.example`) — without them, auth and dataset storage calls fail at request time
(import still works). No test suite or linter is configured for the backend currently.

### Frontend (Next.js 14, App Router)
```bash
cd frontend
npm install
npm run dev     # http://localhost:3000
npm run lint    # next lint
npm run build
```
Requires `frontend/.env.local` (see `frontend/.env.example`): `NEXT_PUBLIC_API_URL`,
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`. `next.config.mjs` currently has
`typescript.ignoreBuildErrors: true` as a stopgap (see `BITACORA.md` — pre-existing type errors,
unrelated to auth, surfaced the first time `next build` ever ran in this repo). No test suite is
configured for the frontend currently.

## Architecture

### Multi-tenancy (read this before touching any endpoint or page)

Every domain table has a `company_id`; a `Membership` row (`user_id`, `company_id`, `role`) is
the source of truth for who can see/touch what. Roles: `modelador` (full read/write),
`visualizador` (read-only), `admin_compania` (read/write + manages that company's members).
`platform_admin` is a separate capability (email allowlist, `AION_PLATFORM_ADMIN_EMAILS`) that
can only create new companies — it does **not** grant visibility into any company's data.

- **Backend**: every request carries `Authorization: Bearer <supabase_jwt>` +
  `X-Company-Id: <uuid>`. `auth.py::_decode_token` branches on the JWT's own `alg` header: `HS256`
  uses the legacy shared `SUPABASE_JWT_SECRET`, anything else (this project uses `ES256`) is
  verified against the project's public signing key fetched from
  `{SUPABASE_URL}/auth/v1/.well-known/jwks.json` (cached, keyed by `kid`) — **don't assume a
  Supabase project uses the legacy HS256 secret**, newer projects default to asymmetric signing
  keys and the HS256-only path fails silently with a 401. `get_current_membership` (or
  `require_write_access`) resolves the decoded token + `X-Company-Id` into a `CurrentMembership`,
  injected via `Depends()` in every endpoint. Any lookup by an
  externally-supplied id (`dataset_id`, `model_id`, `scenario_id`, `group_id`, ...) must go
  through `tenancy.py::get_scoped(session, Model, id, membership.company_id)` — it 404s (not
  403) if the row belongs to another company. List queries add
  `.where(X.company_id == membership.company_id)`. This is enforced in the application layer,
  not via Postgres RLS — the backend connects with a service credential, not a per-user Supabase
  client, so RLS isn't the primary defense here (see BITACORA for why this was chosen).
- **Frontend**: `lib/store.ts` holds `activeCompanyId` (the company selected in the header's
  `CompanySwitcher`); `lib/api.ts::apiFetch` attaches both headers automatically. Switching
  company clears `datasetId`/`modelId` in the store — never reference those ids across a company
  switch. `hooks/useCanEdit.ts` gates write buttons in the UI, but that's UX only — the backend
  independently rejects writes from `visualizador`.

### Backend (`backend/app/`)

- `main.py` — creates the FastAPI app, mounts one router per module under a matching prefix
  (`/datasets`, `/variables`, `/groups`, `/models`, `/analysis`, `/predict`) plus `/admin` and
  `/me`, CORS restricted to `AION_ALLOWED_ORIGINS`.
- `config.py` — `Settings` (Postgres URL, Supabase project settings, storage bucket, platform
  admin allowlist, CORS origins), all via env vars.
- `db.py` — SQLAlchemy engine only (Postgres via `AION_DATABASE_URL`, SQLite fallback for local
  dev). No migration logic lives here anymore.
- `alembic/` — schema migrations. This is the **only** migration mechanism — if you add/change a
  column, generate a new revision (`alembic revision --autogenerate -m "..."`) rather than
  hand-editing the DB. Migrations run before the process starts (see `Dockerfile`), never from an
  app startup hook (avoids race conditions across multiple instances).
- `auth.py` / `tenancy.py` — see "Multi-tenancy" above.
- `models.py` — all SQLModel table definitions in one file (`Company`, `Membership`, `Dataset`,
  `Variable`, `Group`, `Subgroup`, `VariableHistory`, `Model`, `ModelMetrics`, `Scenario`).
  `Group`/`Subgroup` are a per-company shared catalog (not per-dataset) — deliberately, to
  preserve reuse across a company's datasets/models.
- `schemas.py` — all Pydantic request/response models in one file, imported by the routers.
- `routers/` — one file per module (`datasets.py`, `variables.py`, `groups.py`, `models.py`,
  `analysis.py`, `predict.py`) plus `admin.py` (company/membership management) and `me.py`
  (`/me/memberships`); the module routers are large (400–900 lines) and contain most business
  logic inline rather than a separate service layer, except for `analysis.py`/`predict.py` which
  lean on `services/analysis.py`. `predict.py` imports `_fit_from_model`/`_group_maps` directly
  from `analysis.py` — both now take a `company_id` argument, pass it through.
- `services/analysis.py` — shared contribution-calculation logic and an in-process, TTL-based
  (`CACHE_TTL_SECONDS`) cache for expensive per-model/per-dataset computations, keyed by frozen
  dataclasses (`ContributionCacheKey`, `AnalysisCacheKey`) — not `company_id`-keyed (the ids
  inside the key are already unguessable UUIDs validated before reaching the cache). Call
  `invalidate_cache_for_dataset` / `invalidate_cache_for_model` whenever a dataset or model is
  mutated so stale results aren't served. Known limitation: this cache is per-process, so it
  won't be coherent across multiple Render instances/workers — accepted for now (perf-only, not
  a security concern).
- `utils/datasets.py` — `load_dataset_frame(ds)` is the single path for reading a dataset: it
  pulls bytes from Supabase Storage via `utils/storage.py`, applies `sample_size` and
  time-column parsing (`_apply_time_settings`) consistently. Almost every analytics endpoint
  should read data through this helper rather than calling storage directly.
- `utils/storage.py` — `get_storage()` returns a `SupabaseStorage` client (`read_bytes`,
  `write_bytes`, `delete`, `move`, `stat`), implemented via raw `httpx` calls to the Storage REST
  API (no SDK). Object keys are `{company_id}/{dataset_id}/v{n}.parquet` — `Dataset.storage_key`
  holds the current one.

### Frontend (`frontend/src/`)

- `app/(app)/` — route group holding the 5 product modules (`datasets/`, `transform/`,
  `modeling/`, `analysis/`, `predict/`) plus its own `layout.tsx` (mounts `Header` +
  `AuthBootstrap`). The parens don't affect URLs. `app/login/`, `app/auth/callback/`,
  `app/reset-password/` live outside this group so they don't inherit product nav. Each page is
  still a single large client-side component (`page.tsx`, several hundred lines) owning its own
  state/UI — there's still no shared data-fetching/query layer beyond the transport client below.
- `middleware.ts` (repo root, not under `src/`) — redirects to `/login` when there's no Supabase
  session; uses `supabase.auth.getUser()` (revalidates server-side), not `getSession()`.
- `lib/supabase/{client,server,middleware}.ts` — Supabase Auth clients for browser / server
  components / middleware respectively (`@supabase/ssr` pattern).
- `lib/api.ts` — `apiFetch<T>(path, options)` is the **only** way pages should call the backend:
  it attaches `Authorization`/`X-Company-Id` automatically and throws `ApiError` (with `.status`/
  `.detail`) on non-2xx responses instead of returning a `.ok`-checkable response. Supports
  `responseType: 'blob'` for the `.xlsx` export endpoints. `getAuthHeaders()` is exported
  separately for the one raw `XMLHttpRequest` upload (progress-tracked file upload in
  `datasets/page.tsx`) that can't go through `fetch`.
- `lib/store.ts` — Zustand store: cross-page selection (`datasetId`, `modelId`) plus session
  state (`userId`, `userEmail`, `memberships`, `activeCompanyId` — persisted to localStorage).
  `setActiveCompanyId` clears `datasetId`/`modelId` as a side effect — don't bypass it.
- `hooks/useCanEdit.ts` — `useCanEdit()`/`useActiveRole()` read the active membership's role from
  the store; use to `disabled`-gate (not hide) write buttons. Always paired with backend
  enforcement, never a substitute for it.
- `components/company-switcher.tsx`, `components/user-menu.tsx` — header controls, built on
  `components/ui/dropdown.tsx` (new minimal primitive, no positioning engine).
- `components/ui/` — shared low-level primitives (button, card, badge, modal, input, filter-bar,
  progress, dropdown). Prefer reusing these over introducing new one-off UI primitives.
- `components/modeling/`, `components/predict/` — module-specific components, notably the
  scenario grid/spreadsheet editors used by Predict.
- Styling is Tailwind (`tailwind.config.ts`) with a shared design-token approach (Inter font,
  spacing scale) per `docs/README.md`; toasts use `sonner`; charts use `recharts`.
- `frontend/react-data-grid.d.ts` — local type shim; both `react-data-grid` and
  `@glideapps/glide-data-grid` are present in `package.json` (used by the two different
  scenario-grid implementations under `components/predict/`) — check which one a given page
  actually renders before assuming the other applies.

### Cross-cutting conventions

- Dataset reads almost always need to go through `load_dataset_frame` (sample size + time
  parsing + Supabase Storage), not a direct storage/filesystem call.
- Any endpoint that changes a dataset's data or a model's fit must invalidate the relevant
  analysis cache entries (see `services/analysis.py`).
- Any new backend endpoint touching a domain table needs the `company_id` scoping pattern (see
  "Multi-tenancy" above) — this is easy to forget on a new endpoint and is a real security bug if
  missed, not just a style nit.
- Any new frontend backend-call needs to go through `apiFetch` (`lib/api.ts`), never a raw
  `fetch` to `${API_URL}` — otherwise it silently ships without auth headers.
- When adding/changing a backend endpoint or its request/response shape, update `docs/README.md`
  under the corresponding "Module N" section — it's treated as the contract reference between
  frontend and backend in this project.
