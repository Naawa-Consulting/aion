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

- Upload `.csv` or `.xlsx` files on `/upload`.
- Backend stores datasets as Parquet under `data/datasets/<uuid>.parquet` and metadata in SQLite (`backend/data/app.db`).
- Preview shows first 20 rows. Columns can be renamed and saved.

### Module 2

- Create derived variables via `/transform` using operations: lag, decay (recursive y_i = x_i + alpha·y_{i-1}), log, add/sub/mul/div.
- Variables are persisted as new columns in the dataset Parquet and tracked in the DB.
- Create Groups and Subgroups, assign variables to subgroups for later analysis.

### Module 3

- Correlations: `GET /models/correlations?dataset_id=...&y=...` (numeric columns only).
- Create OLS models: `POST /models` with `dataset_id`, `name`, `y_var`, `x_vars`.
- Metrics stored: R², Adjusted R², VIF, Durbin–Watson, MAE, RMSE, MAPE.
- Mark Hero: `POST /models/{id}/hero`. UI at `/modeling` supports selection and comparison.

### Module 4

- Summary contributions: `GET /analysis/{model_id}/summary` returns coefficient × mean per variable, with group/subgroup rollups. Excel download: `GET /analysis/{model_id}/export/summary.xlsx`.
- Stacked contributions over time: `GET /analysis/{model_id}/stacked?time_col=...&freq=day|week|month&by=group|subgroup`. Excel download: `GET /analysis/{model_id}/export/stacked.xlsx`.
- Frontend `/analysis` shows summary and a stacked bar chart with downloads.

### Module 5

- Simulation endpoint: `POST /predict/{model_id}/simulate` with `{ adjustments: [{ variable, multiplier }] }` returns predicted totals, variable contributions, and group rollups.
- Scenario persistence: `POST /predict/{model_id}/scenarios` (max 3 per model) saves adjustments; `GET /predict/{model_id}/scenarios` lists saved scenarios; `DELETE /predict/{model_id}/scenarios/{scenario_id}` removes one.
- Scenario stacked breakdown: `GET /predict/{model_id}/scenarios/{scenario_id}/stacked?time_col=...&freq=...&by=group|subgroup`.
- Frontend `/predict` provides the builder, preview, saved scenarios, and time breakdown controls.

## Deployment

- Frontend: Deploy `frontend/` to Vercel. Set `NEXT_PUBLIC_API_URL` to your backend URL.
- Backend: Deploy FastAPI to a platform (Railway/Render/Fly). Use Postgres in production and S3-compatible storage for data if needed.

## UI Enhancements

- Sticky header with active route highlighting and subtle shrink-on-scroll.

## Next Steps

- Harden validations (e.g., scenario editing, limits, better error states)
- Add PNG exports for charts if needed
