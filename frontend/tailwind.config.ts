import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Brand (themeable)
        'brand-primary':     'var(--color-brand-primary)',
        'brand-accent':      'var(--color-brand-accent)',
        'on-brand':          'var(--color-brand-on-primary)',

        // Surfaces (system)
        canvas:    'var(--color-bg-canvas)',
        surface:   'var(--color-bg-surface)',
        elevated:  'var(--color-bg-elevated)',

        // Text
        fg:           'var(--color-fg-default)',
        'fg-muted':   'var(--color-fg-muted)',
        'fg-subtle':  'var(--color-fg-subtle)',
        'fg-inverse': 'var(--color-fg-inverse)',

        // Borders
        border:          'var(--color-border-subtle)',
        'border-strong': 'var(--color-border-strong)',

        // Semantic
        success:      'var(--color-semantic-success)',
        warning:      'var(--color-semantic-warning)',
        danger:       'var(--color-semantic-danger)',
        info:         'var(--color-semantic-info)',
        'success-deep': 'var(--color-semantic-success-deep)',
        'warning-deep': 'var(--color-semantic-warning-deep)',
        'danger-deep':  'var(--color-semantic-danger-deep)',
        'info-deep':    'var(--color-semantic-info-deep)',

        // Accent (AI events)
        'accent-purple':      'var(--color-accent-purple)',
        'accent-purple-deep': 'var(--color-accent-purple-deep)',
        'accent-indigo':      'var(--color-accent-indigo)',
        'accent-indigo-deep': 'var(--color-accent-indigo-deep)',

        // Category (DQ dimension chips)
        'category-teal':       'var(--color-category-teal)',
        'category-teal-deep':  'var(--color-category-teal-deep)',
        'category-rose':       'var(--color-category-rose)',
        'category-rose-deep':  'var(--color-category-rose-deep)',
        'category-amber':      'var(--color-category-amber)',
        'category-amber-deep': 'var(--color-category-amber-deep)',
        'category-slate':      'var(--color-category-slate)',
        'category-slate-deep': 'var(--color-category-slate-deep)',

        // --- Compatibility aliases for existing class usages ---
        // Stage components reference bg-bg, text-text-primary, bg-indigo/10, etc.
        bg:                  'var(--color-bg-canvas)',
        'surface-raised':    'var(--color-bg-canvas)',
        'text-primary':      'var(--color-fg-default)',
        'text-secondary':    'var(--color-fg-muted)',
        'text-muted':        'var(--color-fg-subtle)',
        indigo: { DEFAULT: 'var(--color-accent-indigo)', light: 'var(--color-accent-indigo)' },
        'success-light': 'var(--color-semantic-success)',
        'warning-light': 'var(--color-semantic-warning)',
        'danger-light':  'var(--color-semantic-danger)',
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
