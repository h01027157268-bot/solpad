import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx,mdx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-inter)', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        ink: {
          950: '#000000',
          900: '#050505',
          800: '#0a0a0a',
        },
        up: '#c8f7d4',
        down: '#ffa2ae',
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '-500px 0' },
          '100%': { backgroundPosition: '500px 0' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.35' },
        },
      },
      animation: {
        shimmer: 'shimmer 2.2s linear infinite',
        'pulse-soft': 'pulseSoft 2.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
export default config;
