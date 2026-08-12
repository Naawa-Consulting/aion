# Índice del repositorio

Mapa de carpetas y archivos clave — no es un listado exhaustivo archivo-por-archivo (los
archivos de build/caché/generados se omiten a propósito porque cambian constantemente y no
aportan contexto). Convenciones y arquitectura conceptual completas en `CLAUDE.md`.

## Raíz

- `README.md` — descripción del proyecto y estado actual.
- `INDEX.md` — este archivo.
- `BITACORA.md` — historial de decisiones, pendientes y archivos generados.
- `CLAUDE.md` — arquitectura técnica y reglas operativas para Claude Code.
- `docs/README.md` — especificación técnica por módulo (endpoints/contratos).
- `docs/DIRECCION-VISUAL.md` — especificación de diseño (Fase 7.1): tesis, paleta verificada contra
  WCAG, escalas de tipografía/espaciado/radio/alturas y reglas de gráfica. Fuente de verdad para la
  UI a partir de la Fase 7.2.

## `backend/` (FastAPI)

- `app/main.py` — arma la app FastAPI, monta los routers de cada módulo + `admin`/`me`, CORS
  desde `AION_ALLOWED_ORIGINS`, dependencia global `get_current_membership` en las rutas de
  datos.
- `app/config.py` — `Settings` (Postgres/Supabase/CORS/platform-admins vía env vars).
- `app/db.py` — engine SQLAlchemy (Postgres en prod, SQLite de fallback local). Las migraciones
  reales viven en `alembic/`, no aquí.
- `app/auth.py` — verificación de JWT de Supabase, `get_current_membership`/
  `require_write_access`/`require_platform_admin`/`require_company_admin`.
- `app/tenancy.py` — `get_scoped()`: helper de `session.get` + guard de `company_id` (404 si es
  de otra compañía), usado en todos los routers.
- `app/models.py` — tablas SQLModel: `Company`, `Membership`, `Dataset`, `Variable`, `Group`,
  `Subgroup`, `VariableHistory`, `Model`, `ModelMetrics`, `ModelTransform`, `InvestmentChannel`,
  `Scenario` — todas (salvo Company/Membership) con `company_id`. `Group`/`Subgroup` tienen
  `apply_media_transform` (marca variables de medios); `ModelTransform` guarda los parámetros de
  adstock+Hill fit por `(modelo, variable)`; `Model.conversion_rate`/`avg_value` alimentan la capa
  económica; `InvestmentChannel` es un catálogo por-dataset (gasto real en $, desacoplado de qué
  variable entró al modelo — ver `app/services/economics.py`).
- `app/schemas.py` — modelos Pydantic de request/response usados por los routers.
- `app/routers/datasets.py` — Módulo 1: upload, versionado, sample size, variable temporal.
- `app/routers/variables.py` — Módulo 2: filtros, transformaciones, categorización,
  historial/undo.
- `app/routers/groups.py` — grupos/subgrupos de variables (catálogo por-compañía).
- `app/routers/models.py` — Módulo 3: correlaciones, CRUD de modelos OLS, roles
  hero/challenger, stepwise.
- `app/routers/analysis.py` — Módulo 4: contribución/atribución, series apiladas, exports Excel.
- `app/routers/predict.py` — Módulo 5: escenarios, preview, CRUD, series de tiempo,
  import/export.
- `app/routers/economics.py` — capa económica: CRUD de `InvestmentChannel` por dataset,
  `GET /economics/{model_id}/summary`/`.../stacked` (ROI/ROAS) + exports Excel,
  `POST /economics/{model_id}/optimize-budget` (optimizador de presupuesto, Fase 6).
- `app/routers/admin.py` — crear compañías (`platform_admin`), gestionar miembros
  (`admin_compania`).
- `app/routers/me.py` — `GET /me/memberships` (compañías + rol del usuario actual).
- `app/services/analysis.py` — cálculo de contribuciones + cache TTL en memoria (invalidar en
  cada mutación relevante de dataset/modelo).
- `app/services/media_transform.py` — funciones puras de adstock (decay geométrico) + saturación
  Hill, usadas tanto al ajustar modelos como al proyectar escenarios en Predict.
- `app/services/economics.py` — cálculo por canal de inversión/contribución/ingreso (dataset
  column / rate×metric / manual con proración por día), reutilizando `compute_contributions` de
  `services/analysis.py`; usado por `routers/economics.py`. `resolve_channel_dollar_rate`/
  `resolve_conversion_scalars` (Fase 6) resuelven valores escalares para proyecciones futuras
  (optimizador de presupuesto, economía proyectada de Predict).
- `app/services/budget_optimizer.py` — optimizador de presupuesto steady-state (Fase 6): reparte
  un monto constante por canal maximizando retorno/contribución proyectada vía
  `scipy.optimize`, reutilizando `adstock_geometric`/`hill_saturation` de `media_transform.py`.
  Usado por `routers/economics.py` (`/optimize-budget`).
- `app/services/model_fit.py` — `build_design_matrix()`: punto único que arma la matriz de diseño
  (variables de medios transformadas, control crudas) usado por `routers/models.py`,
  `routers/analysis.py` y `routers/predict.py`; incluye el grid-search por canal
  (`search_media_hparams`) y la resolución de qué variables son "de medios"
  (`resolve_media_flags`, vía Group/Subgroup).
- `app/utils/datasets.py` — `load_dataset_frame()`: lectura desde Supabase Storage + `sample_size`
  + parseo de columna temporal. Usar siempre esta función, no leer el storage directo.
- `app/utils/storage.py` — cliente mínimo de Supabase Storage vía `httpx` (`read_bytes`,
  `write_bytes`, `delete`, `move`, `stat`).
- `alembic/` — migraciones de esquema (reemplaza los `ALTER TABLE` manuales que existían antes).
- `Dockerfile`, `.dockerignore` — imagen para desplegar en Render (`alembic upgrade head &&
  uvicorn ...`).
- `requirements.txt` — dependencias Python.
- `data/` — `app.db` (SQLite, solo dev local) — ignorado por git.

## `frontend/` (Next.js 14, App Router)

- `middleware.ts` (raíz) — gate de sesión: redirige a `/login` si no hay usuario autenticado.
- `src/app/(app)/` — route group con los 5 módulos de producto + `layout.tsx` propio (Header +
  `AuthBootstrap`); el paréntesis no afecta las URLs (`/datasets` sigue siendo `/datasets`).
  - `datasets/page.tsx` — UI Módulo 1. `transform/page.tsx` — Módulo 2. `modeling/page.tsx` —
    Módulo 3. `analysis/page.tsx` — Módulo 4. `predict/page.tsx` — Módulo 5.
  - `executive-summary/page.tsx` — "Resumen Ejecutivo" (Fase 6): vista de nivel superior
    autocontenida (selectores propios, no el store global), reusa las llamadas de `/analysis` +
    el optimizador de presupuesto compartido con el modo Planner de Predict.
  - `upload/page.tsx` — pantalla legacy de upload, reemplazada por `/datasets` (candidata a
    limpieza).
- `src/app/login/page.tsx`, `src/app/auth/callback/route.ts`, `src/app/reset-password/page.tsx`
  — fuera del route group `(app)`, para que no hereden el header/nav de producto.
- `src/app/layout.tsx` — layout raíz: solo `ThemeProvider` + `Toaster` (sin Header, eso vive en
  `(app)/layout.tsx`).
- `src/lib/supabase/{client,server,middleware}.ts` — clientes de Supabase Auth (browser/server/
  helper de middleware).
- `src/lib/api.ts` — `apiFetch`/`ApiError`/`getAuthHeaders`: cliente HTTP compartido hacia el
  backend, agrega `Authorization`+`X-Company-Id` a cada request. Todas las páginas de producto
  pasan por aquí — no volver a declarar `fetch` directo a `${API_URL}`.
- `src/lib/store.ts` — store Zustand: selección global (`datasetId`, `modelId`) + sesión
  (`userId`/`userEmail`/`memberships`/`activeCompanyId`, persistido).
- `src/lib/roles.ts` — labels/badge-variant por rol.
- `src/hooks/useCanEdit.ts` — `useCanEdit()`/`useActiveRole()`: gating de UI por rol de la
  compañía activa.
- `src/components/company-switcher.tsx`, `src/components/user-menu.tsx` — selector de compañía y
  menú de usuario en el header (usan `src/components/ui/dropdown.tsx`, primitivo nuevo).
- `src/components/providers/auth-bootstrap.tsx` — hidrata sesión + memberships al montar
  `(app)/layout.tsx`.
- `src/components/ui/` — primitivos compartidos: `button`, `card`, `badge`, `modal`, `input`,
  `filter-bar`, `progress`, `dropdown`. Preferir reusar estos antes de crear uno nuevo.
- `src/components/modeling/SelectedPredictorsQuickView.tsx` — resumen de predictores
  seleccionados en Modeling.
- `src/components/transform/investment-channels.tsx` — tarjeta CRUD de canales de inversión
  (capa económica), renderizada dentro de `/transform`.
- `src/components/analysis/economics-section.tsx` — vista de Economía/ROI (cards, tabla por
  canal, serie de tiempo), renderizada dentro de `/analysis` vía el toggle
  Contribución/Economía.
- `src/components/predict/ScenarioGrid.tsx` y `ScenarioSheetGlide.tsx` — dos implementaciones de
  la grilla editable de escenarios (`react-data-grid` vs. `@glideapps/glide-data-grid`) —
  revisar cuál usa cada vista antes de asumir que aplica a ambas.
- `src/components/predict/PlannerView.tsx` (Fase 6) — input de presupuesto + optimizador +
  asignación editable por canal; renderizado dentro de `/predict` (modo Planner, con
  `onApply` para escribir la asignación en el escenario) y dentro de `/executive-summary`
  (sin `onApply`, solo lectura de la asignación sugerida).
- `src/lib/format.ts` — formateo de números/fechas.
- `src/lib/i18n.ts` — diccionario de traducción (incipiente, solo unas pocas claves hoy).
- `next.config.mjs` — `typescript.ignoreBuildErrors: true` (tapón temporal, ver pendiente de
  limpieza de tipos en `BITACORA.md`).
- `package.json` — scripts y dependencias (recharts, zustand, sonner, react-dropzone, data grids,
  `@supabase/supabase-js`, `@supabase/ssr`).

## `data/`

- Almacenamiento local de datasets en Parquet, versionado por dataset (`{dataset_id}/v{n}.parquet`).
  Ignorado por git.

## `modules/`

- Placeholder para lógica de dominio compartida entre módulos (data/transform/modeling/analysis/
  predict) — vacío por ahora, no contiene código activo.
