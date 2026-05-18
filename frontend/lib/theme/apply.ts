import type { Theme } from './types';

/** Convert "#FF8200" → "255 130 0" so it can back a Tailwind alpha-channel var. */
function hexToRgbTriplet(hex: string): string {
  const m = hex.replace('#', '').match(/^([0-9a-f]{6})$/i);
  if (!m) return hex; // fallback: leave as-is for invalid input
  const v = m[1];
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  return `${r} ${g} ${b}`;
}

export function writeTokensToRoot(theme: Theme): void {
  const root = document.documentElement;
  root.setAttribute('data-theme', theme.id);

  // Brand — stored as RGB triplets so Tailwind alpha modifiers work.
  root.style.setProperty('--color-brand-primary',    hexToRgbTriplet(theme.brand.primary));
  root.style.setProperty('--color-brand-accent',     hexToRgbTriplet(theme.brand.accent));
  root.style.setProperty('--color-brand-on-primary', hexToRgbTriplet(theme.brand.onPrimary));

  // Optional semantic overrides
  if (theme.semantic) {
    for (const [k, v] of Object.entries(theme.semantic)) {
      if (v) root.style.setProperty(`--color-semantic-${k}`, hexToRgbTriplet(v));
    }
  }

  // Display font (optional)
  if (theme.fontDisplay) {
    root.style.setProperty('--font-display', theme.fontDisplay);
  }
}
