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
- Dependent variable: `Dataset.dependent_variable` (nullable string, a column name) is set via `PATCH /datasets/{id}/dependent_variable` with `{ column: string|null }` (400 if the column doesn't exist) and returned on `DatasetOut`. UI: a "Dependent variable" `Select` on the dataset detail card (right after the Time variable card), auto-saving on change; `POST /variables/transform/preview` (Module 2) reads it to add correlation-vs-dependent to its preview response.
- Hide variable from Datasets: the dataset summary modal's column table ("View details") now fetches `GET /variables?dataset_id=...&include_excluded=true` alongside `GET /datasets/{id}/summary` and joins by column name, adding a "Hide" checkbox column that calls `PATCH /variables/{id}/categorization` with `{ is_excluded }` only (see Module 2 — this is exactly the omit-vs-null-safe shape that lets a page with no group/subgroup context toggle just this one field).

## Module 2

- UI: `/transform` provides a variable browser with search/filter, drag & drop categorization into Groups/Subgroups, derived badges, sparkline previews, undo (Ctrl+Z), and history modals per variable.
- Backend:
  - `GET /variables?dataset_id=...&search=&dtype=&derived=&include_excluded=false` supports filtering; excluded
    variables (see below) are hidden by default, pass `include_excluded=true` to see them.
  - `POST /variables/transform` returns `{ variable, preview[] }` for preview sparklines; history saved per variable.
  - `PATCH /variables/{id}/categorization` sets group/subgroup (subgroup optional, validates parent group) and/or
    `is_excluded` (all fields independently optional — a field is only touched when the request body actually
    includes its key, tracked via Pydantic's `model_fields_set`, not by truthiness; omitting `group_id`/
    `subgroup_id` entirely leaves the existing category untouched, while sending `group_id: null` explicitly
    still clears it — this fixed a real bug found in Fase 3 where a request with only `is_excluded` would have
    silently wiped the variable's group).
  - `PATCH /variables/bulk-categorize` — body `{variable_ids: string[], group_id?, subgroup_id?, is_excluded?}`,
    same independently-optional-field semantics as the single endpoint above but resolves `group`/`subgroup`
    once for the whole batch (not per id); returns `VariableOut[]` in the same order as `variable_ids`. UI:
    `/transform`'s variable list gained a checkbox per row + "select all filtered", with an assign/hide/unhide
    toolbar that appears once ≥1 variable is selected.
  - `GET /variables/{id}/history` lists transformation audit trail.
  - `POST /variables/{id}/undo` removes the derived column (with dependency guard).
  - Variables now store `group_id`, `subgroup_id`, `is_excluded`, and history is persisted via `variable_history`.
- **Hide variable**: `Variable.is_excluded` (bool, default `false`) hides a column from the default variable
  listing (Transform/Modeling selectors) without deleting it — set via `PATCH /variables/{id}/categorization`
  or the bulk endpoint above. Surfaced in both `/transform` (bulk hide/unhide toolbar) and `/datasets` (per-column
  toggle in the summary modal, Module 1).
- **Manual Hill/Adstock transforms**: `TransformOp` (`schemas.py`) gained `hill`/`adstock` alongside the existing
  `lag|decay|log|add|sub|mul|div`. `POST /variables/transform` (`TransformRequest`) accepts `column` + `k`/`s`
  for `hill`, `column` + `decay` for `adstock`; `POST /variables/transform/preview` accepts the same via its
  free-form `params` dict. Both reuse `services/media_transform.py::hill_saturation`/`adstock_geometric` directly
  (not the combined `apply_media_transform` lag+adstock+hill pipeline used for automatic per-model media
  transforms) — these are one-shot manual transforms, saved as a normal derived `Variable` like any other
  Transform op, independent of the per-model automatic transform described below. UI: "Hill (saturation)"/
  "Adstock (carryover)" added to the operation `Select` in `/transform`'s "Create transformation" card, with
  matching K/S or decay inputs.
- `POST /variables/transform/preview` (live preview of a transform before saving it, `{ time, original,
  transformed, stats }`) now also computes `stats.correlation_dependent_before`/`correlation_dependent_after`
  (original/transformed correlated against `Dataset.dependent_variable`, `null` when unset or when the
  transformed column itself is the dependent variable) alongside the existing before/after `stats.correlation`.
- Group assignment compatibility route `/groups/assign` now updates the variable record directly.
- **Media flag**: `Group`/`Subgroup` now carry `apply_media_transform: bool` (default `false`).
  `GET /groups` returns it on every group/subgroup; `POST /groups`, `POST /groups/subgroups` accept
  it on creation; `PATCH /groups/{id}` and `PATCH /groups/subgroups/{id}` accept a body with `name`
  and/or `apply_media_transform`, both now optional (either can be omitted to update just the
  other). A variable's "is this a media variable" status (adstock+Hill applies when it's used as a
  model predictor — see Module 3) is resolved from its Subgroup's flag, falling back to its Group's
  flag, defaulting to `false` (control variable) if neither is set. UI: a checkbox per group/subgroup
  in the `/transform` "Groups & Subgroups" card.
- **Baseline flag**: `Group.is_baseline: bool` (default `false`), at most one `true` per company — enforced at
  the application layer (`routers/groups.py`), not a DB constraint: setting it on one group via `POST /groups`
  or `PATCH /groups/{id}` clears it on any other group in the same company. Any variable assigned (directly, or
  via a Subgroup) to the baseline group has its contribution folded into the model's baseline/intercept line
  instead of reported as its own line item — see Module 4. UI: a "Es el grupo Baseline" checkbox per group in
  `/transform`'s "Groups & Subgroups" card (mirrors the `apply_media_transform` checkbox); checking it clears the
  flag on any other group in local state immediately (not just on the next fetch), matching the backend's
  one-per-company exclusivity.

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
- Significance stars: `formatPValue` (frontend-only) appends `*`/`**`/`***` for p < 0.05/0.01/0.001 next to the
  existing formatted p-value in the Hero coefficient table.
- Hero Model Summary layout: the Hero Model Summary / "Actual vs Model" grid is now an asymmetric
  `grid-cols-[3fr_2fr]` (summary gets more width) with taller scroll/chart areas (480px, up from 360px/288px),
  instead of a rigid 50/50 split.
- **`conversion_rate`/`avg_value` removed from Modeling** (Fase 3): the create/edit model form no longer has
  "Tasa de conversión"/"Valor promedio" inputs — that config now lives in `/transform`'s "Conversion settings"
  card, writing to `ConversionSettings` directly (see Module 4). `CreateModelRequest`/`UpdateModelRequest`/
  `ModelOut` dropped these fields back in Fase 2; this phase just finished removing the now-dead frontend inputs.
- **Saturation curves moved to Analysis** (Fase 3): the "Curvas de saturación" card and its `SaturationCurveChart`
  component are gone from `/modeling` — same underlying data (`hill_k`/`hill_s`/`raw_mean` from
  `GET /models/{id}/summary`), reframed as a business-intuition chart in `/analysis` (see Module 4). The
  coefficient table's inline `decay`/`half-life`/`K`/`S` text (not the chart) is unchanged and still lives here.
- **Excel export (Fase 4)**: `GET /models/{id}/export/summary.xlsx` — the one module in the pipeline that had no
  export until now. Three sheets built from data already computed by `model_summary`/`model_predictions`
  (no new calculation): `metrics` (r2/adj_r2/durbin_watson/mae/rmse/mape, one row), `coefficients` (intercept +
  every coefficient, same fields as `GET /models/{id}/summary`), `predictions` (period/y_true/y_pred/residual,
  `granularity=auto`). Filename is a slug of the model name. Frontend: "Export Excel" button in the Hero Model
  Summary card header, enabled once a hero model has a summary loaded.

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
decay/half-life/K/S inline. The Hill-curve chart itself moved to `/analysis` in Fase 3 (see Module 4).

## Module 4

- Summary contributions: `GET /analysis/{model_id}/summary?include_intercept=bool&as_percent=bool` now aggregates each predictor as the sum of `beta_i * X_i,t` over the filtered date range, so dashboard cards and the summary table react immediately to the selected period. Download: `GET /analysis/{model_id}/export/summary.xlsx`.
  - **Baseline folding**: baseline used to be intercept × row count only. Now, any predictor assigned (directly
    or via Subgroup) to the company's `Group.is_baseline=true` group (see Module 2) has its own
    `beta_i * X_i,t` summed into the baseline line instead of appearing as its own variable/group row — so a
    "Baseline" group in the UI reads as one coherent floor, not split between the true intercept and a
    same-named group. Resolved per-request in `routers/analysis.py::_baseline_predictor_names`, applied inside
    `services/analysis.py::_compute_contributions_impl` (both `/summary` and `/stacked`, and the shared
    economics endpoints below); toggling `is_baseline` calls `clear_analysis_cache()` since the change can
    affect every model on every dataset in the company.
- Stacked contributions: `GET /analysis/{model_id}/stacked?time_col=...&freq=day|week|month&by=group|subgroup&include_intercept=bool&as_percent=bool` uses the same date-filtered sums per period; Excel download: `GET /analysis/{model_id}/export/stacked.xlsx`.
- Frontend `/analysis` now offers dashboard cards (total, baseline, top groups), value/% toggles, stacked area chart, and download buttons with icons.

### Exports (Fase 4)

- **Shared Excel helper**: every `.xlsx` export endpoint (Analysis ×3, Economics ×2, Predict ×3, Modeling ×1 —
  11 total across the backend) now goes through `backend/app/utils/excel.py::excel_response(sheets: dict[str,
  DataFrame], filename) -> StreamingResponse`, replacing 7 near-identical inline `pd.ExcelWriter` +
  `StreamingResponse` blocks. No response shape changed — this was a pure dedup, verified by re-running
  `app.main` import (route count unchanged) after the refactor. Frontend: the `downloadBlob(blob, filename)`
  helper (previously duplicated in `analysis/page.tsx` and `predict/page.tsx`) now lives in
  `frontend/src/lib/download.ts`.
- **PDF — client-side print stylesheet, not server-side rendering** (per the plan's recommendation: the backend
  has no reportlab/weasyprint/headless-browser infra, and recharts already renders the charts in the DOM, so
  controlling print CSS is far cheaper than adding rendering infra for one feature). First cut lives in
  `/analysis` (the view most requested for sharing): an "Imprimir reporte" button calls `window.print()`; a
  `.no-print` utility (`globals.css`) hides chrome that shouldn't appear in the PDF (`Header`, filter/control
  rows), while a `.print-only` block renders a report header (dataset, model, target variable, date range,
  generated timestamp — the timestamp is set on the browser's `beforeprint` event, not at render time, to avoid
  a hydration mismatch). `@media print` also forces the light-mode color tokens regardless of the active theme
  (dark backgrounds don't belong on paper) and resets any `overflow-auto`/`max-h-*` table wrapper to
  `overflow: visible` so tables print in full instead of clipping to their on-screen scroll height. The KPI
  cards, Summary Table, and "Contributions over time" chart are left visible for print; deeper sections
  (saturation curves, per-channel detail) were not specifically tuned — the plan called this a starting point,
  reusable later from the Fase 6 executive dashboard, not a final polish pass.

### Economic layer (ROI/ROAS)

**Conversion settings** (`ConversionSettings` table, dataset-scoped — replaces the old per-`Model`
`conversion_rate`/`avg_value` fields as of Fase 2): every model fit on a dataset now shares one economics
config instead of each needing its own, per `revenue = contribution × conversion_rate × avg_value`. Each of
the two metrics has its own `source_mode` (mirrors `InvestmentChannel`'s 3 modes, minus dated manual entries —
these represent a rate/ticket size, not a $ spend plan):
  - `manual`: `{value}` — a fixed number (the common case; replaces the old scalar fields).
  - `dataset_column`: `{column}` — reads the value from a dataset column, per row.
  - `rate_metric`: `{rate_value, metric_column}` — `value = rate_value × metric_column`, per row.

Endpoints (mounted at `/economics`, same tenancy pattern as `/economics/channels`):
  - `GET /economics/conversion-settings?dataset_id=...` → `{dataset_id, conversion_rate: {source_mode, config},
    avg_value: {source_mode, config}}`, or `null` if never configured for that dataset.
  - `PUT /economics/conversion-settings` with `{dataset_id, conversion_rate: {source_mode, config}, avg_value:
    {source_mode, config}}` upserts (one row per dataset, both metrics always set together).
  - `DELETE /economics/conversion-settings?dataset_id=...` clears it (economics reverts to "not configured").

Existing `Model.conversion_rate`/`avg_value` values were migrated into `ConversionSettings` (manual mode) by
the Fase 2 Alembic migration — one dataset can only carry one value going forward, so where multiple models on
the same dataset had different values, the migration kept hero > challenger1 > challenger2 > none (tie-break:
most recently created) and dropped the rest (see `BITACORA.md`). `Model.conversion_rate`/`avg_value` columns
and the corresponding `CreateModelRequest`/`UpdateModelRequest`/`ModelOut` fields are gone. **Fase 3**: the
Modeling create/edit form's now-dead inputs were removed, and a new "Conversion settings" card in `/transform`
(`components/transform/conversion-settings.tsx`, next to Investment Channels — same dataset-scoped economics
config, same page) reads/writes `/economics/conversion-settings` directly, with a `Select` per metric for
`source_mode` and the matching config inputs.

**Investment channel catalog** (`backend/app/routers/economics.py`, mounted at `/economics`) — a dataset-scoped
catalog (like `Variable`, not a company-wide catalog like Group/Subgroup) representing real $ investment,
decoupled from "which variable made it into the model":

- `GET /economics/channels?dataset_id=...` / `POST /economics/channels` / `PATCH /economics/channels/{id}` /
  `DELETE /economics/channels/{id}` — standard catalog CRUD (same tenancy/role pattern as `/groups`).
- Every channel has a `source_mode` + a `config` shaped accordingly:
  - `dataset_column`: `{cost_column}` — reads a $ column already in the dataset.
  - `rate_metric`: `{rate_value, metric_column}` — `investment = rate_value × metric_column` (fixed rate, v1).
  - `manual`: `{entries: [{amount, start_date, end_date}, ...]}` — each entry is prorated uniformly by
    calendar day across its range, then bucketed into whichever dataset row/period it falls in (same
    day-count proration method used to go from a monthly media plan to weekly rows in the MX-HDI reference
    project).
- `proxy_variable` (nullable) is the model predictor this channel's spend is attributed to. As of Fase 3, the
  `/transform` selector for it defaults to only offering the current hero model's `x_vars` (self-fetched via
  `GET /models?dataset_id=...`) — falls back to every dataset variable when there's no hero yet, and always
  keeps whatever the channel's already-saved `proxy_variable` is in the option list even if it's since fallen
  out of the hero model, so editing an existing (now-misaligned) channel doesn't hide its current value. This is
  a frontend-only narrowing to prevent new misconfiguration; the backend still accepts any variable name. It is
  a hint stored on the channel, not a live binding to any specific model — at analysis time
  `is_modeled = proxy_variable is not None and proxy_variable in model.x_vars`. A channel with
  `proxy_variable = null`, or one whose configured proxy simply isn't one of the *current* model's `x_vars`
  (distinguished via `proxy_in_current_model`), is treated as non-modeled for that view: its investment still
  counts toward totals, but contribution/revenue/ROI are `null`. This is what lets total investment include
  channels with real spend but zero model contribution, and lets a channel with several correlated metrics
  (impressions/clicks/views of the same platform) attribute cost to only the one metric that actually won a
  spot in the model.
- Deleting a dataset cascades to delete its channels; a channel whose `config` references a dataset column
  that no longer exists (e.g. after a rename) degrades to a `misconfigured: true` flag with zero investment
  for that channel, rather than 500ing the whole response.

**ROI/ROAS computation** (`backend/app/services/economics.py`, reusing `compute_contributions` from
`services/analysis.py`):

- `GET /economics/{model_id}/summary?start_date&end_date` → `{model, economics_configured, totals: {investment,
  revenue, contribution, roi, roas, modeled_investment, non_modeled_investment}, channels: [{id, name,
  source_mode, proxy_variable, is_modeled, proxy_in_current_model, misconfigured, investment, revenue,
  contribution, roi, roas, share_of_investment, share_of_contribution}, ...]}`. `roi`/`roas` are `null`
  whenever `economics_configured` is `false` (not zero/misleading placeholder values) or investment is 0.
  `share_of_contribution` is computed over modeled-channel contribution only (excludes baseline).
- `GET /economics/{model_id}/stacked?time_col&freq=day|week|month&start_date&end_date` → per-period
  `{index, totals: {investment[], revenue[]}, series: [{channel_id, channel_name, is_modeled, investment[],
  revenue[]}, ...]}` — raw investment/revenue arrays (not pre-divided ROI/ROAS) so the frontend can guard
  div-by-zero per point.
- `.../export/summary.xlsx` and `.../export/stacked.xlsx` mirror the Module 4 contribution exports.
- Cached via the same `AnalysisCacheKey`/TTL cache as the contribution endpoints (new `view` values
  `econ_summary`/`econ_stacked`); the existing `invalidate_cache_for_model`/`invalidate_cache_for_dataset`
  calls already cover these for free. Channel CRUD additionally calls `invalidate_cache_for_dataset`.

Frontend: `/transform` gained an "Investment Channels" card (create/edit/delete channels per dataset,
including the manual-mode repeatable period list) plus the "Conversion settings" card described above.

**Fase 3 — merged into `/analysis`** (`components/analysis/economics-section.tsx` deleted, absorbed into
`app/(app)/analysis/page.tsx`): the "Contribución"/"Economía" top-level toggle is gone — there's one
continuous view now. `economics-section.tsx`'s old responsibilities moved as follows:
  - Investment/Revenue/ROI/ROAS KPI cards render inline (only when the dataset has ≥1 channel), right after
    the existing contribution KPI cards.
  - The old separate "Canales" table is gone; its numbers are folded into the same Summary Table used for
    contributions instead of a second table. Variable-grain rows (`tableView=variable`) match a channel via
    `channel.proxy_variable === row.name`; group/group_subgroup-grain rows sum every channel whose proxy
    variable belongs to that group/subgroup (via each variable's `group_id`/`subgroup_id` from
    `/analysis/{id}/summary`'s `variables[]`) and recompute ROI/ROAS at that rollup level — this aggregation is
    plain client-side code, not a new backend endpoint (the two existing responses already carry everything
    needed, joined via `proxy_variable`). Channels with no usable proxy (`proxy_variable` null or not in the
    current model's `x_vars`) still appear as a "Sin modelar" row so their real spend is never silently dropped
    from the view.
  - The investment-vs-revenue-over-time line chart (with optional per-channel highlight) is now its own card
    below "Contributions over time", fed by the same `GET /economics/{model_id}/stacked` call as before.
  - The "configure conversion settings" warning banner links to `Transform → Conversion settings` (the new
    Fase 3 home for that config) instead of Modeling.
  - **New**: a "Curvas de saturación" card (moved from Modeling, see Module 3) renders the Hill curve per media
    variable from `GET /models/{model_id}/summary`'s `hill_k`/`hill_s`/`raw_mean`, with the matching channel's
    real `investment` shown as a caption (not plotted on the curve itself — the curve's x-axis is in the media
    variable's own raw units, e.g. impressions, which usually isn't the same unit as $ investment, so showing
    both together as separate numbers is more honest than implying they share an axis). This is the
    "business intuition" framing the plan asked for: current level vs. the full response curve, to help justify
    investment decisions, rather than exposing it as a model-fit diagnostic.

### Budget optimizer (Fase 6 — shared by Predict's Planner mode and Resumen Ejecutivo)

`POST /economics/{model_id}/optimize-budget` with `{budget: float}` → `{allocations: [{channel_id,
name, proxy_variable, suggested_spend, projected_contribution, projected_revenue}], excluded_channels:
[{channel_id, name, reason: "not_modeled"|"no_transform_params"|"no_dollar_rate"}], total_budget,
total_projected_contribution, total_projected_revenue, economics_configured}`. One engine
(`backend/app/services/budget_optimizer.py`), two frontend consumers (Predict's Planner mode,
`/executive-summary`'s "presupuesto inverso") — see `BITACORA.md` Fase 6 for the design decisions
(v1 scope: single objective, no per-channel bounds).

- **Steady-state, not a per-period plan**: allocates one constant spend per channel for the whole
  horizon, by simulating `STEADY_STATE_PERIODS=500` steps of constant spend through the existing
  `adstock_geometric`/`hill_saturation` (`services/media_transform.py`) and reading the converged
  value — reuses the exact same transform as model-fit/Predict, no separate formula to keep in sync.
  Optimizes `Σ coef_c × Hill(spend_c) × conversion_rate × avg_value` subject to `Σ spend_c = budget`
  via `scipy.optimize.minimize` (SLSQP), with 3 seeded starts (uniform, coef-weighted,
  coef×hill_s-weighted) to hedge against Hill's non-convexity when `hill_s > 1`.
- **Only channels with a resolvable $ rate participate**: `spend` is optimized in dollars (what
  "budget" means to the user), but Hill/adstock were fit on the model variable's own units
  (which may be impressions/GRPs, not dollars). `services/economics.py::resolve_channel_dollar_rate`
  derives dollars-per-unit only when the channel's own investment config ties cost directly to
  `proxy_variable` (`rate_metric` with `metric_column == proxy_variable`, or `dataset_column` with
  `cost_column == proxy_variable`); everything else (a `dataset_column`/`rate_metric` channel whose
  configured column differs from its proxy, `manual` dated entries, or no proxy/model membership at
  all) is excluded rather than producing a misleading number, same "degrade, don't lie" policy as
  the rest of this module.
- If the dataset has no `ConversionSettings` configured, `economics_configured=false` and the
  optimizer maximizes projected contribution instead of revenue (same allocation logic, one factor
  dropped) — usable before the economic layer is set up, not blocked by it.

## Module 5

- Scenario builder is now a time-phased planner: choose horizon, start date, and frequency, then edit a grid of periods × variables (either multipliers or absolute overrides). Saved scenarios (max 3 per model) surface as cards with quick metrics and load/delete actions; comparisons and projected totals update in real time with toasts + micro loading states.
- Preview endpoint: `POST /predict/scenarios/preview` with `{ model_id, horizon, start_date, freq, adjustments }` returns `{ periods, total, average_per_period, groups, subgroups, series }` for instant UI feedback.
- Scenario CRUD: `POST /predict/scenarios` saves a scenario, `GET /predict/scenarios?model_id=...` lists them, `GET /predict/scenarios/{id}` fetches one, `PATCH /predict/scenarios/{id}` renames/updates adjustments, and `DELETE /predict/scenarios/{id}` removes it. All responses carry the summary block described above.
- Time series + exports: `GET /predict/scenarios/{id}/timeseries` provides per-period `{ y_pred, by_group, by_subgroup }`. Import a CSV plan via `POST /predict/scenarios/{id}/import` (columns: period, variable, mode, value) and export CSV/XLSX with `GET /predict/scenarios/{id}/export?format=csv|xlsx`.
- **Calendar-aware defaults (Fase 3)**: every unadjusted future period used to default to a single flat
  historical mean per variable, for both control variables and (before adstock/Hill) media variables. Both
  `_compute_plan` (backs preview/create/update/timeseries) and `_scenario_matrix` (backs the assumptions export)
  now default from `_calendar_bucketed_means`: the historical mean of that variable **at the same calendar
  position** — month-of-year for `freq=month`, ISO week for `freq=week`, `(month, day)` for `freq=day` — falling
  back to the flat mean when a future period's bucket has no historical rows (e.g. a horizon that outruns a
  year of history). Applied uniformly to every variable, not just ones flagged "seasonal" — there's no such
  flag on `Variable` today, and a non-seasonal variable's bucketed mean converges close to its flat mean anyway,
  so this never makes results worse, only more accurate for genuinely seasonal ones. `/predict/{model_id}/simulate`
  (the flat, non-period multiplier preview used by `_compute_contributions`) is intentionally untouched — it has
  no period/calendar concept to be seasonal about.
- **ROI/ROAS on the projected scenario (Fase 6)**: `_compute_plan` now also captures per-variable
  raw-value and contribution series across the horizon (`variable_raw_series`/
  `variable_contribution_series`, alongside the existing group/subgroup aggregation — no change to
  what gets aggregated there) and derives per-channel economics from them via
  `_compute_scenario_economics`, added as an optional `economics` field on `ScenarioSummary`:
  `{channels: [{channel_id, name, proxy_variable, investment, contribution, revenue, roi, roas}],
  total_investment, total_revenue, roi_total, roas_total, economics_configured}` (`null` when the
  dataset has no `InvestmentChannel`s, or none resolve). Same `resolve_channel_dollar_rate` units
  handling as the budget optimizer above — a channel whose cost can't be tied to its `proxy_variable`
  in dollars is silently omitted from this per-channel breakdown (lighter-weight than the full
  Module 4 Economics view, not a replacement for it). `conversion_rate`/`avg_value` are held constant
  at their historical average for the whole projection (`resolve_conversion_scalars`) — future rows
  of a `dataset_column`-mode metric are not projected.
- **Modo Planner (Fase 6)**: `/predict` gained a Planner/"Vista avanzada" toggle next to the scenario
  builder. Planner mode renders `components/predict/PlannerView.tsx` instead of the raw grid: a
  budget input + "Optimizar presupuesto" button calling the budget optimizer above, editable
  per-channel suggested spend, and "Aplicar al escenario" which writes `{mode: "value",
  value: suggested_spend}` into every period of the active horizon for each channel's
  `proxy_variable` (same `PeriodValue` shape the grid already writes) — no new scenario-update
  endpoint. Vista avanzada is unchanged. New Investment/Revenue/ROI/ROAS KPI cards render above the
  toggle when `preview.economics` is present.

## Admin (companies & memberships)

Company/member management is not one of the 5 pipeline modules — it's a platform-level concern gated by
`is_platform_admin`/`admin_compania`, not by the dataset→...→predict flow. Backend was already complete before
the frontend existed (`routers/admin.py`); Fase 5 of the UI/UX redesign added the frontend plus 3 small backend
gaps found while building it.

- **Auth model**: `platform_admin` is a pure email allowlist (`AION_PLATFORM_ADMIN_EMAILS`, checked via
  `auth.py::is_platform_admin`) — no DB flag. `admin_compania` is a `Membership.role`, scoped to one company.
  `auth.py::require_company_admin` resolves `company_id` from the **URL path**, not `X-Company-Id`, so a company
  admin can't manage a different company by swapping the header.
- **Companies**: `POST /admin/companies` (`require_platform_admin`) creates a `Company` + its first
  `admin_compania` `Membership` in one call (`{name, admin_user_id}` → `CompanyOut`). `GET /admin/companies`
  lists all companies. `PATCH /admin/companies/{id}` (`{name}`) renames. `DELETE /admin/companies/{id}` only
  succeeds if the company has zero memberships and zero datasets (400 with counts otherwise) — no cascading
  delete across the ~10 other company-scoped tables (Variable/Group/Model/Scenario/...) or Supabase Storage
  objects is implemented, by design: remove members/datasets first, then delete the empty company.
- **Members**: `GET/POST /admin/companies/{id}/members` and `PATCH/DELETE /admin/companies/{id}/members/{user_id}`
  (all `require_company_admin`) list/add/update-role/remove a membership. `POST` 409s if the user is already a
  member; `PATCH`/`DELETE` 404 if the membership doesn't exist. `MembershipOut` now also carries `email: str |
  None` (looked up per-row via `find_user_by_id`, best-effort — `None` if the Admin API call fails or the auth
  user is gone) so the members table doesn't show raw Supabase UUIDs.
- **Email → user_id lookup**: `GET /admin/users/lookup?email=...` (`require_admin_privilege` — platform admin OR
  `admin_compania` of any company) calls the Supabase GoTrue Admin API (`utils/supabase_admin.py::find_user_by_email`,
  service-role `httpx` call, same pattern as `utils/storage.py`) since neither `POST /admin/companies` nor
  `POST /admin/companies/{id}/members` accept an email — both need a raw Supabase `user_id`. 404s if no user has
  that email (the user must already have a Supabase auth account — there's no invite-by-email/signup-trigger flow).
- **Client-side platform-admin signal**: `GET /me/memberships` now returns `{is_platform_admin, memberships[]}`
  instead of a bare array (`MyMembershipsOut`) — `is_platform_admin` is computed the same way the backend gates
  `require_platform_admin`, so the frontend never duplicates the allowlist. `AuthBootstrap` stores it in
  `useGlobalStore` (`isPlatformAdmin: boolean`); `useIsPlatformAdmin()` (`hooks/useCanEdit.ts`) reads it.
- **UI**: `/admin` (inside the `(app)` route group, so it keeps `Header`/nav). Visible in the Header only when
  `useIsPlatformAdmin()` or `useCanManageUsers()` (existing `admin_compania` check) is true. Platform admins see
  a "Companies" panel (create/rename/delete, backed by the email-lookup for `admin_user_id`); company admins see
  a "Members" panel scoped to their `activeCompanyId` (add by email, change role, remove). The backend 403s
  independently of this UI gating, per the multi-tenancy convention in `CLAUDE.md`.

## Resumen Ejecutivo (Fase 6)

Not one of the 5 pipeline modules — a condensed top-level view for the "decision maker" persona
(see `BITACORA.md` Fase 6), self-contained the same way `/analysis`/`/predict` are (its own
dataset/model selectors, not the global store's `datasetId`/`modelId`).

- **UI**: `/executive-summary` (inside the `(app)` route group), linked from the Header for every
  role (this is a consumption mode, not a permission).
- **No new read endpoints**: KPIs (`fit R²`/`adj. R²` from `GET /datasets/{id}/models-with-roles`,
  total contribution + top groups from `GET /analysis/{model_id}/summary`, ROI/ROAS totals from
  `GET /economics/{model_id}/summary`) reuse exactly the calls `/analysis` already makes — no
  aggregation endpoint was added for this page.
- **"Presupuesto inverso"**: renders `PlannerView` (see Module 5) with `onApply` omitted, so only the
  budget input, "Optimizar presupuesto" button, and the resulting per-channel allocation show — no
  "Aplicar al escenario" action, since there's no scenario/flow concept on this page.