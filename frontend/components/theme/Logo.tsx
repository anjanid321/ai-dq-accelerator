'use client';
import { useActiveTheme } from './useActiveTheme';

export function Logo() {
  const theme = useActiveTheme();
  return (
    <img
      src={theme.logo.src}
      alt={theme.logo.alt ?? theme.displayName}
      width={theme.logo.width}
      height={theme.logo.height}
    />
  );
}
