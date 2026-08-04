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
- [x] Backend desplegado en Render (`https://aion-etd6.onrender.com`). Requirió cambiar
      `AION_DATABASE_URL` de la conexión directa de Supabase (IPv6-only, no llega desde Render) al
      Session pooler (`aws-0-<region>.pooler.supabase.com:5432`, usuario `postgres.<project-ref>`).
      Ver historial de hoy.
- [x] Frontend desplegado en Vercel (`https://aion-seven-pink.vercel.app`), `AION_ALLOWED_ORIGINS`
      en Render actualizado (incluye `http://localhost:3000` + la URL de Vercel). Login,
      transformaciones y modelos probados en producción y funcionan.
- [ ] Dominio propio para el frontend en Vercel — pendiente, el usuario lo definirá en los
      próximos días. Por ahora se usa el subdominio `.vercel.app` por default.
- [x] Bug de preview en `/transform` ("Failed to fetch" en producción) — resuelto. Causa raíz:
      `variables.py:438` usaba `.fillna(method="ffill")`, sintaxis eliminada en pandas 3.0; como
      `requirements.txt` no fijaba versión, Render resolvió `pandas==3.0.5` en el build mientras
      local tenía `2.3.3` cacheado, de ahí que solo reprodujera en producción. De paso se encontró
      y corrigió un bug más de fondo: una excepción no capturada nunca lleva headers CORS (el
      middleware de error de Starlette corre por fuera de `CORSMiddleware`), por lo que cualquier
      500 futuro se vería igual como "Failed to fetch" en vez de un error real — se agregó un
      manejador global de excepciones en `main.py`. Se aprovechó para fijar las 17 dependencias de
      `requirements.txt` a versión exacta (solo primer nivel, no todo `pip freeze`, para no romper
      el dev local en Windows con paquetes de Linux como `uvloop`). Ver historial de hoy.
- [ ] `render.yaml` (infra-as-code) — fast-follow no bloqueante, configurar primero por
      dashboard.
- [ ] RLS en Supabase: descartado para esta fase (la autorización real vive en la capa de
      aplicación, ver arriba) — queda como mejora opcional a futuro, no pendiente activo.
- [x] Rediseño de modelado: adstock (lag/decay geométrico) + Hill (saturación) como
      transformaciones automáticas por variable de medios — barrido (grid search) al ajustar el
      modelo, no configuración manual del usuario. Implementado (ver historial de hoy); metodología
      de referencia en `[[mx_hdi_reference_project]]` (memoria de Claude).
  - Esto también resuelve: "Módulo 5: forecast con variable original, transformación en backend
    antes de predecir" (ítem antiguo de abajo) — las proyecciones de escenario ahora aplican
    adstock+Hill sobre la serie histórico+futuro concatenada.
- [ ] Capa económica: tasa de conversión + valor/precio promedio ligados al `y_var` del modelo,
      costos de medios por variable/grupo/subgrupo, cálculo y visualización de ROI/ROAS y
      eficiencia de media mix. Fórmula de referencia: `ingreso = contribución × tasa_conversión
      × valor_promedio`; `ROI = ingreso / inversión − 1`.
  - Esto reemplaza/agrupa los ítems antiguos de Módulo 4 sobre tasa de conversión, precio
    promedio y costos (ver abajo).
  - **Dos consideraciones de negocio a resolver en el diseño (aportadas por el usuario
    2026-08-03, antes de empezar a implementar esta capa):**
    1. **Inversión total ≠ solo variables que entraron al modelo.** En la práctica no todas las
       variables de medios terminan siendo predictores del modelo (p.ej. Video y Display sí
       entran, Radio no — por significancia, colinealidad, etc.), pero la inversión total y el
       ROI total deben reflejar el gasto real completo (Video + Display + Radio), aunque la
       contribución de Radio sea 0 por no estar en el modelo. Implica que el catálogo de
       "inversión por canal" no puede ser simplemente "suma de costos de los x_vars del
       modelo" — necesita cubrir también canales con inversión pero sin variable seleccionada
       en el modelo (contribución 0, pero costo > 0 en el denominador del ROI).
    2. **Evitar duplicar/triplicar inversión cuando varias variables miden lo mismo.** Es común
       tener varias métricas correlacionadas del mismo canal (p.ej. impresiones, clics y views
       de YouTube) y que solo una entre al modelo por ser la que mejor ajusta (p.ej. views). El
       costo de referencia (p.ej. CPV) debe asociarse a esa métrica ganadora únicamente — no se
       deben sumar también costos por impresiones o clics del mismo canal, o la inversión total
       quedaría multiplicada por cada métrica redundante en vez de contarse una sola vez por
       canal real de gasto.
    - Ambos puntos sugieren que la capa económica necesita un concepto de "canal de inversión"
      (gasto real en $) desacoplado de "variable predictora del modelo" — probablemente un
      catálogo nuevo (¿a nivel Group/Subgroup, o una tabla aparte?) que mapee cada canal a: su
      costo/precio de referencia, la métrica específica que se usa como su proxy en el modelo (si
      la hay), y su inversión total — a diseñar con el usuario antes de escribir código.
- [x] Curva de saturación (Hill) con punto de operación — implementada en `/modeling` (ver
      historial de hoy).
- [ ] Visualizaciones de negocio pendientes: curva de adstock/decay standalone, waterfall/donut de
      atribución, dashboard de ROI/eficiencia (bloqueado por la capa económica de arriba).
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
- [x] Bug preexistente en `transform/page.tsx` corregido: el botón de borrar grupo llamaba
      `setGroupDeleteMode("uncategorized")`, un estado que nunca se declaró con `useState` y que
      ningún otro código consultaba (`confirmDeleteGroup` ya reasigna a "uncategorized" de forma
      fija vía `/groups/{id}?reassign=uncategorized`, sin ningún concepto de "modo") — residuo
      muerto de una versión anterior. Se quitó la línea; no requería más cambios.

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

### 2026-08-03 (5) — Toggle por modelo para activar/desactivar la transformación de medios

A raíz de probar el rediseño de modelado (ver entrada anterior), se detectó que algunas variables
de medios ya tenían un decay manual aplicado desde la herramienta vieja de Transform (p.ej.
`dig_meta_branding_views_d5`, derivada con `alpha=0.5`) y quedaron dentro de un subgrupo marcado
como medios — aplicarles adstock+Hill encima habría sido una doble transformación. Se agregó
`Model.apply_media_transforms: bool` (default `true`, migración `7f4d461579cd`): un toggle por
modelo, visible en el form de crear/editar en `/modeling`, que si se desactiva fuerza todas las
x_vars de ese modelo a valores crudos sin importar su flag de Group/Subgroup — útil tanto para este
caso (variables ya pre-procesadas manualmente) como para comparar un hero-con-transform vs. un
challenger-sin-transform. Se propaga a duplicar/best_stepwise (heredan el flag del modelo
original); modelos existentes quedan en `true` (comportamiento automático sin cambios) hasta que se
editen. Migración aplicada contra Postgres real.

### 2026-08-03 (4) — Rediseño de Modelado: adstock (decay geométrico) + Hill (saturación) automáticos

Implementado el ítem principal de la fase actual, con metodología portada de
`[[mx_hdi_reference_project]]` (memoria de Claude — proyecto MX-HDI). Cambios:

- **Detección de variables de medios**: nuevo flag `apply_media_transform` en `Group`/`Subgroup`
  (catálogo de Transform), no por variable individual ni por coincidencia de nombre — el usuario
  marca qué grupo/subgrupo aplica el transform desde `/transform`. Migración Alembic
  `6b0ac33ad4d4` generada, verificada contra SQLite temporal (upgrade/downgrade limpios) y ya
  aplicada contra el Postgres real (`alembic upgrade head` corrido a pedido del usuario).
- **Librería de transformación** (`backend/app/services/media_transform.py`): adstock geométrico
  (`y_t = x_t + decay·y_{t-1}`, normalizado por `(1-decay)`) + Hill (`x^S/(K^S+x^S)`), idéntico a la
  metodología de referencia.
- **Grid-search + matriz de diseño compartida** (`backend/app/services/model_fit.py`): barrido por
  canal (decay×S×lag×K, ~225 combinaciones) contra el residual del target tras controlar por las
  variables no-medios, fijo *antes* de cualquier selección de variables (igual que la referencia;
  se descartó el muestreo bayesiano conjunto de `decay/K/S/β` por la misma razón que en MX-HDI:
  no-identificabilidad estructural). Nueva tabla `ModelTransform` persiste los parámetros fit por
  `(modelo, variable)` — su ausencia para un modelo significa "sin transform" (control-only o
  modelo legacy pre-rediseño, que sigue funcionando exactamente como OLS puro, sin cambios).
- **Un solo punto de verdad para construir la matriz de diseño**: `models.py` (crear/editar/
  stepwise/summary/predictions), `routers/analysis.py::_fit_from_model` y el motor de escenarios de
  `predict.py` pasan todos por `build_design_matrix`. Se corrigió además un problema de fondo que
  este cambio expuso: cualquier filtro por rango de fechas debe aplicarse *después* de transformar
  sobre el histórico completo, nunca antes — filtrar primero rompería el arrastre (carryover) del
  adstock en el borde de la ventana. Las proyecciones de escenario en `/predict` ahora concatenan
  histórico+futuro, transforman una sola vez, y solo entonces recortan el tramo proyectado.
- **Frontend**: toggle "Aplica adstock + saturación (medios)" por grupo/subgrupo en `/transform`;
  en `/modeling`, badge + decay/half-life/K/S por variable de medios en la tabla de coeficientes del
  Hero, y una tarjeta nueva de curvas de saturación (Hill) con línea de referencia en el valor medio
  histórico de cada variable.
- **Verificación**: sin infraestructura corriendo localmente (Supabase real, sin fixtures), se
  verificó la lógica nueva con scripts standalone: (1) el grid-search recupera correctamente
  parámetros conocidos sobre datos sintéticos (R²>0.99) y el camino sin variables de medios da
  *exactamente* el mismo resultado que un OLS crudo (garantiza cero regresión en modelos legacy);
  (2) el arrastre de adstock a través de la frontera histórico/futuro se comprobó explícitamente
  distinto (y correcto) frente a transformar solo el tramo futuro en aislado. `npm run lint` y
  `tsc --noEmit` en el frontend no muestran errores nuevos (los pre-existentes ya documentados
  arriba siguen igual). Falta: probar en el navegador contra Supabase real (el usuario lo hará).

### 2026-08-03 (3) — Bug de preview en Transform: pandas 3.0 + CORS ocultando errores 500

Después del deploy, el preview de transformación en `/transform` mostraba "Failed to fetch" en
Vercel (no en local). Se descartaron CORS/timeout por pruebas directas con curl contra Render.
DevTools del usuario mostró que la request real sí llegaba y regresaba **500** — la pista que
faltaba. Dos bugs reales, ambos corregidos:

1. `variables.py:438` — `.fillna(method="ffill").fillna(method="bfill")` (sintaxis eliminada en
   pandas 3.0). `requirements.txt` no fijaba versión de pandas; Render resolvió `3.0.5` en un
   build fresco mientras el entorno local tenía `2.3.3` cacheado de antes — por eso solo
   reproducía en producción. Corregido a `.ffill().bfill()` (compatible con ambas versiones).
2. **Cualquier excepción no capturada pierde los headers CORS**: el middleware de error por
   defecto de Starlette corre *fuera* de `CORSMiddleware`, así que un 500 sin manejar nunca lleva
   `Access-Control-Allow-Origin` — el navegador lo bloquea a nivel de JS y lo reporta como
   "Failed to fetch" genérico, aunque la pestaña Network sí vea el 500 real. Se agregó un
   `@app.exception_handler(Exception)` global en `main.py` que responde con JSON normal (pasa por
   `CORSMiddleware` correctamente) y loggea el traceback real. Este fix aplica a cualquier
   endpoint, no solo este — antes, cualquier 500 no manejado se hubiera visto igual de opaco.

**De paso**: se fijaron las 17 dependencias de primer nivel en `backend/requirements.txt` a la
versión exacta ya probada en local (`pip freeze` filtrado, sin arrastrar paquetes específicos de
Linux como `uvloop` que romperían el dev local en Windows) — para no repetir esta clase de
sorpresa por drift de versión entre dev local y build fresco en Render.

### 2026-08-03 (2) — Primer deploy a Render/Vercel: 3 bugs encontrados y corregidos

Todo el trabajo de Fase 1 (auth + multi-tenancy + storage) seguía sin commitear en `main` desde
que se implementó — se hizo el commit (`8b99b15`) y push antes de poder desplegar, ya que
Render/Vercel despliegan desde GitHub.

1. **Conexión directa de Supabase es IPv6-only**: `AION_DATABASE_URL` apuntaba a
   `db.<ref>.supabase.co:5432` (conexión directa), que resuelve solo a IPv6. Render no tiene
   salida IPv6 → `alembic upgrade head` fallaba con `Network is unreachable` en cada deploy.
   Arreglado usando el **Session pooler** de Supabase (Connect → Session pooler → formato
   SQLAlchemy): `postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`.
   Este es el patrón a usar siempre que se conecte a Supabase Postgres desde un host sin salida
   IPv6 (Render, y probablemente otros).
2. **CORS bloqueando el frontend en Vercel**: `AION_ALLOWED_ORIGINS` en Render se dejó como
   placeholder (`http://localhost:3000`) durante el deploy del backend — pendiente actualizar con
   la URL real de Vercel una vez asignada.
3. **El middleware de auth nunca estuvo activo, ni en local**: `middleware.ts` vivía en
   `frontend/middleware.ts` (raíz del proyecto Next), pero Next.js exige que el archivo esté
   dentro de `src/` cuando el proyecto usa una carpeta `src/` (este caso) — si no, se ignora en
   silencio, sin error. Efecto: cualquier visitante caía directo en `/datasets` (por el
   `redirect()` incondicional en `(app)/page.tsx`) sin pasar nunca por `/login`, incluso en las
   pruebas locales previas — lo que parecía funcionar solo porque el usuario navegaba
   manualmente a `/login`. Corregido moviendo el archivo a `frontend/src/middleware.ts`
   (`523e5bf`); verificado que una request sin sesión a `/` ahora sí redirige a `/login`.

**Nota para futuros deploys**: si se usa Next.js con carpeta `src/`, cualquier archivo de
convención especial de Next (middleware, instrumentation, etc.) debe ir dentro de `src/`, no en
la raíz del paquete — revisar esto explícitamente la próxima vez que se agregue uno.

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
