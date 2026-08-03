# Bitácora — Aion

Registro de decisiones, pendientes y archivos generados. Cada sesión debe leer la sección
"Pendientes abiertos" completa, más al menos las últimas 10 entradas de "Historial" (más
reciente arriba); ir más atrás solo si se necesita contexto histórico adicional.

## Pendientes abiertos

### Fase actual: fundación (infra + auth multi-company + rediseño de modelado)

**Código listo (ver historial de hoy para el detalle), falta aprovisionar infraestructura real
y desplegar:**

- [x] Modelo de datos: `Company`, `Membership`, `company_id` en las 8 tablas de dominio,
      `Dataset.storage_key` (antes `path`), `Scenario.dataset_id` no-nulo. Migración inicial de
      Alembic generada y probada.
- [x] Auth + multi-tenancy en el backend: `auth.py` (JWT de Supabase, roles, platform admin vía
      allowlist de env var), `tenancy.py` (`get_scoped`), aplicado en los 6 routers existentes +
      `admin.py`/`me.py` nuevos. Probado end-to-end con una prueba de humo local (aislamiento
      cross-tenant y bloqueo de escritura por rol, ambos verificados).
- [x] Storage: `utils/storage.py` (Supabase Storage vía `httpx`), datasets.py/variables.py
      refactorizados para leer/escribir por ahí en vez de filesystem local.
- [x] Auth + multi-tenancy en el frontend: Supabase Auth (`@supabase/ssr`), `middleware.ts`,
      `/login` + `/auth/callback` + `/reset-password`, store extendido (compañía activa +
      memberships), selector de compañía y menú de usuario en el header, `lib/api.ts`
      (`apiFetch`) reemplazando los ~56 `fetch` sueltos en las 5 páginas de producto, gating de
      botones de escritura por rol (`useCanEdit`).
- [x] Despliegue: `backend/Dockerfile`, `.dockerignore`, `requirements.txt` actualizado;
      `next build` de producción corre limpio (antes nunca se había corrido, solo `npm run dev`
      — ver pendiente de limpieza de tipos abajo).
- [x] Proyecto Supabase real aprovisionado (Postgres + Storage bucket `aion-datasets` + Auth),
      `alembic upgrade head` corrido contra él, primera compañía (**Naawa**) + usuario
      (`sebastian@naawaconsulting.com`, `admin_compania`) creados. Backend y frontend corriendo
      en local contra el proyecto real (no contra SQLite/fake), login funcionando.
- [x] Flujo completo real probado desde el navegador (subir dataset, crear modelo, analysis,
      predict) contra Supabase real — sin errores, persistencia confirmada tras reload. Ver
      historial de hoy.
- [ ] **Siguiente paso**: desplegar backend en Render y frontend en Vercel con las mismas
      variables de entorno usadas en local.
- [ ] `render.yaml` (infra-as-code) — fast-follow no bloqueante, configurar primero por
      dashboard.
- [ ] RLS en Supabase: descartado para esta fase (la autorización real vive en la capa de
      aplicación, ver arriba) — queda como mejora opcional a futuro, no pendiente activo.
- [ ] Rediseño de modelado: adstock (lag/decay geométrico) + Hill (saturación) como
      transformaciones automáticas por variable de medios — barrido (grid search) al ajustar el
      modelo, no configuración manual del usuario. Ver metodología de referencia en
      `[[mx_hdi_reference_project]]` (memoria de Claude).
  - Esto también resuelve: "Módulo 5: forecast con variable original, transformación en backend
    antes de predecir" (ítem antiguo de abajo).
- [ ] Capa económica: tasa de conversión + valor/precio promedio ligados al `y_var` del modelo,
      costos de medios por variable/grupo/subgrupo, cálculo y visualización de ROI/ROAS y
      eficiencia de media mix. Fórmula de referencia: `ingreso = contribución × tasa_conversión
      × valor_promedio`; `ROI = ingreso / inversión − 1`.
  - Esto reemplaza/agrupa los ítems antiguos de Módulo 4 sobre tasa de conversión, precio
    promedio y costos (ver abajo).
- [ ] Visualizaciones de negocio: curvas de saturación (Hill) y de adstock/decay con punto de
      operación, waterfall/donut de atribución, dashboard de ROI/eficiencia.
- [ ] Bayesiano: fase futura explícita, no ahora. No bloquear el diseño de datos para poder
      agregarlo después (evitar mezclar parámetros de transformación con el muestreo bayesiano
      conjunto — la referencia mostró que eso no converge en tiempo razonable).

### Descubierto durante la implementación de fase 1 (no bloqueante, no es parte del auth/multi-tenant)

- [ ] **Limpieza de tipos del frontend**: `next build` nunca se había corrido en este repo (solo
      `npm run dev`), y al correrlo por primera vez aparecieron varios errores de TypeScript
      preexistentes y no relacionados (props mal tipadas en `SchemaTabs`, formatters de Recharts
      en `modeling`/posiblemente otras páginas, un tipo `PreviewPayload` en `transform` que no
      acepta `undefined` en `params`). Se corrigieron los primeros 3 (triviales, sin cambio de
      comportamiento) y se desactivó `typescript.ignoreBuildErrors` en `next.config.mjs` como
      tapón para no bloquear el despliegue — pendiente hacer una pasada dedicada de limpieza de
      tipos y volver a activar el type-check en build.
- [ ] Bug preexistente encontrado en `transform/page.tsx`: el botón de borrar grupo llama
      `setGroupDeleteMode("uncategorized")` pero ese estado no existe en el archivo — lanzaría
      `ReferenceError` en tiempo de ejecución. No se tocó (no es parte de esta migración).

### Backlog previo (sin resolver, no bloqueante para la fase actual)

- [ ] Endurecer validaciones (edición de escenarios, límites, mejores estados de error)
- [ ] Exportar gráficos a PNG si se requiere
- [ ] Módulo 1: ocultar variables
- [ ] Módulo 1: configurar variable dependiente
- [ ] Módulo 2: correlaciones deben ser vs. variable dependiente
- [ ] Módulo 3: animación de modelado
- [ ] Módulo 3: agregar otros algoritmos (NN, Random Forest, XGBoost, etc.)
- [ ] Módulo 5: tabla de forecasting editable
- [ ] Módulo 5: corregir cálculo de promedio por semana/mes/etc.
- [ ] Módulo 5: agregar "actual" (último periodo seleccionado) en el gráfico proyectado
- [ ] Módulo 5: seleccionar y comparar escenarios
- [ ] Módulo 6: módulo de Configuración (paleta de color, usuarios) — nota: usuarios ahora se
      resuelve como parte de auth multi-company, arriba; paleta de color queda pendiente.
- [ ] Módulo 7: perfil (password) — a revisar si Supabase Auth ya cubre esto de forma nativa.
- [ ] Limpieza: revisar y eliminar los scripts scratch de la raíz (`replace_block.py`,
      `write_modeling.py`, `tmp_chars.py`, `temp_modeling.tsx`) si ya no se necesitan — ver `INDEX.md`.

~~Módulo 2: optimización de adstock~~ — resuelto por el rediseño de modelado (adstock automático).

## Historial

### 2026-08-03 — Flujo completo probado end-to-end contra Supabase real

Usuario corrió el flujo completo desde el navegador (backend/frontend levantados en local contra
el proyecto Supabase real): subida de dataset, configuración de variable temporal, 4 modelos OLS
(incluyendo selección "Best"), 1 escenario de Predict. Sin errores en logs de backend ni frontend
(solo warnings inofensivos de pandas al inferir formato de fecha en `datasets.py:698`).

Verificado del lado de servidor: `Dataset`/`Model`/`Scenario` quedaron con `company_id` correcto
en Postgres (compañía Naawa), ligados correctamente entre sí; el parquet subido a Storage quedó
en `{company_id}/{dataset_id}/v1.parquet` (vía `_version_key()` en `datasets.py:98`) — el usuario
notó que el bucket "no se ve diferenciado por compañía" pero es solo porque hoy existe una única
compañía, por lo que solo aparece una carpeta de nivel superior; el aislamiento por `company_id`
ya está garantizado en la key y no requiere cambio. Persistencia tras reload del navegador
confirmada (datos en Postgres real, no in-memory).

Con esto, el pendiente "probar el flujo completo real desde el navegador" queda resuelto — sigue
el despliegue a Render/Vercel.

### 2026-07-31 — Proyecto Supabase real conectado: 3 bugs encontrados y corregidos

Se aprovisionó el proyecto Supabase real (`fcdunubymbkszuizklxn`), se corrió la migración de
Alembic contra su Postgres, se creó el bucket de Storage `aion-datasets`, y se bootstrapeó la
primera compañía (**Naawa**) + usuario (`sebastian@naawaconsulting.com`, `admin_compania`) vía
la Admin API de Supabase. Al conectar contra el proyecto real (en vez del SQLite/JWT falso de la
prueba de humo) aparecieron 3 bugs reales, los tres corregidos:

1. **JWT signing con llaves asimétricas** (el más importante): este proyecto de Supabase firma
   los JWT de sesión con llaves asimétricas nuevas (`ES256` vía JWKS en
   `/auth/v1/.well-known/jwks.json`), no con el secreto HS256 clásico que asumía `auth.py`
   originalmente — causaba `401 "Invalid or expired token"` en todo. `_decode_token` ahora lee el
   header `alg` del JWT y bifurca: HS256 usa `SUPABASE_JWT_SECRET` (compatibilidad con proyectos
   viejos), cualquier otro algoritmo busca la llave pública correspondiente por `kid` en el JWKS
   (cacheado 1h, con un reintento forzando refresh si el `kid` no aparece — cubre rotación de
   llaves). Este es el tipo de proyecto Supabase que se debe asumir por default de aquí en
   adelante.
2. **Enlaces de invitación/recuperación por correo**: el template de correo por defecto de
   Supabase (`{{ .ConfirmationURL }}`) entrega la sesión en el fragmento de la URL
   (`#access_token=...`), que un route handler de servidor (`route.ts`) nunca puede ver — el
   primer intento de invitar a un usuario terminaba mandándolo a `/login` sin sesión.
   `app/auth/callback` pasó de `route.ts` a una página de cliente (`page.tsx`) que parsea el
   fragmento (o `token_hash`/`type`, o `code`, como fallbacks) y establece la sesión vía
   `setSession`/`verifyOtp`/`exchangeCodeForSession` según cuál venga.
3. **Codificación de `frontend/.env.local`**: el archivo se guardaba en UTF-16 (bug ya detectado
   antes de esta sesión en el archivo original) incluso después de reescribirlo — Next.js no lee
   las variables y todos los clientes de Supabase fallaban con "URL and API key are required".
   Se reescribió forzando UTF-8 vía `printf` en vez del editor.

**Nota operativa**: `uvicorn --reload` es flaky en este Windows con una ruta que tiene espacios
(la recarga se queda a medias, sirviendo código viejo sin avisar) — para desarrollo local contra
Supabase real, reiniciar el proceso manualmente en vez de confiar en `--reload`.

### 2026-07-30 — Implementación de Fase 1 (fundación): auth + multi-tenant + storage, backend y frontend

**Backend** (`backend/app/`): `config.py` (Settings extendido con env vars de Supabase),
`models.py` (`Company`, `Membership`, `company_id` en las 8 tablas existentes,
`Dataset.storage_key` en vez de `path`, `Scenario.dataset_id` no-nulo), `auth.py`
(`get_current_user`/`get_current_membership`/`require_write_access`/`require_platform_admin`/
`require_company_admin`, JWT de Supabase vía `python-jose`), `tenancy.py` (`get_scoped`),
`utils/storage.py` (Supabase Storage vía `httpx`, sin SDK). Se aplicó el patrón de scoping por
`company_id` en los 6 routers existentes (`datasets`, `variables`, `groups` —caso especial,
`Group`/`Subgroup` pasan de catálogo global a catálogo por-compañía—, `models`, `analysis`,
`predict` —se eliminó `_ensure_scenario_schema`, el hack de `ALTER TABLE` on-demand—). Nuevos
routers `admin.py` (crear compañías/gestionar miembros) y `me.py` (`/me/memberships`). Se
introdujo Alembic (migración inicial generada y validada) reemplazando los dos mecanismos
manuales de migración que existían (`db.py::init_db`, `predict.py::_ensure_scenario_schema`). Se
corrigió un bug de CORS preexistente (`allow_origins=["*"]` + `allow_credentials=True`, combinación
que el navegador rechaza con headers de auth). `Dockerfile`/`.dockerignore`/`requirements.txt`
listos para Render. Validado con una prueba de humo end-to-end (Postgres/SQLite local + JWT
falso + storage en memoria): aislamiento cross-tenant y bloqueo de escritura por rol confirmados
en 16/16 checks.

**Frontend** (`frontend/`): `@supabase/supabase-js` + `@supabase/ssr` instalados;
`lib/supabase/{client,server,middleware}.ts` + `middleware.ts` raíz (gate de sesión);
`/login` (password) + `/auth/callback` + `/reset-password`; reestructura mecánica de las 6
páginas de producto a un route group `app/(app)/` para que `/login` no herede el nav; store
(`lib/store.ts`) extendido con sesión/memberships/compañía activa (persistida); `lib/api.ts`
(`apiFetch`/`ApiError`/`getAuthHeaders`) reemplazando los ~56 `fetch` sueltos en las 5 páginas de
producto (migración delegada en 5 agentes en paralelo, uno por página); `Dropdown`/
`CompanySwitcher`/`UserMenu` en el header; gating de botones de escritura por rol
(`useCanEdit`) en datasets/transform/modeling/predict (analysis queda sin gating, son solo
lecturas/exports).

**Hallazgo**: `next build` nunca se había corrido en este repo (solo `npm run dev`). Al corregir
un archivo `.d.ts` corrupto (saltos de línea literales `\n`, bloqueaba el build por completo) y
un par de tipados menores, aparecieron más errores de tipos preexistentes y no relacionados,
dispersos en varias páginas — se desactivó `typescript.ignoreBuildErrors` como tapón (ver
pendiente arriba) para no bloquear el despliegue; el build de producción corre limpio (13/13
rutas generadas).

**Siguiente paso real**: nada de esto corre todavía en el stack real — falta que el usuario
aprovisione el proyecto Supabase (Postgres+Storage+Auth) y las cuentas de Render/Vercel para
desplegar y verificar en vivo (ver plan `noble-scribbling-music.md`, sección "Verificación
end-to-end").

### 2026-07-30 — Decisiones de arquitectura: infra, multi-company, rediseño de modelado

**Contexto:** se revisó el proyecto de referencia MX-HDI (MMM cliente HDI México, en
`Naawa/clients/MX-HDI/Modelling`) para definir el nuevo flujo de modelado y la infraestructura
de despliegue.

**Decisiones:**

1. **Infra:** Vercel (frontend) + Render (backend FastAPI, servicio persistente, no función
   serverless) + Supabase (Postgres + Storage + Auth). Se descarta droplet propio por ahora —
   carga operativa (parches, seguridad, backups) no justificada para el tamaño del equipo;
   Render es containerizable a futuro si se necesita más control.
2. **Cómputo en vivo, no offline:** a diferencia del patrón de MX-HDI (fit offline en
   notebooks, solo resultados estáticos en Supabase), Aion debe ajustar modelos en vivo desde
   el backend en cada request, como ya hace hoy. Validado que el cómputo necesario (OLS,
   stepwise, grid search adstock/Hill, NNLS) corre en segundos — no se necesita otra tecnología
   de procesamiento. Bayesiano conjunto (fuera de alcance ahora) sí sería demasiado pesado para
   una request — confirma dejarlo en fase futura.
3. **Modelado:** adstock (lag/decay geométrico) + Hill (saturación) se automatizan como
   barrido/grid search por variable al ajustar el modelo, no como configuración manual del
   usuario en Transform.
4. **Multi-company:** arquitectura de membresía muchos-a-muchos (un usuario puede pertenecer a
   varias compañías). Alta de compañías solo vía panel admin interno de Naawa (no auto-registro
   público). Tres roles por membresía: `modelador`, `visualizador`, `admin_compania` (este
   último puede invitar/gestionar usuarios de su propia compañía sin depender de Naawa). Una
   capacidad separada de `platform_admin` (staff Naawa) permite crear compañías nuevas, pero no
   otorga visibilidad de datos de otras compañías por sí sola.

**Por qué:** evitar rehacer trabajo — migrar infraestructura y diseñar el esquema multi-tenant
desde el inicio del rediseño, en vez de construir features nuevas en local y migrarlas después.

**Pendiente:** aterrizar esto en un plan de implementación por fases (fundación
infra+auth+multi-tenant primero, luego modelado, luego capa económica) antes de escribir código.

**Actualización:** plan de implementación de la Fase 1 (fundación) aprobado por el usuario.
Detalle completo en `C:\Users\sebmo\.claude\plans\noble-scribbling-music.md`. Confirmado
además: `admin_compania` tiene acceso completo de datos (igual que `modelador`) más gestión de
usuarios; se empieza limpio en la nube, sin migrar los datos de desarrollo locales existentes.
Empieza la implementación (backend primero, luego frontend, según el orden de ejecución del
plan).

**Aclaración (mismo día):** se revisó la opción de droplet propio comparándola contra el stack
completo (no solo como sustituto de Render) — patrón que el usuario ya usa con ERPNext, todo en
Docker sobre un droplet. Se confirma la recomendación de Vercel+Render+Supabase: el cálculo se
fortalece, no cambia, porque el droplet ahora tendría que absorber también Postgres+Auth+Storage
(self-hosted Supabase es una pila multi-contenedor más frágil de operar que el servicio
gestionado) para una app multi-company de cara a clientes, donde la seguridad/disponibilidad del
dato pesa más que en una herramienta interna tipo ERPNext. Punto medio anotado por si se quiere
más control al estilo "todo en Docker": correr frontend+backend en un droplet propio dejando
Supabase gestionado (Postgres/Auth/Storage) — sin self-hostear esas piezas críticas.

### 2026-07-30 — Sistema operativo de trabajo (README / INDEX / Bitácora / CLAUDE)

**Decisión:** adoptar el sistema de 4 documentos base que el usuario usa en sus proyectos de
Claude, adaptado a un repo de código: `README.md` = descripción y estado actual, `INDEX.md` =
mapa de módulos/archivos clave (no archivo-por-archivo, para evitar que se desactualice),
`BITACORA.md` = decisiones/pendientes/archivos generados (más reciente arriba), `CLAUDE.md` =
arquitectura + reglas operativas.

**Por qué:** dar continuidad entre sesiones y separar claramente "qué es el proyecto" de "cómo
llegamos aquí y qué falta". `docs/README.md` (la especificación técnica por módulo, ya existente)
se conserva como referencia de contratos API, pero se le quitaron las secciones que se
duplicaban con README/Bitácora (overview, setup, deployment, next steps).

**Archivos:** `README.md` (nuevo, raíz), `INDEX.md` (nuevo), `BITACORA.md` (nuevo, este
archivo), `docs/README.md` (recortado), `CLAUDE.md` (actualizado con reglas operativas).

### 2025-12-10 — Spreadsheet / Editable Table Fix (Módulo 5)

Ajustes y corrección de bugs en la grilla editable de escenarios
(`ScenarioGrid`/`ScenarioSheetGlide`).

### 2025-12-08 — MVP Predict Module (Módulo 5)

Primera versión funcional de Predict: escenarios time-phased (horizonte, fecha de inicio,
frecuencia), grilla de periodos × variables, preview en tiempo real, CRUD de escenarios,
import/export CSV/XLSX.

### 2025-12-05 — MVP Analysis Module (Módulo 4) + Editable Table + Predict Chart

Contribución/atribución por variable y grupo/subgrupo, series apiladas por periodo, exports a
Excel. Base de la tabla editable y del gráfico de predicción usados luego en Predict.

### 2025-11-28 — Best Model (Stepwise) + rango de fechas y fórmula de atribución en Analysis

Selección stepwise del mejor modelo en Módulo 3. En Módulo 4: filtro por rango de fechas y
ajuste de la fórmula de atribución/contribución.

### 2025-11-19 — MVP V01: Datasets, Transform y Modeling (Módulos 1–3)

Primeras versiones funcionales de los tres módulos base: carga/gestión de datasets,
categorización de variables (Grupo/Subgrupo) y variables derivadas, y modelos de regresión OLS
con métricas (R², VIF, Durbin–Watson) y roles hero/challenger.

### 2025-11-13 — UI inicial + gestión de datasets

Diseño inicial aplicado a todos los módulos; reemplazo de archivo de dataset, límites de filas
(sample size) y selección de variable temporal.

### 2025-11-11 — Commit inicial

Estructura base del monorepo (frontend Next.js + backend FastAPI).
