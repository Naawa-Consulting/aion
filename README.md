# Aion

Aion es una aplicación de analítica para Marketing Mix Modeling (MMM): permite subir datasets,
transformar y categorizar variables, ajustar modelos de regresión, analizar contribución/atribución
en el tiempo y construir escenarios de forecasting.

## Estado actual

Resumen por módulo (detalle técnico completo — endpoints y contratos — en `docs/README.md`):

1. **Datasets** — funcional. Carga, versionado, checksum anti-duplicados, muestra de trabajo
   (sample size), configuración de variable temporal.
2. **Transform** — funcional. Categorización en Grupo/Subgrupo, variables derivadas, historial y
   undo.
3. **Modeling** — funcional. Correlaciones, modelos OLS, roles hero/challenger, selección
   stepwise, métricas (R², VIF, Durbin–Watson, MAE, RMSE, MAPE). Variables de medios (marcadas por
   Group/Subgroup en Transform) reciben adstock + saturación Hill automáticos vía grid-search al
   ajustar el modelo, aplicados de forma consistente en Modeling/Analysis/Predict.
4. **Analysis** — funcional. Contribución/atribución por variable y por grupo/subgrupo, series
   apiladas por periodo, export a Excel. Capa económica: catálogo de canales de inversión
   (por-dataset, configurado en `/transform`) + tasa de conversión/valor promedio por modelo
   (`/modeling`) alimentan una vista de Economía/ROI en `/analysis` (cards, tabla por canal,
   serie de tiempo inversión vs. ingreso, curva de saturación en $). Waterfall distingue grupos
   accionables de estacionalidad/tendencia; comparación lado a lado de 2 modelos (contribución/ROI).
5. **Predict** — funcional (MVP). Escenarios time-phased, comparación, import/export CSV/XLSX.
   Modo Planner (toggle junto a la grilla): optimizador de presupuesto (steady-state, un solo
   objetivo v1 — maximizar retorno dado un presupuesto) + KPIs de ROI/ROAS sobre el escenario
   proyectado.
6. **Resumen Ejecutivo** (`/executive-summary`) — vista de nivel superior para decisiones rápidas:
   KPIs agregados (contribución, fit del modelo, ROI/ROAS) reusando lo ya calculado en Analysis,
   tabla de hasta 3 escenarios destacados (marcados en Predict), nota de no-causalidad, y export a
   Excel bilingüe (ES/EN) con hoja "cómo leer esto".
7. **Configuración** (paleta de color, usuarios) — usuarios ya cubierto por auth multi-company
   (ver abajo); paleta de color pendiente.
8. **Perfil** (password) — cubierto por Supabase Auth (`/reset-password`).

**Auth + multi-company** — desplegado y en uso: login con Supabase Auth, compañías con membresía
por usuario (rol `modelador`/`visualizador`/`admin_compania`), aislamiento de datos por compañía en
los 5 módulos + Resumen Ejecutivo + Admin. `platform_admin` (allowlist de email) puede crear
compañías nuevas sin ver los datos de ninguna.

Decisiones recientes y pendientes abiertos: ver `BITACORA.md`.

## UI

Rediseño visual completo (Fase 7, cerrada 2026-08-12 — 11 sub-fases, detalle en `BITACORA.md` bajo
"Rediseño UI/UX"): shell con `Sidebar` colapsable (pipeline numerado 1-5 + Resumen
Ejecutivo/Admin separados, drawer en móvil) y `TopBar` (compañía activa, idioma `ES`/`EN`, tema
claro/oscuro, menú de usuario) según la especificación de `docs/DIRECCION-VISUAL.md` (Dirección C
— "Panel"). i18n real español/inglés (`next-intl`, preferencia en `localStorage`, sin prefijo de
ruta) en las 5 páginas de producto + Resumen Ejecutivo + Admin + Login. Primitivas compartidas en
`components/ui/` (button, card, select, modal, tabs, disclosure, skeleton, empty-state, table,
tooltip, etc.), tokens de color/tipografía/radio/altura de la Dirección C, paleta de gráficas
compartida y estable (`lib/chart-colors.ts`), `prefers-reduced-motion` respetado, responsive
verificado a 1440/1024/390.

Pasada de accesibilidad y densidad (Fase 8/Fase 7, 2026-08-19 — detalle en `BITACORA.md`): diálogos
(`Modal`, drawer móvil) con foco atrapado y devuelto al cerrar, `accessibilityLayer` en las 11
gráficas de recharts, `MotionConfig` respetando `prefers-reduced-motion` también para Framer Motion,
skip link, tabla accesible de Predict pedible manualmente en escritorio, explicación visible (no
`title` nativo) en controles deshabilitados por rol, KPIs en 2 columnas desde móvil, y aislar una
serie de una gráfica con clic en su leyenda.

## Estructura del repo

- `frontend/` — Next.js 14 App Router UI
- `backend/` — FastAPI + SQLite (metadata) + Parquet (datos)
- `data/` — almacenamiento local de datasets (ignorado por git)
- `modules/` — placeholders para lógica de dominio compartida entre módulos (aún vacío)
- `docs/README.md` — especificación técnica por módulo (endpoints, contratos request/response)

## Desarrollo local

### Backend

```powershell
python -m venv .venv; . .venv/Scripts/Activate.ps1
pip install -r backend/requirements.txt
uvicorn app.main:app --reload --port 8000 --app-dir backend
```

Variables de entorno opcionales en `backend/.env` (ver `backend/.env.example`):
`AION_DATABASE_URL`, `AION_DATA_ROOT` (default `../data` relativo a `backend/`).

### Frontend

```bash
cd frontend
npm install
npm run dev   # http://localhost:3000
```

Requiere `frontend/.env.local` con `NEXT_PUBLIC_API_URL=http://localhost:8000`.

## Despliegue

- Frontend: Vercel, configurando `NEXT_PUBLIC_API_URL` hacia el backend.
- Backend: Railway/Render/Fly. En producción usar Postgres y almacenamiento S3-compatible para
  los datos si se requiere.

## Documentación del proyecto

Este proyecto usa 4 documentos base para dar continuidad entre sesiones de trabajo (reglas
completas de uso en `CLAUDE.md`):

- **`README.md`** (este archivo) — qué es el proyecto y estado actual.
- **`INDEX.md`** — mapa de carpetas y archivos clave.
- **`BITACORA.md`** — historial de decisiones, pendientes y archivos generados (más reciente
  arriba).
- **`CLAUDE.md`** — arquitectura técnica y reglas operativas para trabajar con Claude Code en
  este repo.
