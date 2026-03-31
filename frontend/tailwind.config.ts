import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#070a0f',
        surface: '#0f1420',
        elevated: '#0c0f1a',
        border: '#1e2035',
        'text-primary': '#f1f5f9',
        'text-secondary': '#94a3b8',
        'text-muted': '#475569',
        indigo: { DEFAULT: '#6366f1', light: '#818cf8' },
        success: { DEFAULT: '#22c55e', light: '#4ade80' },
        warning: { DEFAULT: '#f59e0b', light: '#fbbf24' },
        danger: { DEFAULT: '#ef4444', light: '#f87171' },
        purple: { DEFAULT: '#a78bfa', light: '#c4b5fd' },
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
}
export default config
