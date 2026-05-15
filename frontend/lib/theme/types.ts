// frontend/lib/theme/types.ts

export type ThemeId = string;

export interface ThemeLogo {
  src: string;
  width: number;
  height: number;
  alt?: string;
}

export interface BrandColors {
  primary: string;
  accent: string;
  onPrimary: string;
}

export interface SemanticColors {
  success: string;
  warning: string;
  danger: string;
  info: string;
}

export interface Theme {
  id: ThemeId;
  displayName: string;
  logo: ThemeLogo;
  faviconUrl?: string;
  brand: BrandColors;
  /** If omitted, system defaults are used. */
  semantic?: Partial<SemanticColors>;
  /** Optional override of the display font family. Body font is system-fixed. */
  fontDisplay?: string;
}
