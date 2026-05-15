import { writeTokensToRoot } from '@/lib/theme/apply';
import type { Theme } from '@/lib/theme/types';

const sample: Theme = {
  id: 'sample',
  displayName: 'Sample',
  logo: { src: '/x.svg', width: 1, height: 1 },
  brand: { primary: '#112233', accent: '#445566', onPrimary: '#FFFFFF' },
  semantic: { danger: '#FF0000' },
};

describe('writeTokensToRoot', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('style');
    document.documentElement.removeAttribute('data-theme');
  });

  it('sets brand color CSS variables on documentElement', () => {
    writeTokensToRoot(sample);
    const style = document.documentElement.style;
    expect(style.getPropertyValue('--color-brand-primary')).toBe('#112233');
    expect(style.getPropertyValue('--color-brand-accent')).toBe('#445566');
    expect(style.getPropertyValue('--color-brand-on-primary')).toBe('#FFFFFF');
  });

  it('sets the data-theme attribute', () => {
    writeTokensToRoot(sample);
    expect(document.documentElement.getAttribute('data-theme')).toBe('sample');
  });

  it('applies semantic overrides when present', () => {
    writeTokensToRoot(sample);
    expect(document.documentElement.style.getPropertyValue('--color-semantic-danger')).toBe('#FF0000');
  });

  it('leaves semantic vars unset when theme does not override them', () => {
    const noSemantic: Theme = { ...sample, semantic: undefined };
    writeTokensToRoot(noSemantic);
    expect(document.documentElement.style.getPropertyValue('--color-semantic-danger')).toBe('');
  });
});
