import type { Theme } from './types';

export function writeTokensToRoot(theme: Theme): void {
  const root = document.documentElement;
  root.setAttribute('data-theme', theme.id);

  // Brand
  root.style.setProperty('--color-brand-primary', theme.brand.primary);
  root.style.setProperty('--color-brand-accent', theme.brand.accent);
  root.style.setProperty('--color-brand-on-primary', theme.brand.onPrimary);

  // Optional semantic overrides
  if (theme.semantic) {
    for (const [k, v] of Object.entries(theme.semantic)) {
      if (v) root.style.setProperty(`--color-semantic-${k}`, v);
    }
  }

  // Display font (optional)
  if (theme.fontDisplay) {
    root.style.setProperty('--font-display', theme.fontDisplay);
  }
}
