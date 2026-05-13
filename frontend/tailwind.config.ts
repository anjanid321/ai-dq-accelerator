import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#f8fafc',
        surface: '#ffffff',
        'surface-raised': '#f8fafc',
        elevated: '#f1f5f9',
        border: '#e2e8f0',
        'text-primary': '#0f172a',
        'text-secondary': '#475569',
        'text-muted': '#94a3b8',
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
