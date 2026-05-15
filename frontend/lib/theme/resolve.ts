import { themes, DEFAULT_THEME_ID } from './themes/_registry';
import type { Theme, ThemeId } from './types';

export interface ResolveArgs {
  /** From `useSearchParams().get('client')` or equivalent. */
  searchParam: string | null;
  /** From `process.env.NEXT_PUBLIC_CLIENT`. */
  envVar: string | undefined;
}

export function resolveThemeId(args: ResolveArgs): ThemeId {
  const candidates = [args.searchParam, args.envVar];
  for (const c of candidates) {
    if (c && c in themes) return c as ThemeId;
  }
  return DEFAULT_THEME_ID;
}

export function resolveTheme(args: ResolveArgs): Theme {
  const id = resolveThemeId(args);
  return themes[id as keyof typeof themes];
}
