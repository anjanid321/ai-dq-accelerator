'use client';
import { createContext, useContext } from 'react';
import type { Theme } from '@/lib/theme/types';
import { udig } from '@/lib/theme/themes/udig';

export const ActiveThemeContext = createContext<Theme>(udig);
export function useActiveTheme(): Theme {
  return useContext(ActiveThemeContext);
}
