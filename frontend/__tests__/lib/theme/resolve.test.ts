import { resolveThemeId } from '@/lib/theme/resolve';

describe('resolveThemeId', () => {
  it('returns default when no URL param and no env var', () => {
    expect(resolveThemeId({ searchParam: null, envVar: undefined })).toBe('udig');
  });

  it('returns env var theme when no URL param', () => {
    expect(resolveThemeId({ searchParam: null, envVar: 'clayton' })).toBe('clayton');
  });

  it('URL param wins over env var', () => {
    expect(resolveThemeId({ searchParam: 'udig', envVar: 'clayton' })).toBe('udig');
  });

  it('falls back to default when URL param is an unknown id', () => {
    expect(resolveThemeId({ searchParam: 'mystery-corp', envVar: undefined })).toBe('udig');
  });

  it('falls back to default when env var is an unknown id', () => {
    expect(resolveThemeId({ searchParam: null, envVar: 'mystery-corp' })).toBe('udig');
  });
});
