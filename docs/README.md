# Aion — Especificación técnica por módulo

> Descripción general del proyecto, estado actual y setup de desarrollo: ver `README.md` en la
> raíz. Historial de decisiones y pendientes: ver `BITACORA.md`.

Este documento es la referencia de contratos (endpoints, request/response) entre frontend y
backend, por módulo. Actualízalo cuando agregues o cambies un endpoint.

## Error responses (Fase 7.9)

User-facing 4xx errors across the 8 routers now use `backend/app/errors.py::api_error(status_code, code,
message, **extra)`, which raises an `HTTPException` with `detail = {"code": SCREAMING_SNAKE_CASE, "message":
str, **extra}` instead of a bare string — `code` is stable and machine-readable, `message` is the same
English text the string used to be (kept as a fallback), and `**extra` preserves any structured fields older
call sites already returned (e.g. `dependencies`, `differences`, `samples`, `dataset_id`). **Not** applied to
500s or to auth/tenancy infrastructure errors (`tenancy.py::get_scoped`'s 404, `auth.py`'s 401/403) — those
stay plain-string `HTTPException`s, out of scope. Frontend: `lib/api.ts`'s `ApiError` now also carries `.code`;
`lib/error-messages.ts::translateApiError(err, t)` (where `t = useTranslations("errors")`) looks up
`errors.<CODE>` in `lib/i18n/messages/{es,en}.json` and falls back to the raw backend `message` for any code
not (yet) mapped there. When adding a new user-facing 4xx, raise it via `api_error(...)` with a new code and
add that code to both locale files — don't reintroduce a bare-string `HTTPException` for anything a user sees
in a toast/inline error, or it'll silently skip translation (still shows the English message via the
fallback, just not localized).

## Module 1

- UI: `/datasets` replaces the legacy upload screen. Drag-and-drop zone, dataset list with stats, schema preview, rename/delete actions, dependency warning modal, sticky toasts.
- Upload endpoint `POST /datasets/upload?force=false` computes file checksum and blocks silent duplicates (409 response with `dataset_id` so the UI can re-use or force upload).
- Metadata now includes `display_name`, `file_name`, `checksum`, `created_at`, `last_used_at`, and dependency counts (variables/models/scenarios).
- Rename endpoint: `PATCH /datasets/{id}/rename` updates the display label without touching the underlying file.
- Delete endpoint: `DELETE /datasets/{id}?cascade=true|false` removes dataset + dependents (variables, models, scenarios) when `cascade=true`. If dependencies exist and `cascade=false`, the API returns a 400 with counts so the UI can warn the user.
- Preview endpoint updates `last_used_at` for "recent" order and continues to serve first 20 rows with dtype chips.
- Working sample selector: dataset detail now exposes a “Working Sample Size” control (All rows vs. Custom). Selection calls `PATCH /datasets/{id}/sample_size` (with `{ sample_size: null|number }`), persists on the dataset, and every downstream module (Transform/Modeling/Analysis/Predict) automatically restricts computations to the first `sample_size` rows. Responses now include `sample_size` and `total_rows` so the UI can display “Currently using X of Y rows” and show a confirmation/loading overlay before applying the change.
- Time variable selector: choose a temporal column inside the dataset detail card. `GET /datasets/{id}/time_candidates` suggests columns; `PATCH /datasets/{id}/time_variable` saves `{ column, coerce, time_format, timezone, frequency? }` (or clears when `column=null`). All analytics endpoints now load data via the helper that enforces sample size + datetime parsing, so temporal features (lag/decay, stacked charts, scenario horizons) stay consistent.
- **Dataset frequency (Fase 8, D1/P1)**: `Dataset.frequency` (`"daily"|"weekly"|"monthly"|null`) is metadata only — it doesn't re-aggregate the dataset or change model fitting. Set automatically on `PATCH /datasets/{id}/time_variable` from the modal delta between consecutive sorted timestamps of the chosen column (`≤3 days → daily`, `≤10 → weekly`, else `monthly`), or pass `frequency` explicitly in the same request to override the inference. A dedicated `PATCH /datasets/{id}/frequency` with `{ frequency: "daily"|"weekly"|"monthly"|null }` (Fase 5/P1) lets the user correct it later without re-touching the time variable — it's a pure override, it never re-runs inference. Returned on `DatasetOut.frequency` and `TimeCandidateResponse.current.frequency`. UI: a "Dataset frequency" `Disclosure` on the dataset detail card (same pattern as Dependent variable), right after it. Predict (Module 5) uses it as the default AND floor for a scenario's own `freq` — a monthly dataset can't plan week-by-week.
- **Dataset version on `GET /datasets/{id}/meta`** (Fase 8/Fase 4, A09-R10): `DatasetMeta.version` now
  echoes `Dataset.version` (already tracked for "Update File" replacements) — Analysis reads it to show
  provenance in its print report and Excel exports (see Module 4), rather than needing a second endpoint.
- Replace dataset file: new “Update File” action opens a modal that uploads a CSV/XLSX via `POST /datasets/{id}/update` (strict vs. force schema modes). Each replacement writes `/data/{dataset_id}/v{n}.parquet`, bumps the dataset’s `version`, and archives the previous file so `GET /datasets/{id}/versions` can list history. Schema differences return 400 with added/removed columns, and a success toast announces the new version.
- Dependent variable: `Dataset.dependent_variable` (nullable string, a column name) is set via `PATCH /datasets/{id}/dependent_variable` with `{ column: string|null }` (400 if the column doesn't exist) and returned on `DatasetOut`. UI: a "Dependent variable" `Select` on the dataset detail card (right after the Time variable card), auto-saving on change; `POST /variables/transform/preview` (Module 2) reads it to add correlation-vs-dependent to its preview response.
- Hide variable from Datasets: the dataset summary modal's column table ("View details") now fetches `GET /variables?dataset_id=...&include_excluded=true` alongside `GET /datasets/{id}/summary` and joins by column name, adding a "Hide" checkbox column that calls `PATCH /variables/{id}/categorization` with `{ is_excluded }` only (see Module 2 — this is exactly the omit-vs-null-safe shape that lets a page with no group/subgroup context toggle just this one field).

## Module 2

- UI: `/transform` provides a variable browser with search/filter, drag & drop categorization into Groups/Subgroups, derived badges, sparkline previews, undo (Ctrl+Z), and history modals per variable.
- Backend:
  - `GET /variables?dataset_id=...&search=&dtype=&derived=&include_excluded=false` supports filtering; excluded
    variables (see below) are hidden by default, pass `include_excluded=true` to see them.
  - `POST /variables/transform` returns `{ variable, preview[] }` for preview sparklines; history saved per variable.
  - `PATCH /variables/{id}/categorization` sets group/subgroup (subgroup optional, validates parent group),
    `is_excluded`, and/or `display_name`/`unit` (Fase 6, see below) — all fields independently optional, a
    field is only touched when the request body actually includes its key, tracked via Pydantic's
    `model_fields_set`, not by truthiness; omitting `group_id`/`subgroup_id` entirely leaves the existing
    category untouched, while sending `group_id: null` explicitly still clears it — this fixed a real bug found
    in Fase 3 where a request with only `is_excluded` would have silently wiped the variable's group).
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
- **Business-friendly variable name/unit (Fase 6, A03-R8)**: `Variable.display_name`/`unit` (both nullable
  `str`), editable inline in `/transform`'s variable row (pencil icon → 2 inputs + Save), same
  `PATCH /variables/{id}/categorization` endpoint as above. `backend/app/utils/variable_labels.py` centralizes
  resolution used by every consumer: `resolve_label(name, channel_map, var_map)` priority is curated
  `InvestmentChannel.name` (existing economics-layer label, Module 4) → `Variable.display_name` → raw column
  name; `resolve_unit(name, var_map)` returns the unit or `None`. Wired into `GET /analysis/{id}/summary`
  (`variables[].display_name`/`unit`, `model.y_var_display_name`/`y_var_unit`), `GET /models/{id}/summary`
  (`CoefficientItem.display_name` — previously "intentionally" raw per Fase 7.9, revisited here since the
  tornado chart is a business-facing view), and `predict.py`'s `_compute_contributions` (`variables[].display_name`/
  `unit`, feeds the Predict grid). `models.py`'s raw coefficients/correlations table (statistical detail, Fase
  7.6) deliberately still shows the raw name — that one's modelador-facing, not a business screen.
- **Manual Hill/Adstock transforms**: `TransformOp` (`schemas.py`) gained `hill`/`adstock` alongside the existing
  `lag|decay|log|add|sub|mul|div`. `POST /variables/transform` (`TransformRequest`) accepts `column` + `k`/`s`
  for `hill`, `column` + `decay` for `adstock`; `POST /variables/transform/preview` accepts the same via its
  free-form `params` dict. Both reuse `services/media_transform.py::hill_saturation`/`adstock_geometric` directly
  (not the combined `apply_media_transform` lag+adstock+hill pipeline used for automatic per-model media
  transforms) — these are one-shot manual transforms, saved as a normal derived `Variable` like any other
  Transform op, independent of the per-model automatic transform described below. UI: "Hill (saturation)"/
  "Adstock (carryover)" added to the operation `Select` in `/transform`'s "Create transformation" card, with
  matching K/S or decay inputs.
- `POST /variables/transform/preview` (live preview of a transform before saving it) response shape
  (Fase 8/Fase 3, T2/T3/T4): `{ time, original, transformed, dependent, dependent_label, stats }`.
  `original` and `dependent` are now `null` (not an empty/zero-filled array) when they don't apply —
  `original` is `null` for the 4 generator ops below (there's no source column to compare against),
  `dependent` is `null` whenever `Dataset.dependent_variable` isn't set. `stats.correlation` (original
  vs transformed) is only present when `original` is; `stats.correlation_dependent_before`/`_after`
  (original vs dependent / transformed vs dependent) are present whenever `dependent` is, replacing
  the earlier, less useful `corr(original, transformed)` as the headline correlation once a dependent
  variable exists. UI (`/transform`): the preview chart is now a `ComposedChart` — `original` as bars
  on a left Y axis, `transformed` as a line on a separate right Y axis (fixes the Hill saturation
  preview, T4: Hill's `[0,1]` output was flattening to a line at zero against raw values in the
  millions sharing one axis), `dependent` as a third, dashed line on its own hidden axis (scale
  isolation only, not a 3rd set of visible ticks).
- **Adstock lag (Fase 8/Fase 3, T1)**: the manual `adstock` transform op now accepts an optional
  `lag: int` (`TransformRequest.lag` / preview `params.lag`, default `0`) applied before the decay,
  identical to the lag step in `services/media_transform.py::apply_media_transform` used by the
  automatic per-model search — previously only the automatic search could combine lag+adstock in one
  step; the manual builder required a separate `lag` transform chained into a second `adstock`
  transform. UI: a "Lag, periodos (opcional)" input next to "Adstock (arrastre)"'s decay input.
- **Variable generators (Fase 8/Fase 3, T5/D6)**: `TransformOp` gained 4 new values that generate a
  column from scratch instead of transforming an existing one — `constant` (`value: float`),
  `date_dummy` (`start_date`/`end_date`, requires `Dataset.time_variable` set, 400
  `TIME_VARIABLE_REQUIRED` otherwise), `trend` (no params — 0-based chronological rank via a shared
  `_time_order()` helper, falling back to row order when there's no time variable), and `fourier`
  (`period: float`, `harmonic: int` default `1`, `trig: "sin"|"cos"` default `"sin"` — `sin/cos(2π ·
  harmonic · time_order / period)`). All four work through both `POST /variables/transform` and
  `/transform/preview` identically. UI: a second `<optgroup>` ("Generar variable nueva") in the
  operation `Select`.
- **Seasonal flag UI (Fase 8/Fase 3, T6-UI)**: the `is_seasonal` group/subgroup flags added
  backend-only in Fase 1 (see above) now have a checkbox in `/transform`'s "Groups & Subgroups" card
  (mirrors `apply_media_transform`/`is_baseline`), gated behind the same company-wide-retroactive-flag
  confirmation modal used for those two (extended to a 3rd `kind: "seasonal"` and an optional
  `subgroup` field so the one modal handles both group- and subgroup-level seasonal toggles).
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
- **Seasonal flag (Fase 8, T6/D3)**: `Group`/`Subgroup` now also carry `is_seasonal: bool` (default
  `false`). Same resolution order as the media flag (Subgroup wins, falls back to Group, else
  `false`) via `services/model_fit.py::resolve_seasonal_flags`. Accepted on `POST /groups`,
  `POST /groups/subgroups`, `PATCH /groups/{id}`, `PATCH /groups/subgroups/{id}` (all optional,
  independently settable like `apply_media_transform`), returned on `GroupOut`/`SubgroupOut`. Only
  a seasonal-flagged variable gets its Predict projections bucketed by calendar pattern
  (`routers/predict.py::_calendar_bucketed_means`) instead of a flat historical mean — see Module 5.
  No UI yet (backend-only phase); defaulting to `false` means every forecast reverts to flat-mean
  projections until a group is explicitly flagged (a deliberate, user-confirmed choice — see
  BITACORA — since this phase ships no toggle to opt back in yet).

## Module 3

- Correlations: `GET /models/correlations?dataset_id=...&y=...` (numeric columns only). Always
  computed on raw values — the adstock/Hill grid search (below) only runs when a model is actually
  fit, not while browsing candidate predictors.
- Create models: `POST /models` with `dataset_id`, `name`, `y_var`, `x_vars`.
- Update/re-fit: `PATCH /models/{id}` to rename and/or change predictors (re-computes metrics).
- Delete: `DELETE /models/{id}` removes metrics, transform params, and dependent scenarios.
- Dependencies (Fase 8, Fase 0): `GET /models/{id}/dependencies` ⇒ `{scenarios: int}` — scenario
  count for that model, computed on demand (not eagerly like `DatasetOut.dependencies`, since a
  model has no other cross-user dependency worth surfacing). Frontend calls it when opening the
  delete-confirmation modal in `/modeling`, to warn that deleting a model cascades to any Predict
  scenarios built on top of it — same intent as the dataset delete modal's dependency list.
- Roles: `POST /models/{id}/role` with `hero|challenger1|challenger2|none` (enforces 1 Hero + 2 Challengers max). Legacy `/hero` endpoint still works.
- Summary: `GET /models/{id}/summary` ⇒ intercept + coefficients with β, std err, t, p, VIF, plus
  (new) `is_media`, `decay`, `half_life`, `hill_k`, `hill_s`, `lag`, `raw_mean` per coefficient when
  that variable is media-flagged (see below); all `null` for control variables. Also returns
  `y_mean` (Fase 8/Fase 4, top-level, alongside `intercept`/`coefficients`) — the fitted `y`
  series' own mean, reusing a value already computed during the fit rather than a new query.
  Analysis uses it to express MAE/RMSE as a % of the dependent variable's historical average
  (`GET /analysis`'s own KPI card, not this endpoint's own consumer — see Module 4).
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

### Per-model grid search config (Fase 8, M1) and best/runner-up scores (A09-R7)

- `Model.media_grid_json` (nullable) overrides the module-default search space in
  `services/model_fit.py` (`DECAYS`/`SHAPES`/`LAGS`/`K_QUANTILES`) for that model only. Set via
  `media_grid` on `CreateModelRequest`/`UpdateModelRequest` (`MediaGridConfig`: optional
  `decays`/`shapes`/`lags`/`k_quantiles` lists — any field left out falls back to that field's
  default). `PATCH /models/{id}` treats setting `media_grid` (even to an all-default config) as a
  refit trigger, same as changing `x_vars`/`apply_media_transforms`. `resolve_media_grid(model)`
  resolves the effective grid (defaults when unset/malformed/empty), exposed read-only on
  `ModelOut.media_grid` + `ModelOut.media_grid_combinations` (the configured search-space size —
  actual per-channel combos also depend on the channel's own nonzero-value quantiles). No UI yet
  (backend-only phase) — a model created/updated without `media_grid` behaves exactly as before.
- `search_media_hparams` now also tracks the runner-up (2nd-best) corr² score alongside the
  winner, both persisted on `ModelTransform` (`best_score`/`runner_up_score`, both nullable —
  `null` when a channel is all-zero and never actually searched). Exposed per-coefficient via
  `GET /models/{id}/summary`'s `CoefficientItem.best_score`/`runner_up_score`. Not used for
  anything yet — stored so a later phase can flag an optimum as "stable" (clear margin over the
  runner-up) vs. "ambiguous" (near tie) without needing to re-run the search retroactively.

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
- **Business-friendly variable names (Fase 7.9, extended Fase 6)**: each row in
  `GET /analysis/{model_id}/summary`'s `variables[]` carries `display_name`/`unit`, resolved via
  `utils/variable_labels.py` (Module 2) — priority is a curated `InvestmentChannel.name` (Transform's
  economics layer), then `Variable.display_name`, then the raw column name unchanged. The response's
  `model` block also carries `y_var_display_name`/`y_var_unit` for the dependent variable. Lets query
  screens show "Facebook Ads" (or "150.3 conversiones" for the target) instead of a raw column name.
  `POST /analysis/summary/export`'s `"variable"` mode uses `display_name` too. As of Fase 6 this is no
  longer scoped to `analysis.py` only — `GET /models/{model_id}/summary`'s `CoefficientItem.display_name`
  feeds Modeling's tornado chart (a business-facing view, unlike the raw coefficients/correlations
  table next to it, which stays technical/modelador-facing on purpose — Fase 7.6's detail toggle).
- **Actionable vs. non-actionable groups (Fase 6, A03-R9)**: `group_rows` in
  `GET /analysis/{model_id}/summary` gained `is_seasonal: bool` (from `Group.is_seasonal`, `false` for
  baseline/"Other"). Frontend: `components/charts/waterfall-chart.tsx`'s `WaterfallSegment` gained
  `actionable?: boolean` (baseline and any `is_seasonal` group render at reduced opacity + a legend
  note) — used by both Executive Summary and `/analysis` (same shared component). Executive Summary
  also shows an "X% of total contribution is actionable" callout from the same split.
- **Shared insight sentence (Fase 6, A06-R9+A08-R8)**: `frontend/src/lib/insight-text.ts::buildContributionInsight`
  extracts the "{group} explains {pct}% of {yVar}..." sentence previously inline only in Executive
  Summary; `/analysis` now renders the same sentence from its own group data.
- **Non-causality note + suspicious-result check (Fase 6, A09-R4)**: Executive Summary shows a fixed
  disclaimer ("statistical correlation, not guaranteed causality") and flags any actionable
  (non-baseline, non-seasonal) group with negative contribution as a warning — both frontend-only,
  reusing data `/summary` already returns.
- **Saturation curve in $ (Fase 6, A03-R7)**: `GET /economics/{model_id}/summary`'s per-channel
  `ChannelEconomics` gained `dollar_rate` (reuses `services/economics.py::resolve_channel_dollar_rate`,
  already used by the budget optimizer and Predict's $ mode). `SaturationCurveChart` (`/analysis`)
  rescales `k`/`raw_mean`/domain/plotted points by that rate before rendering when a channel/rate is
  resolvable (the Hill math itself still runs on raw units — only the displayed x-axis changes),
  falling back to raw units otherwise.
- **Hero/challenger explainer (Fase 6, A06-R8)**: an info tooltip next to "Rol"/"Role" in Modeling's
  models table, and next to "Modelo"/"Model" in Executive Summary's and Analysis's model selectors
  (`components/ui/filter-bar.tsx::FilterField.label` widened from `string` to `ReactNode` to allow
  this — backward compatible). No prior copy explained hero vs. challenger anywhere in the UI.
- **Compare 2 models (Fase 6, A10-R7)**: `/analysis` gained a "Compare with" model selector (defaults
  to the best-ranked model other than the one selected), fetching a second
  `/analysis/{id}/summary` + `/economics/{id}/summary` pair and rendering a compact side-by-side card
  (total contribution, ROI, top 3 groups). No backend change — both endpoints already existed.

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

`POST /economics/{model_id}/optimize-budget` with `{budget: float, objective?, marginal_roi_threshold?,
target_revenue?}` → `{allocations: [{channel_id, name, proxy_variable, suggested_spend, dollar_rate,
projected_contribution, projected_revenue, historical_max_spend, out_of_historical_range,
low_marginal_return}], excluded_channels: [{channel_id, name, reason: "not_modeled"|"no_transform_params"|"no_dollar_rate"}],
total_budget, total_projected_contribution, total_projected_revenue, economics_configured}`. One engine
(`backend/app/services/budget_optimizer.py`), two frontend consumers (Predict's Planner mode,
`/executive-summary`'s "presupuesto inverso"). `suggested_spend` is in dollars (steady-state
total across the whole horizon); `dollar_rate` (dollars per unit of `proxy_variable`) is exposed so
callers can convert to the model variable's native units before writing an allocation into a
scenario — see Planner mode below (added 2026-08-13 after a real unit-mismatch bug: writing
`suggested_spend` directly into a scenario's raw model-variable value inflated the projected
Investment KPI by orders of magnitude).

- **Three objectives (Fase 5/P5, D2)**: `objective: "max_revenue"|"max_roi"|"min_spend"` (default
  `max_revenue`, the original v1 behavior below — unchanged). `"max_roi"` is a **greedy marginal
  allocator**, not a single SLSQP call — "aggregate ROI" is a ratio of sums, not a smooth scalar
  objective, and its stopping rule ("next dollar no longer clears `marginal_roi_threshold`", a new
  optional request field, default 0) is inherently a marginal/greedy decision, not a continuous
  optimization target. It hands the next small spend increment to whichever channel currently has
  the best marginal ROI and stops once nothing clears the threshold or `budget` runs out — spend
  sums to AT MOST `budget`, and can legitimately be far less. `"min_spend"` minimizes total spend
  subject to reaching `target_revenue` (new required field for this objective) — a real SLSQP call
  with an inequality constraint; `budget` is unused for the optimization itself, only as a
  per-channel fallback bound. When the target is unreachable even at every channel's own historical
  cap, it falls back to spending at the caps rather than silently understating what's needed (the
  shortfall shows up as `total_projected_revenue < target_revenue` in the response).
- **Historical spend ceiling + zero-allocation reason (Fase 5, A09-R6/A09-R8)**: each channel now
  carries a `historical_max_spend` (max observed raw spend for its `proxy_variable` from `work`,
  the historical dataframe × its `dollar_rate`; `None`, not 0, when there's no usable history).
  `"max_roi"`/`"min_spend"` use it as a genuine per-channel upper bound during optimization;
  `"max_revenue"` deliberately does **not** — forcing spend to sum to exactly `budget` while
  respecting per-channel historical caps can be infeasible, and the equality-constraint's existing
  clip+rescale-to-`budget` step would just push spend back over the cap to preserve that guarantee.
  Every objective instead gets a **post-hoc, read-only flag** per channel:
  `out_of_historical_range` (`suggested_spend > historical_max_spend`) and `low_marginal_return`
  (this channel got ~$0 while at least one other channel received positive spend — distinguishes
  "lost out on marginal return" from "budget was zero"). Both surface as badges in
  `components/predict/PlannerView.tsx`, which also gained the objective selector (segmented
  control) and the conditional threshold/target inputs.

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

### Analysis legible (Fase 8, Fase 4 — not to be confused with the "Exports (Fase 4)" section above,
which is the *original* 7-phase redesign's Fase 4; see BITACORA "Rediseño UI/UX" for the naming history)

- **R² + dataset version, provenance everywhere an export leaves the app**: `GET
  /analysis/{id}/export/summary.xlsx`, `POST /analysis/summary/export`, and `GET
  /analysis/{id}/export/stacked.xlsx` now all include an `Info` sheet (Model, Dataset, Dataset
  version, R², Date range, Generated timestamp) via a shared `routers/analysis.py::_export_info_sheet`
  helper — no response shape changed for the existing sheets. The `/analysis` print report
  (`.print-only` header) shows the same R²/dataset version line. Dataset version comes from the new
  `DatasetMeta.version` field (see Module 1); R² from `ModelMetrics`, already loaded per model.
- **`y_mean` on `GET /models/{id}/summary`** (see Module 3): Analysis's Fit KPI card shows R² + a
  quality badge (same `>0.7` threshold Modeling/Resumen Ejecutivo already use) and expresses
  MAE/RMSE as a % of this value in the card's tooltip, instead of showing raw error numbers with no
  sense of scale.
- **Shared `WaterfallChart`** (`frontend/src/components/charts/waterfall-chart.tsx`): the
  baseline→groups→Total attribution waterfall, previously inline in `executive-summary/page.tsx`
  only, is now a standalone component (props: `baseline`, `segments`, per-string labels, and an
  optional `yAxisLabel` — no page-specific state). Resumen Ejecutivo renders from it unchanged;
  `/analysis` replaced its always-visible "Contribución por grupo" bar (the old `GroupProportionBar`,
  now deleted) with this same component, passing `yAxisLabel="Contribución"` — both fed by the same
  `proportionSegments` data Analysis's KPI cards already used (so the numbers can't drift out of
  sync). Not a separate tab: the waterfall *is* the main contribution chart on `/analysis` now.
- **Detail table filter + sort** (A5/A6): the Analysis detail table gets a multi-select
  group/subgroup filter (`ToggleChip` rows, AND-combined, reset on model change) and click-to-sort
  column headers. The sort affordance lives in the shared `components/ui/table.tsx::Th` itself now
  (`sortDirection`/`onSort` props, optional — every other `<Th>` in the app is unaffected), so any
  future sortable table reuses the same control instead of a bespoke one.
- **Chart legibility**: the stacked contributions chart and the investment/revenue timeseries chart
  both gained a Y-axis title (`{yVar}` or the active currency); the saturation curves gained X/Y axis
  titles and a real tooltip label (previously a bare `x=1.2`/`45%` with no indication of what those
  numbers were). The saturation chart's ceiling/historical-average reference lines switched from a
  categorical red (`chartColor(7)`, previously reused for both regardless of meaning) to the
  `warning`/`good` semantic tokens in `lib/chart-colors.ts`'s `CHART_STATUS_LIGHT/DARK`. The
  timeseries chart's series are now sorted by magnitude (sum of `|value|` across the period) before
  color assignment, and anything past the 8 categorical slots is summed into one real "Otros"
  series instead of several distinct series silently sharing one overflow color.

## Module 5

- Scenario builder is now a time-phased planner: choose horizon, start date, and frequency, then edit a grid of periods × variables (either multipliers or absolute overrides). Saved scenarios (max 5 per model, enforced by `_ensure_scenario_capacity` in `routers/predict.py`) surface as cards with quick metrics and load/delete actions; comparisons and projected totals update in real time with toasts + micro loading states.
- Preview endpoint: `POST /predict/scenarios/preview` with `{ model_id, horizon, start_date, freq, adjustments }` returns `{ periods, total, average_per_period, groups, subgroups, series }` for instant UI feedback.
- **Frequency default/floor from the dataset (Fase 5, P1)**: frontend-only — `predict/page.tsx` maps the selected dataset's `frequency` (`"daily"|"weekly"|"monthly"`) to the scenario's own `freq` literal (`"day"|"week"|"month"`, different strings for the same concept) and uses it both as the default when starting a fresh scenario and as a floor: options finer than the dataset's own frequency are disabled in the `freq` `Select` (a monthly dataset can't be planned week-by-week). No backend change — `ScenarioBase.freq` still accepts any of the three values, this is a UI guardrail only.
- Scenario CRUD: `POST /predict/scenarios` saves a scenario, `GET /predict/scenarios?model_id=...` lists them, `GET /predict/scenarios/{id}` fetches one, `PATCH /predict/scenarios/{id}` renames/updates adjustments, and `DELETE /predict/scenarios/{id}` removes it. All responses carry the summary block described above.
- **Seasonal per-period baseline exposed to the grid (Fase 5, P2)**: `_compute_plan` now also
  returns `ScenarioSummary.variable_baselines: {variable_name: {period_label: raw_value}}` — the
  exact same seasonal-bucketed (or flat, for non-`is_seasonal` variables) baseline the backend
  actually simulates a multiplier against, computed from `calendar_buckets` (already built for the
  simulation itself) with a RAW mean from `work` as fallback — deliberately not the existing
  `baseline_means` local var in the same function, which is a mean of `X` (identical to `work` for
  structural variables, but the *transformed* adstock+Hill series for media ones — wrong basis for
  a grid that always edits raw units). Frontend: `ScenarioSheetGlide`/`ScenarioSheetTable` gained a
  `baselineByPeriod` field per row (falls back to the old flat `baselineMean` before the first
  preview response arrives), fixing a real bug where the grid's displayed multiplier-mode value
  could silently disagree with what got simulated whenever a variable had `is_seasonal=true`.
- **$ investment mode + totals (Fase 5, P8)**: `/predict/{model_id}/simulate` now returns
  `dollar_rate: float | null` per variable row (same `resolve_channel_dollar_rate` resolution as
  the budget optimizer/scenario economics, keyed by variable name instead of channel). The grid's
  previously-dead `editMode` prop (typed `"multipliers" | "absolute"`, never branched on) is
  repurposed as `"units" | "dollars"` and actually implemented: a toggle next to "Vista avanzada"
  (shown only when at least one variable has a `dollar_rate`) converts display/input to $ for rows
  with a resolvable rate — `adjustments` sent to the backend are always in the variable's native
  unit regardless of the toggle, conversion is display-only. Both grids gained a read-only totals
  row (sum per period) and totals column (sum per variable across the horizon).
- **Business-friendly variable name in the grid (Fase 6 — Narrativa ejecutiva)**: the same
  `/simulate` response also carries `display_name`/`unit` per variable row (see Module 2/4's
  `utils/variable_labels.py`) and `model.y_var_display_name`/`y_var_unit`. `ScenarioSheetGlide`/
  `ScenarioSheetTable` render `displayName` (falling back to the raw name) in the "Variable" column
  — lookups/edits by key still use the raw `name`, only the label changed.
- **Separate media from structural variables (Fase 5, A07-R2)**: the grid is no longer one flat
  table — `predict/page.tsx` splits variables by whether they resolve a `dollar_rate` into two
  independent `ScenarioSheetGlide`/`ScenarioSheetTable` instances ("Medios" / "Variables
  estructurales"), both writing into the same shared `adjustments` state.
  `handleGridMultipliersChange` merges each grid's (partial, subset-only) callback payload onto the
  full current multipliers/absolute maps by variable name rather than rebuilding `adjustments` from
  the partial payload directly — otherwise every variable in the *other* section would silently
  reset to its default multiplier on every edit.
- **Visible "fill right" (Fase 5, A07-R6)**: a real button per row (Glide: one toolbar button
  operating on the currently-selected row; Table: one button per row) copies period 1's value
  across the rest of the horizon for that row. Found and fixed during QA: the first implementation
  called the single-cell write helper once per period in a loop, and since each call replaces the
  caller's `adjustments` state wholesale (not a functional update), only the *last* period's write
  actually survived — every earlier one in the same click was silently discarded. Fixed by batching
  all of a row's period writes into one `onMultipliersChange` call (`writeRawBatch` in
  `ScenarioSheetTable.tsx`; `ScenarioSheetGlide.tsx`'s already-correct paste-handling pattern,
  `applyAbsoluteChanges(updates[])`, was reused rather than re-derived).
- **Duplicate scenario (Fase 5, A10-R5)**: `POST /predict/scenarios/{id}/duplicate` copies the definition (adjustments + cached summary) under a new id and a `"{name} - copy"`/`"{name} - copy (2)"` unique name (`_generate_unique_scenario_name`, same collision-suffix pattern as `routers/models.py::_generate_unique_name`), subject to the same 5-per-model cap as a manual save. The copy never inherits `is_featured` — it always starts `false`.
- **Featured scenarios (Fase 5, P6/D4)**: `Scenario.is_featured: bool`, settable via `PATCH /predict/scenarios/{id}` with `{ is_featured: bool }` (mixable with a normal name/adjustments update in the same call). Capped at 3 featured per model (`_ensure_featured_capacity`, independent of and on top of the 5-scenario total cap) — a 4th attempt 400s with `{code: "FEATURED_LIMIT_REACHED", limit: 3}`. Exists specifically so `visualizador` (who never opens Predict) can see a curated set from Resumen Ejecutivo — not consumed there yet (Fase 6 item).
- Time series + exports: `GET /predict/scenarios/{id}/timeseries` provides per-period `{ y_pred, by_group, by_subgroup }`. Import a CSV plan via `POST /predict/scenarios/{id}/import` (columns: period, variable, mode, value) and export CSV/XLSX with `GET /predict/scenarios/{id}/export?format=csv|xlsx`.
- **Calendar-aware defaults (Fase 3, narrowed to opt-in in Fase 8/T6)**: every unadjusted future period
  defaults from `_calendar_bucketed_means`: the historical mean of that variable **at the same calendar
  position** — month-of-year for `freq=month`, ISO week for `freq=week`, `(month, day)` for `freq=day` — falling
  back to the flat mean when a future period's bucket has no historical rows (e.g. a horizon that outruns a
  year of history), or when the variable isn't flagged seasonal at all (see below). Both `_compute_plan` (backs
  preview/create/update/timeseries) and `_scenario_matrix` (backs the assumptions export) resolve
  `resolve_seasonal_flags` for the model's `X.columns` before calling `_calendar_bucketed_means`, so only
  `Group`/`Subgroup.is_seasonal=true` variables get calendar-bucketed — everything else uses the flat mean.
  Fase 3 originally applied this to every variable unconditionally (no such flag existed yet); Fase 8 made it
  explicit (D3) since blindly calendar-bucketing every control variable was itself judged a defect, not a
  feature. `/predict/{model_id}/simulate` (the flat, non-period multiplier preview used by
  `_compute_contributions`) is intentionally untouched — it has no period/calendar concept to be seasonal about.
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
  per-channel suggested spend, and "Aplicar al escenario" which writes `{mode: "value", value}`
  into every period of the active horizon for each channel's `proxy_variable` (same `PeriodValue`
  shape the grid already writes) — no new scenario-update endpoint. `value` is
  `suggested_spend / periodCount / dollar_rate`, not `suggested_spend` directly: `suggested_spend`
  is a dollar figure for the whole horizon, while a scenario's raw variable value is per-period and
  in the variable's native units, so it's divided by the period count first (else the horizon total
  would be `periodCount × budget`) and by `dollar_rate` second (else it isn't in the variable's
  native units at all). New Investment/Revenue/ROI/ROAS KPI cards render above the toggle when
  `preview.economics` is present.
- **Bidirectional grid ↔ optimizer + media mix (Fase 5, P4/P7)**: `PlannerView` previously always
  started from a blank budget and never knew what the grid already had allocated. `predict/page.tsx`
  now computes `currentMediaAllocations` — for each media variable, the steady-state $ total implied
  by the grid's OWN current state across the whole horizon (same unit as `suggested_spend`) — and
  passes it down as a new `currentAllocations` prop. `PlannerView` precharges its budget input from
  this exactly once (never overwrites a budget the user already typed), shows a "current grid
  state" summary before the first optimize call, and a "Current: $X" line per channel once results
  exist, alongside the existing suggested-spend input. A new `MediaMixComparison` (plain
  proportional div bars, not a new chart dependency — this is a simple 2-series % comparison, not
  worth pulling in recharts for) renders Base (current grid) vs. Optimized (this suggestion, live —
  reflects in-panel edits to `suggested_spend`) once both a result and a nonzero current total
  exist.
- **Undo/redo, unsaved-changes guard, multi-frequency view, two-tier KPIs (Fase 5, A07-R3/A04-R6/P3/A08-R2)**:
  - *Undo/redo*: a local, in-memory snapshot stack over `adjustments` (capped at 50 entries), Ctrl+Z/Ctrl+Shift+Z/Ctrl+Y
    plus visible toolbar buttons. Reset on model change (a different model's variable set makes old
    entries meaningless) and re-seeded (not appended to) on scenario load.
  - *Unsaved-changes guard*: `lib/store.ts` gained a generic, NOT persisted `unsavedChangesActive`
    flag any page can opt into (default `false` — a no-op everywhere else). Predict sets it whenever
    `adjustments` differs from the last saved scenario (or, for a fresh unsaved scenario, from the
    all-multiplier-1 default) via an order-independent comparison key (`stableAdjustmentsKey` — a
    raw `JSON.stringify` would false-positive whenever the backend's object key order differs from
    the frontend's own, which happens on every save/load round-trip). `CompanySwitcher` and
    `Sidebar`'s nav links both check this flag before navigating and show a shared confirm `Modal`
    (`common.unsavedChangesTitle/Body/Confirm`) if it's set; a `beforeunload` listener covers
    browser close/refresh/back.
  - *Frequency conversion (revised after user feedback — the first cut was a redundant read-only
    view next to a table that already existed)*: changing the `freq` `Select` in "Parámetros del
    escenario" now converts the scenario itself instead of offering a separate view. `horizon`
    follows a calendar-based ratio (`FREQ_DAY_LENGTH`: "52 weeks = 12 months", not a strict
    day-count year, so conversions land on the round numbers a business user expects — 12
    months→52 weeks, 4 weeks→1 month) via `convertHorizon`. Every variable's grid values are
    re-gridded onto the new period count via `regridSeries` — a single proportional-overlap
    algorithm on a normalized `[0,1]` timeline that handles both directions with the same math and
    preserves the total exactly: aggregating (coarser target) collapses to an exact sum,
    disaggregating (finer target) assumes activity is spread evenly within each old period, an
    estimate always surfaced via a toast (adstock/Hill are non-linear, so this is not a model
    refit at the new grain). Every reprojected cell becomes an explicit absolute override
    (`mode: "value"`) rather than trying to preserve multiplier semantics, which are tied to the
    old frequency's calendar bucketing and wouldn't carry meaning at the new one.
  - *Two-tier KPIs*: `kpiItems`/`economicsKpiItems` split into a primary tier (total, average,
    ROI, ROAS — always visible) and a secondary tier (baseline, group slices, other, investment,
    revenue) inside a `Disclosure`, open by default for `modelador`/`admin_compania` and closed for
    `visualizador`.
- **Visual redesign (Fase 7.7, frontend-only)**: Planner is now the default `viewMode` (was
  "Vista avanzada") per the Direction C thesis — the raw grid is opt-in, not the landing state.
  The grid itself (`ScenarioSheetGlide.tsx`, `@glideapps/glide-data-grid`, canvas-based) now gets a
  dark-mode `theme` prop (previously always light regardless of app theme) and renders only at
  `lg`+ (≥1024px, via `hooks/useMediaQuery.ts`); below that, a new `ScenarioSheetTable.tsx` renders
  the same `variables × periods` grid as a real `<table>` with one labeled `<input>` per cell —
  same `onMultipliersChange` contract, interchangeable with the Glide grid — since a canvas grid is
  invisible to screen readers and awkward on touch. The "Projected totals" chart gained a shaded
  delta band between Base Scenario and Scenario (two stacked, transparent-then-tinted `Area`s under
  the two `Line`s) plus a `{value}% vs Base Scenario` badge, computed client-side from
  `preview.total` vs. the sum of the flat-baseline `heroSeries` — no new backend field. KPI tiles,
  the two `window.confirm()` calls (reset-to-base, delete-scenario), and page strings were migrated
  to the same primitives/i18n/`useStableCategoricalColor` pattern as Analysis/Modeling (Fase
  7.5/7.6) — see `docs/DIRECCION-VISUAL.md` and `BITACORA.md`.

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
  `admin_compania` `Membership` in one call (`{name, admin_user_id, currency_code?}` → `CompanyOut`, `currency_code`
  defaults to `"MXN"` if omitted). `GET /admin/companies` lists all companies. `PATCH /admin/companies/{id}`
  (`{name, currency_code?}`) updates the name and, when provided, the currency — this is the only place a
  company's currency can be changed (Fase 7.9: added `Company.currency_code`, ISO 4217, e.g. `"MXN"`/`"USD"`, so
  monetary figures across the app — investment/revenue totals in Analysis/Predict/Planner — can render with
  `Intl.NumberFormat({style: "currency"})` instead of a bare number). `DELETE /admin/companies/{id}` only
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
  `useGlobalStore` (`isPlatformAdmin: boolean`); `useIsPlatformAdmin()` (`hooks/useCanEdit.ts`) reads it. Each
  `MyMembershipOut` row also carries `currency_code` (the membership's company currency) so the frontend can
  read the active company's currency from the store without an extra request — see `useActiveCurrency()`
  (`hooks/useActiveCompany.ts`).
- **UI**: `/admin` (inside the `(app)` route group, so it keeps `Header`/nav). Visible in the Header only when
  `useIsPlatformAdmin()` or `useCanManageUsers()` (existing `admin_compania` check) is true. Platform admins see
  a "Companies" panel (create/rename/delete, backed by the email-lookup for `admin_user_id`); company admins see
  a "Members" panel scoped to their `activeCompanyId` (add by email, change role, remove). The backend 403s
  independently of this UI gating, per the multi-tenancy convention in `CLAUDE.md`.

## Resumen Ejecutivo (Fase 6)

Not one of the 5 pipeline modules — a condensed top-level view for the "decision maker" persona
(see `BITACORA.md` Fase 6), self-contained the same way `/analysis`/`/predict` are (its own
dataset/model selectors, not the global store's `datasetId`/`modelId`).

- **UI**: `/executive-summary` (inside the `(app)` route group), linked from the Sidebar for every
  role (this is a consumption mode, not a permission). Redesigned in Fase 7.4 (Direction C — see
  `docs/DIRECCION-VISUAL.md`): KPI `StatCard`s with qualitative badges, a date-range filter, a
  "Contribución por grupo" bar chart (stable per-group color, direct % labels, baseline included as
  a neutral bar), and a client-side print report (`.no-print`/`.print-only`, same pattern as
  `/analysis`).
- **No new read endpoints**: KPIs (`fit R²`/`adj. R²` from `GET /datasets/{id}/models-with-roles`,
  total contribution + per-group contribution from `GET /analysis/{model_id}/summary`, ROI/ROAS
  totals from `GET /economics/{model_id}/summary`) reuse exactly the calls `/analysis` already
  makes, now also passing `start_date`/`end_date` for the page's own date-range filter — no
  aggregation endpoint was added for this page.
- **No "Presupuesto inverso" here** (removed in Fase 7.4): it duplicated the budget optimizer
  already available in Predict's Planner mode (see Module 5) with no `onApply`/scenario flow to
  attach it to on this page, so it added a redundant control rather than a distinct capability.
  `PlannerView` (`components/predict/PlannerView.tsx`) is Predict-only now.
- **Excel export (Fase 7.9, extended in the 8-phase plan's Fase 6 — Narrativa ejecutiva, not to be
  confused with this module's own origin phase in the parenthetical above)**:
  `GET /analysis/{model_id}/executive-summary/export?start_date=&end_date=&lang=es|en` returns an
  `.xlsx` (via the shared `utils/excel.py::excel_response`) with three sheets — `KPIs` (fit R², total
  contribution, and — only when the dataset's economic layer is configured — total investment/revenue/ROI/ROAS),
  `Groups` (per-group contribution + % of total, same rows as the bar chart), and a 3rd "Cómo leer
  esto"/"How to read this" sheet (fixed explanatory bullets + the same non-causality note shown on
  the page). `lang` picks `routers/analysis.py::_EXECUTIVE_SUMMARY_LABELS` — a small self-contained
  `{es, en}` dict for the sheet headers, deliberately not bridged to the frontend's i18n JSON (only
  ~15 strings; building shared-string infra for that would be disproportionate). Reuses `summary()`'s
  and `economics.py::economics_summary()`'s already-cached numbers rather than recomputing them
  (lazy-imports `economics_summary` inside the endpoint body to avoid a circular import, since
  `economics.py` imports from `analysis.py` at module load time). The existing print button
  (`window.print()` + `.no-print`/`.print-only`) remains the PDF path — this only adds the Excel one.
- **Featured scenarios (Fase 6 — Narrativa ejecutiva)**: a "Escenarios destacados" card lists the
  model's up-to-3 `Scenario.is_featured` scenarios (see Module 5), filtered client-side from the
  existing `GET /predict/scenarios?model_id=` — no new backend endpoint. Shows name, investment,
  revenue, ROI, and incremental vs. BAU (`ScenarioOut.delta_pct_vs_base`), all already computed per
  scenario. Empty state links to `/predict`. This surfaced a real pre-existing bug (see BITACORA):
  `_load_summary` (`routers/predict.py`) dropped `economics`/`variable_baselines` when
  reconstructing a scenario from its cached `results_json`, so every scenario read from cache
  showed blank investment/revenue/ROI regardless of freshness. Fixed by reconstructing both fields
  from the cached payload, plus a self-healing check in `_scenario_out_from_record`: a cached
  summary with `economics: null` is only trusted as "genuinely not configured" if the dataset has
  zero investment channels — otherwise it's treated as stale and recomputed (and persisted back),
  so already-affected scenarios repair themselves on next read without a manual fix.
- **Insight sentence, non-causality note, actionable/non-actionable waterfall split**: see Module 4's
  Fase 6 bullets — shared components/helpers (`lib/insight-text.ts`, `WaterfallChart`'s `actionable`
  segment flag) also used on `/analysis`, described there rather than duplicated here. Executive
  Summary additionally shows an "X% of total contribution is actionable" callout and a warning banner
  for any actionable group with negative contribution.