import type { Config } from 'tailwindcss'

export default <Partial<Config>>{
  // next-themes toggles a `.dark` class on <html> (theme-provider.tsx); Tailwind's default
  // darkMode strategy ('media') only follows OS preference and ignores that class. Needed for
  // any `dark:` utility (e.g. the primary/danger button text-color fix below) to track the
  // in-app theme toggle instead of the OS setting.
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-ui)'],
        mono: ['var(--font-num)'],
      },
      // Escala tipográfica de la Dirección C ("Panel", docs/DIRECCION-VISUAL.md §3) — 11 pasos
      // con rol semántico, sustituye la escala default de Tailwind (xs/sm/base/lg/xl/2xl/3xl/4xl).
      // Efecto: cualquier text-{tamaño} ya escrito en el código existente cambia de tamaño de
      // inmediato (0-8px de delta según el paso). Es intencional — ver Fase 7.2 en BITACORA.md.
      fontSize: {
        '3xs': ['10px', { lineHeight: '12px' }],
        '2xs': ['11px', { lineHeight: '14px' }],
        xs: ['12px', { lineHeight: '16px' }],
        sm: ['13px', { lineHeight: '18px' }],
        base: ['14px', { lineHeight: '20px' }],
        md: ['16px', { lineHeight: '24px' }],
        lg: ['18px', { lineHeight: '26px' }],
        xl: ['22px', { lineHeight: '28px' }],
        '2xl': ['28px', { lineHeight: '34px' }],
        '3xl': ['34px', { lineHeight: '40px' }],
        '4xl': ['44px', { lineHeight: '48px' }],
      },
      // Radio: no se toca borderRadius — la escala de la Dirección C (6/8/12px) coincide con las
      // claves default de Tailwind (rounded-md=6px, rounded-lg=8px, rounded-xl=12px). Convención:
      // rounded-md → chip/pip, rounded-lg → controles, rounded-xl → paneles, rounded-full → píldora.
      // Espaciado: la grilla de 4px de la Dirección C ya es la escala default de Tailwind.
      height: {
        // Alturas de control (Dirección C §5) — coinciden con h-8/h-9/h-11 default; con nombre
        // propio para que el código quede autodescriptivo.
        'control-sm': '32px',
        'control-md': '36px',
        'control-lg': '44px',
        // Alturas de gráfica (Dirección C §5) — sustituyen los 6 valores arbitrarios actuales.
        'chart-xs': '160px',
        'chart-sm': '240px',
        'chart-md': '320px',
        'chart-lg': '420px',
      },
      minHeight: {
        'control-sm': '32px',
        'control-md': '36px',
        'control-lg': '44px',
      },
      // Anchos gemelos de los de control, para botones cuadrados solo-ícono (IconButton).
      width: {
        'control-sm': '32px',
        'control-md': '36px',
        'control-lg': '44px',
      },
      colors: {
        // Tokens nuevos de la Dirección C. Son hex planos (no rgb(var(...) / <alpha-value>)), así
        // que no soportan el modificador de opacidad de Tailwind (bg-accent/50) — intencional, los
        // pares "soft" son tokens propios (accent-bg), no una opacidad calculada.
        plane: 'var(--plane)',
        surface: 'var(--surface)',
        'surface-2': 'var(--surface-2)',
        ink: 'var(--ink)',
        'ink-2': 'var(--ink-2)',
        muted: 'var(--muted)',
        line: 'var(--line)',
        'line-2': 'var(--line-2)',
        'border-control': 'var(--border-control)',
        accent: 'var(--accent)',
        'accent-bg': 'var(--accent-bg)',
        good: 'var(--good)',
        'good-bg': 'var(--good-bg)',
        warn: 'var(--warn)',
        'warn-bg': 'var(--warn-bg)',
        bad: 'var(--bad)',
        'bad-bg': 'var(--bad-bg)',
      },
    },
  },
  plugins: [],
}
