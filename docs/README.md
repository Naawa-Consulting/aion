# Aion Monorepo

This repository contains a modular analytics application with a Next.js frontend and a FastAPI backend.

## Structure

- `frontend/` — Next.js 14 App Router UI
- `backend/` — FastAPI app with SQLite (local) and Parquet data storage
- `data/` — Local dataset storage (Parquet). Ignored by git.
- `modules/` — Placeholders for domain modules (transform/modeling/etc.)

## Local Development

### Backend

1. Create and activate a virtual environment
   - PowerShell: `python -m venv .venv; . .venv/Scripts/Activate.ps1`
2. Install dependencies
   - `pip install -r backend/requirements.txt`
3. Run the server
   - `uvicorn app.main:app --reload --port 8000 --app-dir backend`
4. Environment
   - Copy `backend/.env.example` to `backend/.env` (optional)
   - `AION_DATA_ROOT` defaults to `../data` from backend; adjust as needed.

### Frontend

1. Install dependencies
   - `cd frontend`
   - `npm install` (or `pnpm install`)
2. Set environment
   - Create `frontend/.env.local` with `NEXT_PUBLIC_API_URL=http://localhost:8000`
3. Run the dev server
   - `npm run dev` (visits http://localhost:3000)
4. Charts
   - Ensure `recharts` is installed: `npm install recharts`

### Module 1

- UI: `/datasets` replaces the legacy upload screen. Drag-and-drop zone, dataset list with stats, schema preview, rename/delete actions, dependency warning modal, sticky toasts.
- Upload endpoint `POST /datasets/upload?force=false` computes file checksum and blocks silent duplicates (409 response with `dataset_id` so the UI can re-use or force upload).
- Metadata now includes `display_name`, `file_name`, `checksum`, `created_at`, `last_used_at`, and dependency counts (variables/models/scenarios).
- Rename endpoint: `PATCH /datasets/{id}/rename` updates the display label without touching the underlying file.
- Delete endpoint: `DELETE /datasets/{id}?cascade=true|false` removes dataset + dependents (variables, models, scenarios) when `cascade=true`. If dependencies exist and `cascade=false`, the API returns a 400 with counts so the UI can warn the user.
- Preview endpoint updates `last_used_at` for "recent" order and continues to serve first 20 rows with dtype chips.

### Module 2

- UI: `/transform` provides a variable browser with search/filter, drag & drop categorization into Groups/Subgroups, derived badges, sparkline previews, undo (Ctrl+Z), and history modals per variable.
- Backend:
  - `GET /variables?dataset_id=...&search=&dtype=&derived=` supports filtering.
  - `POST /variables/transform` returns `{ variable, preview[] }` for preview sparklines; history saved per variable.
  - `PATCH /variables/{id}/categorization` sets group/subgroup (subgroup optional, validates parent group).
  - `GET /variables/{id}/history` lists transformation audit trail.
  - `POST /variables/{id}/undo` removes the derived column (with dependency guard).
  - Variables now store `group_id`, `subgroup_id`, and history is persisted via `variable_history`.
- Group assignment compatibility route `/groups/assign` now updates the variable record directly.

### Module 3

- Correlations: `GET /models/correlations?dataset_id=...&y=...` (numeric columns only).
- Create models: `POST /models` with `dataset_id`, `name`, `y_var`, `x_vars`.
- Update/re-fit: `PATCH /models/{id}` to rename and/or change predictors (re-computes metrics).
- Delete: `DELETE /models/{id}` removes metrics and dependent scenarios.
- Roles: `POST /models/{id}/role` with `hero|challenger1|challenger2|none` (enforces 1 Hero + 2 Challengers max). Legacy `/hero` endpoint still works.
- Summary: `GET /models/{id}/summary` ⇒ intercept + coefficients with β, std err, t, p, VIF.
- Predictions: `GET /models/{id}/predictions?granularity=auto|weekly|monthly[&time_col=col]` ⇒ `{index, y_true, y_pred, residuals}` (when not auto, requires a datetime column).
- Metrics stored: R², Adjusted R², VIF, Durbin–Watson, MAE, RMSE, MAPE (exposed via `ModelOut.metrics`).
- Frontend `/modeling` now offers correlation bars with search, creation/edit form, model table with hero/challenger controls, comparison dashboard, hero coefficient table, and actual-vs-model chart with residual toggle.

### Module 4

- Summary contributions: `GET /analysis/{model_id}/summary?include_intercept=bool&as_percent=bool` returns coefficient × mean per variable (Baseline included as a first-class group/subgroup). Download: `GET /analysis/{model_id}/export/summary.xlsx`.
- Stacked contributions: `GET /analysis/{model_id}/stacked?time_col=...&freq=day|week|month&by=group|subgroup&include_intercept=bool&as_percent=bool`. Excel download: `GET /analysis/{model_id}/export/stacked.xlsx`.
- Frontend `/analysis` now offers dashboard cards (total, baseline, top groups), value/% toggles, stacked area chart, and download buttons with icons.

### Module 5

- Simulation endpoint: `POST /predict/{model_id}/simulate` with `{ adjustments: [{ variable, multiplier }] }` returns predicted totals, variable contributions, and group rollups.
- Scenario persistence: `POST /predict/{model_id}/scenarios` (max 3 per model) saves adjustments; `GET /predict/{model_id}/scenarios` lists saved scenarios; `DELETE /predict/{model_id}/scenarios/{scenario_id}` removes one.
- Scenario stacked breakdown: `GET /predict/{model_id}/scenarios/{scenario_id}/stacked?time_col=...&freq=...&by=group|subgroup`.
- Frontend `/predict` provides the builder, preview, saved scenarios, and time breakdown controls.

## Deployment

- Frontend: Deploy `frontend/` to Vercel. Set `NEXT_PUBLIC_API_URL` to your backend URL.
- Backend: Deploy FastAPI to a platform (Railway/Render/Fly). Use Postgres in production and S3-compatible storage for data if needed.

## UI Enhancements

- Sticky header with scroll shrink, route highlighting, and a theme toggle (light/dark).
- Shared design tokens (Inter font, spacing scale, cards, badges, toasts via `sonner`).

## Next Steps

- Harden validations (e.g., scenario editing, limits, better error states)
- Add PNG exports for charts if needed
