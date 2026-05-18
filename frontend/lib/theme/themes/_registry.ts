import { udig } from './udig';
import { clayton } from './clayton';

export const themes = {
  'udig': udig,
  'clayton': clayton,
} as const;

export type RegisteredThemeId = keyof typeof themes;
export const DEFAULT_THEME_ID: RegisteredThemeId = 'udig';
