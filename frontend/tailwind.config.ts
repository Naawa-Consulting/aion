import type { Config } from 'tailwindcss'

export default <Partial<Config>>{
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
      },
      // 2xs/3xs name the two bespoke pixel sizes already used repeatedly for eyebrow
      // labels and compact tags (see components/ui/eyebrow.tsx) — named here so future
      // components reuse a token instead of a fresh text-[11px]/text-[10px] each time.
      fontSize: {
        '2xs': ['11px', { lineHeight: '14px' }],
        '3xs': ['10px', { lineHeight: '12px' }],
      },
    },
  },
  plugins: [],
}

