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
- `app/errors.py` — `api_error()` (Fase 7.9): construye `HTTPException`s con `detail={code,
  message, ...extra}` en vez de texto plano, para los ~35 errores 4xx visibles al usuario final
  (habilita `lib/error-messages.ts::translateApiError()` en el frontend).
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
- `src/app/(app)/` — route group con los 5 módulos de producto + `layout.tsx` propio (monta
  `AuthBootstrap` + `components/AppShell.tsx`); el paréntesis no afecta las URLs (`/datasets`
  sigue siendo `/datasets`).
  - `datasets/page.tsx` — UI Módulo 1. `transform/page.tsx` — Módulo 2. `modeling/page.tsx` —
    Módulo 3. `analysis/page.tsx` — Módulo 4. `predict/page.tsx` — Módulo 5.
  - `executive-summary/page.tsx` — "Resumen Ejecutivo" (Fase 6): vista de nivel superior
    autocontenida (selectores propios, no el store global), reusa las llamadas de `/analysis` +
    el optimizador de presupuesto compartido con el modo Planner de Predict.
  - `admin/page.tsx` — panel "Compañías" (platform admin) + panel "Miembros" (`admin_compania`
    de la compañía activa).
  - `upload/page.tsx` — pantalla legacy de upload, reemplazada por `/datasets` (candidata a
    limpieza).
- `src/app/login/page.tsx`, `src/app/auth/callback/route.ts`, `src/app/reset-password/page.tsx`
  — fuera del route group `(app)`, para que no hereden el shell de producto.
- `src/app/layout.tsx` — layout raíz: `ThemeProvider` + `LocaleProvider` + `Toaster` (sin shell,
  eso vive en `(app)/layout.tsx`).
- `src/components/AppShell.tsx` — chrome de producto (Fase 7.3, Dirección C "Panel" —
  `docs/DIRECCION-VISUAL.md`): resuelve `usePipelineContext()` una sola vez y lo pasa a
  `Sidebar.tsx` (colapsable, pipeline numerado 1-5 + indicadores de paso incompleto, separador +
  Resumen Ejecutivo/Admin, drawer en móvil) y a `TopBar.tsx` (hamburguesa en móvil,
  `CompanySwitcher`, toggle de idioma `ES`/`EN`, toggle de tema, `UserMenu`).
- `src/hooks/usePipelineContext.ts` — resuelve `hasDataset`/`hasTimeVariable`/`hasHeroModel` a
  partir de `GET /datasets` + `GET /datasets/{id}/models-with-roles`, para los indicadores de
  paso incompleto del Sidebar (una sola resolución en `AppShell`, no una por página).
- `src/lib/supabase/{client,server,middleware}.ts` — clientes de Supabase Auth (browser/server/
  helper de middleware).
- `src/lib/api.ts` — `apiFetch`/`ApiError`/`getAuthHeaders`: cliente HTTP compartido hacia el
  backend, agrega `Authorization`+`X-Company-Id` a cada request. Todas las páginas de producto
  pasan por aquí — no volver a declarar `fetch` directo a `${API_URL}`.
- `src/lib/store.ts` — store Zustand: selección global (`datasetId`, `modelId`) + sesión
  (`userId`/`userEmail`/`memberships`/`isPlatformAdmin`/`membershipsLoading`/`activeCompanyId`;
  solo `activeCompanyId` se persiste — el resto se re-resuelve en cada carga vía
  `AuthBootstrap`/`/me/memberships`, `membershipsLoading` evita que páginas gateadas por rol
  (`/admin`) decidan "sin permisos" antes de que esa resolución termine).
- `src/lib/roles.ts` — labels/badge-variant por rol.
- `src/lib/error-messages.ts` — `translateApiError()`: traduce `ApiError.code` (Fase 7.9) al
  namespace i18n `errors`, con fallback al `message` crudo del backend.
- `src/hooks/useCanEdit.ts` — `useCanEdit()`/`useActiveRole()`/`useIsPlatformAdmin()`/
  `useCanManageUsers()`: gating de UI por rol de la compañía activa / platform admin.
- `src/hooks/useActiveCompany.ts` — `useActiveCurrency()`: moneda (`Company.currency_code`,
  Fase 7.9) de la compañía activa, para formateo de montos.
- `src/hooks/useMediaQuery.ts` — breakpoint helper (Fase 7.7), decide el fallback accesible de
  Predict (`ScenarioSheetTable` bajo `lg`, `ScenarioSheetGlide` en `lg`+).
- `src/components/company-switcher.tsx`, `src/components/user-menu.tsx` — selector de compañía y
  menú de usuario en el header (usan `src/components/ui/dropdown.tsx`).
- `src/components/providers/auth-bootstrap.tsx` — hidrata sesión + memberships al montar
  `(app)/layout.tsx`.
- `src/components/providers/locale-provider.tsx` — `LocaleProvider`/`useLocaleToggle()`: locale
  `es`/`en` en `localStorage` (`aion-locale`, sin prefijo de ruta), envuelve `NextIntlClientProvider`
  — mismo patrón que `next-themes`.
- `src/components/ui/` — primitivos compartidos (Dirección C, Fase 7.2+): `button`, `card`,
  `badge`, `modal`, `input`, `select`, `filter-bar`, `progress`, `dropdown`, `toggle-chip`,
  `error-text`, `eyebrow`, `icon-button`, `skeleton`, `empty-state`, `page-header`, `stat-card`,
  `table`, `row-actions`, `tooltip`, `tabs` (Fase 7.5), `disclosure` (Fase 7.5, Resumen/Detalle).
  Preferir reusar estos antes de crear uno nuevo.
- `src/components/modeling/SelectedPredictorsQuickView.tsx` — resumen de predictores
  seleccionados en Modeling.
- `src/components/transform/investment-channels.tsx` — tarjeta CRUD de canales de inversión
  (capa económica), renderizada dentro de `/transform`.
- `src/components/predict/ScenarioSheetGlide.tsx` — grilla editable de escenarios sobre
  `@glideapps/glide-data-grid` (canvas), única librería de grid en el proyecto desde Fase 0
  (`ScenarioGrid.tsx`/`react-data-grid` ya no existen). Usada solo en "Vista avanzada" y solo
  en pantallas `lg`+ (≥1024px) — un canvas es invisible para lectores de pantalla y poco usable
  al tacto (Fase 7.7). `hooks/useMediaQuery.ts` decide el corte de breakpoint en `predict/page.tsx`.
- `src/components/predict/ScenarioSheetTable.tsx` (Fase 7.7) — equivalente accesible en DOM real
  (tabla + `<input>` por celda) de la grilla anterior, renderizado por debajo de `lg`. Mismo
  contrato `onMultipliersChange` que `ScenarioSheetGlide`, intercambiables desde `predict/page.tsx`.
- `src/components/predict/PlannerView.tsx` (Fase 6) — input de presupuesto + optimizador +
  asignación editable por canal; modo por defecto en `/predict` desde Fase 7.7 (antes era
  "Vista avanzada" la que abría por defecto — ver `BITACORA.md`).
- `src/lib/format.ts` — formateo de números/fechas.
- `src/lib/i18n/messages/{en,es}.json` — diccionarios `next-intl` (Fase 7.2+), una clave de
  namespace por página/módulo (`modeling`, `analysis`, `predict`, `planner`, ...); preferencia de
  idioma en `localStorage` (`aion-locale`), sin prefijo de ruta.
- `next.config.mjs` — type-check activo (`ignoreBuildErrors` eliminado en la Fase 7.0; ver
  "Descubierto durante la implementación de fase 1" en `BITACORA.md` para la causa raíz de los
  errores preexistentes que bloqueaban reactivarlo).
- `package.json` — scripts y dependencias (recharts, zustand, sonner, react-dropzone, data grids,
  `@supabase/supabase-js`, `@supabase/ssr`).

## `data/`

- Almacenamiento local de datasets en Parquet, versionado por dataset (`{dataset_id}/v{n}.parquet`).
  Ignorado por git.

## `modules/`

- Placeholder para lógica de dominio compartida entre módulos (data/transform/modeling/analysis/
  predict) — vacío por ahora, no contiene código activo.
