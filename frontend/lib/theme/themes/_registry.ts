import { udig } from './udig';
import { tractorSupply } from './tractor-supply';

export const themes = {
  'udig': udig,
  'tractor-supply': tractorSupply,
} as const;

export type RegisteredThemeId = keyof typeof themes;
export const DEFAULT_THEME_ID: RegisteredThemeId = 'udig';
