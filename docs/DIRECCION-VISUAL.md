# Dirección visual de Aion

Especificación de diseño aprobada en la **Fase 7.1** (2026-08-11). Es la fuente de verdad para las
fases 7.2 en adelante: tokens, primitivas y cada página se implementan contra este documento.

Dirección elegida: **C — "Panel"**, de tres candidatas renderizadas con datos reales
(A "Instrumento" analítico denso, B "Informe" editorial, C "Panel" híbrido).

---

## 1. Tesis

> **Dos audiencias, una sola página.**

Aion sirve a un `modelador` que construye y a un `visualizador` que consulta. En vez de dos productos
—o una página densa que abruma al director y una vista pobre que frustra al analista— cada pantalla
abre en **Resumen** y se densifica a **Detalle** con un control explícito, sin cambiar de ruta.

Consecuencias de diseño que se derivan de la tesis:

- **El estado se codifica en forma, no solo en cifra.** Franjas de severidad, chips con texto
  ("Bueno", "Revisar"), puntos de progreso en el pipeline. El color nunca es el único portador
  de significado.
- **La jerarquía la fija el modo, no el scroll.** Lo que en Resumen está oculto no está "más abajo":
  no existe hasta que se pide.
- **Sidebar con el pipeline numerado**, colapsable. La barra superior lleva el contexto persistente
  (dataset · modelo · periodo), que hoy cada módulo reimplementa en tres posiciones distintas.

---

## 2. Color

Todos los valores verificados con un script de contraste WCAG; los de gráficas, además, con el
validador de daltonismo del skill `dataviz`. **Los hexes de serie no cambian respecto a lo que ya
existe en `frontend/src/lib/chart-colors.ts`** — lo que hicieron las Fases 0/0b en color se conserva.

### 2.1 Superficies e ink

| Token | Claro | Oscuro | Uso |
|---|---|---|---|
| `--plane` | `#f5f5f7` | `#0b0c0e` | Fondo de la página |
| `--surface` | `#ffffff` | `#16181b` | Tarjetas, barras, sidebar |
| `--surface-2` | `#fafafb` | `#1b1e22` | Hover de fila, superficies anidadas |
| `--ink` | `#17181c` | `#f2f3f5` | Texto principal |
| `--ink-2` | `#52555e` | `#aab0b8` | Texto secundario |
| `--muted` | **`#6d7178`** | **`#81858e`** | Etiquetas, ejes, texto de apoyo |

> ⚠️ `--muted` **corregido respecto al mockup**. Los valores originales (`#82868f` / `#7d818a`)
> fallaban: 3.65:1 en claro sobre `--surface` y 4.28:1 en oscuro sobre `--surface-2`, contra el
> mínimo AA de 4.5:1. Los nuevos pasan sobre las tres superficies en ambos modos
> (claro 4.50–4.90, oscuro 4.52–5.29). Es el mismo bug que la auditoría encontró en la app actual
> (`#94a3b8`, 2.8:1) — no se puede repetir.

### 2.2 Líneas — dos tokens, no uno

La distinción es deliberada. WCAG 1.4.11 exige 3:1 solo a los límites de **componentes
interactivos**; forzar ese contraste a todo separador decorativo haría la interfaz pesada y
cajonera, en contra de la dirección.

| Token | Claro | Oscuro | Uso | Mínimo |
|---|---|---|---|---|
| `--line` | `#e5e6ea` | `#262a2f` | Separadores decorativos, bordes de tarjeta | — |
| `--line-2` | `#d0d2d8` | `#343a41` | Divisores con más peso, cabeceras de tabla | — |
| `--border-control` | **`#8b8d91`** | **`#61656b`** | **Borde de input, select, botón secundario** | **≥3:1** |

`--border-control` es un token **nuevo**, ausente del mockup: ahí los inputs usaban `--line-2`
(1.51:1). Todo control donde el borde define dónde se puede escribir o pulsar lo usa.

### 2.3 Acento y estados

| Token | Claro | Oscuro | Contraste |
|---|---|---|---|
| `--accent` | `#4b3fb0` | `#a79bf5` | 7.96:1 / 7.33:1 |
| `--accent-bg` | `#eeecfb` | `#221d3d` | par con accent: 6.84 / 6.60 |
| `--good` / `--good-bg` | `#006300` / `#e4f2e4` | `#0ca30c` / `#14261a` | 6.51 / 4.74 |
| `--warn` / `--warn-bg` | `#8a5a00` / `#fbf0d9` | `#f0b429` / `#2c2312` | 5.24 / 8.31 |
| `--bad` | `#b4291f` | `#e66767` | 6.41 / 5.51 |

El violeta se eligió porque **ninguna serie de gráfica lo usa** en las pantallas de Aion (las series
ocupan slots 1–4: azul, naranja, aqua, amarillo). Un acento de cromo nunca debe poder confundirse
con un dato.

**Regla de vocabulario de color:** `good/warn/bad` son *estados* (calidad de una métrica, resultado
de una operación). **Nunca** codifican identidad. Hoy `lib/roles.ts` mapea `visualizador → warning`,
lo que pinta un rol perfectamente normal de ámbar, como si algo estuviera mal; los roles pasan a una
escala neutra propia.

### 2.4 Series de gráfica (sin cambios)

| Slot | Claro | Oscuro | Grupo en Aion |
|---|---|---|---|
| 1 | `#2a78d6` | `#3987e5` | Baseline |
| 2 | `#eb6834` | `#d95926` | Calendario |
| 3 | `#1baf7a` | `#199e70` | Macro |
| 4 | `#eda100` | `#c98500` | Marketing |

Validado: en oscuro pasa las seis comprobaciones. En claro, aqua y amarillo quedan bajo 3:1 contra
la superficie → **regla de relieve**: esas gráficas llevan siempre etiqueta directa o vista de tabla.
Ambas ya están en el mockup.

**Asignación estable grupo→color.** Hoy Analysis asigna por *orden de serie* (filtrar puede
repintar), Modeling usa índices fijos y Predict no usa la paleta. El color debe seguir al grupo,
nunca a su posición.

---

## 3. Tipografía

Una sola familia. La jerarquía la hacen tamaño y peso, no mezclar fuentes.

```
--font-ui: "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, sans-serif;
--font-num: "Cascadia Mono", Consolas, ui-monospace, monospace;   /* solo columnas numéricas */
```

> Pendiente de decisión en 7.2: si se incrusta una tipografía propia (Inter ya está en el proyecto)
> como archivo local. Los mockups usaron fuentes del sistema porque el CSP de los artifacts bloquea
> CDNs. La escala de abajo no depende de la familia.

### Escala de tamaños

Fina abajo (donde la UI la necesita), abierta arriba (donde el display necesita contraste).
Sustituye a los **15 tamaños ad-hoc** del mockup.

| Token | px | Ratio vs. anterior | Uso |
|---|---|---|---|
| `3xs` | 10 | — | Micro-etiquetas en mayúsculas con tracking |
| `2xs` | 11 | 1.10 | Cabeceras de tabla, ejes de gráfica |
| `xs` | 12 | 1.09 | Chips, etiquetas de KPI, pies |
| `sm` | 13 | 1.08 | Texto secundario, cuerpo de tabla |
| `base` | 14 | 1.08 | Texto y controles por defecto |
| `md` | 16 | 1.14 | Párrafo de entrada, texto destacado |
| `lg` | 18 | 1.13 | Títulos de tarjeta |
| `xl` | 22 | 1.22 | Títulos de sección |
| `2xl` | 28 | 1.27 | Título de página (h1) |
| `3xl` | 34 | 1.21 | Valor de KPI |
| `4xl` | 44 | 1.29 | Valor de KPI hero |

**Regla dura:** en una tarjeta de KPI, etiqueta y valor **nunca** comparten tamaño. Hoy comparten
`text-lg font-semibold` (`card.tsx:26`), que es la causa de que los números no destaquen.
Etiqueta = `xs` en `--muted`; valor = `3xl`/`4xl` en `--ink`.

`font-variant-numeric: tabular-nums` es obligatorio en columnas de tabla, ejes y cualquier cifra que
se alinee verticalmente.

---

## 4. Espaciado

Rejilla de **4 px**. Coincide con la escala por defecto de Tailwind, así que no requiere config
adicional.

| Paso | px | Tailwind | Uso típico |
|---|---|---|---|
| 1 | 4 | `1` | Separación dentro de un chip |
| 2 | 8 | `2` | Gap entre icono y texto |
| 3 | 12 | `3` | Padding de control pequeño |
| 4 | 16 | `4` | Padding de tarjeta, gap de grilla |
| 5 | 20 | `5` | Padding de tarjeta amplia |
| 6 | 24 | `6` | Margen de sección |
| 8 | 32 | `8` | Separación entre bloques |
| 10 | 40 | `10` | Separación entre secciones mayores |
| 12 | 48 | `12` | Respiro de cabecera de página |
| 16 | 64 | `16` | Pie de página |

---

## 5. Radios y alturas

### Radio

| Token | px | Uso |
|---|---|---|
| `sm` | 6 | Chips, pips, swatches de color |
| `md` | 8 | Botones, inputs, ítems de navegación |
| `lg` | 12 | Tarjetas y paneles |
| `full` | 999 | Solo píldoras que deben leerse como píldora |

Sustituye a los **6 radios** del mockup y a los **5 en uso hoy** (`rounded-full` ×33, `2xl` ×21,
`xl` ×19, `lg` ×13, `md` ×2). Nota: hoy `Card`, `Modal` y `Dropdown` no comparten radio.

### Altura de controles

| Token | px | Uso |
|---|---|---|
| `sm` | 32 | Acciones densas dentro de una tarjeta |
| `md` | 36 | Botón e input por defecto |
| `lg` | 44 | CTA principal y **todo objetivo táctil** |

El área táctil mínima es **44 px** en móvil/tablet. Hoy los enlaces del nav miden ~28 px, incluida
la variante móvil.

### Altura de gráficas

Sustituye a los **6 valores arbitrarios** actuales (140 / 220 / 256 / 320 / 384 / 480).

| Token | px | Uso |
|---|---|---|
| `xs` | 160 | Small multiples (curvas de saturación por canal) |
| `sm` | 240 | Gráfica de apoyo |
| `md` | 320 | Gráfica principal de una sección |
| `lg` | 420 | Gráfica protagonista de la vista |

La curva de saturación —la que justifica decisiones de inversión— hoy es la más pequeña de la app
(140 px). Pasa a `xs` como mínimo, y a `sm` cuando ocupa ancho completo.

---

## 6. Reglas de gráfica

Heredadas del skill `dataviz` y ya aplicadas en el mockup:

- **Nunca doble eje.** Dos medidas de escala distinta → dos gráficas. (Hoy Modeling combina barras
  MAE/RMSE con una línea de R² en el mismo plano.)
- **Ticks redondos.** Calculados con un algoritmo de "nice numbers", no dividiendo el rango.
- **Leyenda siempre** con 2+ series, más etiqueta directa al final de cada línea.
- **Formato numérico único** en todos los ejes de todas las páginas.
- **Separación de 2 px** del color de superficie entre segmentos apilados.
- **Marcar el punto de operación** sobre la curva de saturación, con línea de referencia al eje y
  una línea de "techo" punteada — sin ella, un canal cuya curva llega a 0.80 parece peor que otro
  que llega a 1.00, cuando lo que cambia es la forma de la curva.
- **Tooltip en todas** las gráficas; crosshair en las de línea.

---

## 7. Qué queda por decidir en 7.2

1. **Tipografía propia** incrustada como archivo local, o seguir con la del sistema.
2. **Dónde vive la preferencia de idioma** (i18n es/en): `localStorage` como el tema, o campo por
   usuario en base de datos.
3. **Umbrales de los chips cualitativos** ("Bueno" / "Revisar"): fijos en código o configurables por
   compañía. El mockup usa R² > 0.7 y VIF < 5 como provisionales.
4. **Qué se ve en Resumen y qué en Detalle**, módulo por módulo. El mockup lo resuelve para Análisis;
   falta para los otros seis.

---

## 8. Decisiones de implementación (Fase 7.2)

Resuelve el pendiente de la sección 7 con lo que efectivamente se implementó en código
(`globals.css`, `tailwind.config.ts`, `components/ui/`) — detalle completo en `BITACORA.md`.

1. **Tipografía**: fuentes de sistema, tal como especifica la sección 3. No se incrusta Inter ni
   ninguna fuente propia.
2. **Idioma**: preferencia en `localStorage` (`aion-locale`), mismo patrón que el tema. No hay
   campo en BD ni prefijo de ruta.
3. **Radios y alturas**: no se tocó `borderRadius` de Tailwind — los valores de esta sección (6/8/12
   /44px) coinciden con claves default de Tailwind (`rounded-md/lg/xl`, `h-8/9/11`); se usan
   directamente, documentados como convención. Sí se agregaron alturas semánticas nuevas
   (`control-sm/md/lg`, `chart-xs/sm/md/lg`) porque los valores de gráfica (160/240/320/420px) no
   coinciden todos con la escala default.
4. **Token nuevo no previsto en este documento**: `--plane-translucent` (fondo translúcido del
   header al hacer scroll) y `--bad-bg` (esta sección no da un par -bg para `--bad`; se computó
   `#fbe6e4` claro / `#2e1613` oscuro, verificado ≥4.5:1 con la misma fórmula WCAG de la sección 2).
5. **Badge**: la variante `neutral` (§2.3, "nunca identidad") se corrigió para ser gris de verdad
   (antes era azul/accent); se agregó una variante `accent` aparte para quien quería ese look. Los
   roles de usuario (`lib/roles.ts`) pasan todos a `neutral` — un rol no es un estado, no necesita
   una escala de color propia, solo el texto lo distingue.
6. **Tokens `--color-*` heredados**: no se eliminan en 7.2 — conviven con los nuevos hasta que cada
   página los reemplace en su propio pase (7.4-7.8). Ver pendiente explícito en `BITACORA.md`.

## Referencias

- Mockups renderizados de las tres direcciones: ver la entrada de 2026-08-11 en `BITACORA.md`.
- Auditoría de origen (110 recomendaciones, 11 lentes): `_ui-review/` (temporal, se elimina al
  cerrar la Fase 7).
- Paleta de series y validador de daltonismo: skill `dataviz`, y
  `frontend/src/lib/chart-colors.ts`.
