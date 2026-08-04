# Aion — Especificación técnica por módulo

> Descripción general del proyecto, estado actual y setup de desarrollo: ver `README.md` en la
> raíz. Historial de decisiones y pendientes: ver `BITACORA.md`.

Este documento es la referencia de contratos (endpoints, request/response) entre frontend y
backend, por módulo. Actualízalo cuando agregues o cambies un endpoint.

## Module 1

- UI: `/datasets` replaces the legacy upload screen. Drag-and-drop zone, dataset list with stats, schema preview, rename/delete actions, dependency warning modal, sticky toasts.
- Upload endpoint `POST /datasets/upload?force=false` computes file checksum and blocks silent duplicates (409 response with `dataset_id` so the UI can re-use or force upload).
- Metadata now includes `display_name`, `file_name`, `checksum`, `created_at`, `last_used_at`, and dependency counts (variables/models/scenarios).
- Rename endpoint: `PATCH /datasets/{id}/rename` updates the display label without touching the underlying file.
- Delete endpoint: `DELETE /datasets/{id}?cascade=true|false` removes dataset + dependents (variables, models, scenarios) when `cascade=true`. If dependencies exist and `cascade=false`, the API returns a 400 with counts so the UI can warn the user.
- Preview endpoint updates `last_used_at` for "recent" order and continues to serve first 20 rows with dtype chips.
- Working sample selector: dataset detail now exposes a “Working Sample Size” control (All rows vs. Custom). Selection calls `PATCH /datasets/{id}/sample_size` (with `{ sample_size: null|number }`), persists on the dataset, and every downstream module (Transform/Modeling/Analysis/Predict) automatically restricts computations to the first `sample_size` rows. Responses now include `sample_size` and `total_rows` so the UI can display “Currently using X of Y rows” and show a confirmation/loading overlay before applying the change.
- Time variable selector: choose a temporal column inside the dataset detail card. `GET /datasets/{id}/time_candidates` suggests columns; `PATCH /datasets/{id}/time_variable` saves `{ column, coerce, time_format, timezone }` (or clears when `column=null`). All analytics endpoints now load data via the helper that enforces sample size + datetime parsing, so temporal features (lag/decay, stacked charts, scenario horizons) stay consistent.
- Replace dataset file: new “Update File” action opens a modal that uploads a CSV/XLSX via `POST /datasets/{id}/update` (strict vs. force schema modes). Each replacement writes `/data/{dataset_id}/v{n}.parquet`, bumps the dataset’s `version`, and archives the previous file so `GET /datasets/{id}/versions` can list history. Schema differences return 400 with added/removed columns, and a success toast announces the new version.

## Module 2

- UI: `/transform` provides a variable browser with search/filter, drag & drop categorization into Groups/Subgroups, derived badges, sparkline previews, undo (Ctrl+Z), and history modals per variable.
- Backend:
  - `GET /variables?dataset_id=...&search=&dtype=&derived=` supports filtering.
  - `POST /variables/transform` returns `{ variable, preview[] }` for preview sparklines; history saved per variable.
  - `PATCH /variables/{id}/categorization` sets group/subgroup (subgroup optional, validates parent group).
  - `GET /variables/{id}/history` lists transformation audit trail.
  - `POST /variables/{id}/undo` removes the derived column (with dependency guard).
  - Variables now store `group_id`, `subgroup_id`, and history is persisted via `variable_history`.
- Group assignment compatibility route `/groups/assign` now updates the variable record directly.
- **Media flag**: `Group`/`Subgroup` now carry `apply_media_transform: bool` (default `false`).
  `GET /groups` returns it on every group/subgroup; `POST /groups`, `POST /groups/subgroups` accept
  it on creation; `PATCH /groups/{id}` and `PATCH /groups/subgroups/{id}` accept a body with `name`
  and/or `apply_media_transform`, both now optional (either can be omitted to update just the
  other). A variable's "is this a media variable" status (adstock+Hill applies when it's used as a
  model predictor — see Module 3) is resolved from its Subgroup's flag, falling back to its Group's
  flag, defaulting to `false` (control variable) if neither is set. UI: a checkbox per group/subgroup
  in the `/transform` "Groups & Subgroups" card.

## Module 3

- Correlations: `GET /models/correlations?dataset_id=...&y=...` (numeric columns only). Always
  computed on raw values — the adstock/Hill grid search (below) only runs when a model is actually
  fit, not while browsing candidate predictors.
- Create models: `POST /models` with `dataset_id`, `name`, `y_var`, `x_vars`.
- Update/re-fit: `PATCH /models/{id}` to rename and/or change predictors (re-computes metrics).
- Delete: `DELETE /models/{id}` removes metrics, transform params, and dependent scenarios.
- Roles: `POST /models/{id}/role` with `hero|challenger1|challenger2|none` (enforces 1 Hero + 2 Challengers max). Legacy `/hero` endpoint still works.
- Summary: `GET /models/{id}/summary` ⇒ intercept + coefficients with β, std err, t, p, VIF, plus
  (new) `is_media`, `decay`, `half_life`, `hill_k`, `hill_s`, `lag`, `raw_mean` per coefficient when
  that variable is media-flagged (see below); all `null` for control variables.
- Predictions: `GET /models/{id}/predictions?granularity=auto|weekly|monthly[&time_col=col]` ⇒ `{index, y_true, y_pred, residuals}` (when not auto, requires a datetime column).
- Metrics stored: R², Adjusted R², VIF, Durbin–Watson, MAE, RMSE, MAPE (exposed via `ModelOut.metrics`).
- Frontend `/modeling` now offers correlation bars with search, creation/edit form, model table with hero/challenger controls, comparison dashboard, hero coefficient table, and actual-vs-model chart with residual toggle.

### Adstock + Hill media transform

Any `x_var` whose Group or Subgroup has `apply_media_transform=true` (see Module 2) is
automatically transformed — geometric adstock (carryover) followed by Hill saturation
(diminishing returns) — instead of being fed to OLS raw; control variables are unaffected. This
is fully automatic (no manual per-variable configuration): a per-channel grid search (decay ∈
{0,0.2,0.4,0.6,0.8}, Hill S ∈ {1,2,3}, lag ∈ {0..4}, Hill K ∈ quantiles of the channel's own
nonzero values) runs against the target residualized on the model's control variables, and the
winning params are fixed for that model — never re-sampled jointly with the linear coefficients
(see `backend/app/services/model_fit.py` docstring and `BITACORA.md` for why the joint-Bayesian
alternative was rejected). Fitted params are persisted per `(model_id, variable_name)` in the new
`ModelTransform` table; `POST/PATCH /models` (re)runs the search and stores the result,
`POST /models/{id}/best_stepwise` reuses the parent model's already-fit params (fixed before
variable selection, per the reference methodology) rather than re-searching, and
`POST /models/{id}/duplicate` copies them verbatim. A model with **no** `ModelTransform` rows
(including every model created before this feature shipped) behaves exactly as pure OLS always
did — this is the deliberate backward-compatibility story, not an oversight.

Every consumer that re-fits or re-derives a model's coefficients (`models.py` summary/predictions/
correlations-residual, `routers/analysis.py::_fit_from_model`, `routers/predict.py`'s scenario
engine) goes through the single shared `services/model_fit.py::build_design_matrix`, so the same
transform is applied consistently everywhere. Scenario projections in `/predict` additionally
apply adstock/Hill over the **full concatenated history+future series** before slicing out the
projected periods — never on a truncated future-only window — so carryover from real history
correctly bleeds into the first few projected periods instead of starting from a cold (zero)
state.

Frontend: `/modeling`'s Hero coefficient table badges media variables and shows their fitted
decay/half-life/K/S; a "Curvas de saturación" card renders the Hill curve per media variable
client-side from `hill_k`/`hill_s`, with a reference line at the variable's historical mean
(`raw_mean`).

## Module 4

- Summary contributions: `GET /analysis/{model_id}/summary?include_intercept=bool&as_percent=bool` now aggregates each predictor as the sum of `beta_i * X_i,t` over the filtered date range (baseline = intercept × row count), so dashboard cards and the summary table react immediately to the selected period. Download: `GET /analysis/{model_id}/export/summary.xlsx`.
- Stacked contributions: `GET /analysis/{model_id}/stacked?time_col=...&freq=day|week|month&by=group|subgroup&include_intercept=bool&as_percent=bool` uses the same date-filtered sums per period; Excel download: `GET /analysis/{model_id}/export/stacked.xlsx`.
- Frontend `/analysis` now offers dashboard cards (total, baseline, top groups), value/% toggles, stacked area chart, and download buttons with icons.

## Module 5

- Scenario builder is now a time-phased planner: choose horizon, start date, and frequency, then edit a grid of periods × variables (either multipliers or absolute overrides). Saved scenarios (max 3 per model) surface as cards with quick metrics and load/delete actions; comparisons and projected totals update in real time with toasts + micro loading states.
- Preview endpoint: `POST /predict/scenarios/preview` with `{ model_id, horizon, start_date, freq, adjustments }` returns `{ periods, total, average_per_period, groups, subgroups, series }` for instant UI feedback.
- Scenario CRUD: `POST /predict/scenarios` saves a scenario, `GET /predict/scenarios?model_id=...` lists them, `GET /predict/scenarios/{id}` fetches one, `PATCH /predict/scenarios/{id}` renames/updates adjustments, and `DELETE /predict/scenarios/{id}` removes it. All responses carry the summary block described above.
- Time series + exports: `GET /predict/scenarios/{id}/timeseries` provides per-period `{ y_pred, by_group, by_subgroup }`. Import a CSV plan via `POST /predict/scenarios/{id}/import` (columns: period, variable, mode, value) and export CSV/XLSX with `GET /predict/scenarios/{id}/export?format=csv|xlsx`.