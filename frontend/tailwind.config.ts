import type { Config } from 'tailwindcss';

// Each color is wrapped in `rgb(var(--x) / <alpha-value>)` so Tailwind's
// alpha modifier (e.g. bg-success/40, bg-category-teal/[0.08]) works
// against the CSS variables. The underlying CSS vars are space-separated
// RGB triplets defined in globals.css.
const rgb = (varName: string) => `rgb(var(${varName}) / <alpha-value>)`;

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Brand (themeable)
        'brand-primary':     rgb('--color-brand-primary'),
        'brand-accent':      rgb('--color-brand-accent'),
        'on-brand':          rgb('--color-brand-on-primary'),

        // Surfaces (system)
        canvas:    rgb('--color-bg-canvas'),
        surface:   rgb('--color-bg-surface'),
        elevated:  rgb('--color-bg-elevated'),

        // Text
        fg:           rgb('--color-fg-default'),
        'fg-muted':   rgb('--color-fg-muted'),
        'fg-subtle':  rgb('--color-fg-subtle'),
        'fg-inverse': rgb('--color-fg-inverse'),

        // Borders
        border:          rgb('--color-border-subtle'),
        'border-strong': rgb('--color-border-strong'),

        // Semantic
        success:      rgb('--color-semantic-success'),
        warning:      rgb('--color-semantic-warning'),
        danger:       rgb('--color-semantic-danger'),
        info:         rgb('--color-semantic-info'),
        'success-deep': rgb('--color-semantic-success-deep'),
        'warning-deep': rgb('--color-semantic-warning-deep'),
        'danger-deep':  rgb('--color-semantic-danger-deep'),
        'info-deep':    rgb('--color-semantic-info-deep'),

        // Accent (AI events)
        'accent-purple':      rgb('--color-accent-purple'),
        'accent-purple-deep': rgb('--color-accent-purple-deep'),
        'accent-indigo':      rgb('--color-accent-indigo'),
        'accent-indigo-deep': rgb('--color-accent-indigo-deep'),

        // Category (DQ dimension chips)
        'category-teal':       rgb('--color-category-teal'),
        'category-teal-deep':  rgb('--color-category-teal-deep'),
        'category-rose':       rgb('--color-category-rose'),
        'category-rose-deep':  rgb('--color-category-rose-deep'),
        'category-amber':      rgb('--color-category-amber'),
        'category-amber-deep': rgb('--color-category-amber-deep'),
        'category-slate':      rgb('--color-category-slate'),
        'category-slate-deep': rgb('--color-category-slate-deep'),

        // --- Compatibility aliases for existing class usages ---
        bg:                  rgb('--color-bg-canvas'),
        'surface-raised':    rgb('--color-bg-canvas'),
        'text-primary':      rgb('--color-fg-default'),
        'text-secondary':    rgb('--color-fg-muted'),
        'text-muted':        rgb('--color-fg-subtle'),
        indigo: { DEFAULT: rgb('--color-accent-indigo'), light: rgb('--color-accent-indigo') },
        'success-light': rgb('--color-semantic-success'),
        'warning-light': rgb('--color-semantic-warning'),
        'danger-light':  rgb('--color-semantic-danger'),
      },
      fontFamily: {
        sans:    ['var(--font-body)', 'sans-serif'],
        display: ['var(--font-display)', 'sans-serif'],
        mono:    ['var(--font-mono)', 'monospace'],
      },
      borderRadius: {
        sm:   'var(--radius-sm)',
        md:   'var(--radius-md)',
        lg:   'var(--radius-lg)',
        full: 'var(--radius-full)',
      },
    },
  },
  plugins: [],
};
export default config;
