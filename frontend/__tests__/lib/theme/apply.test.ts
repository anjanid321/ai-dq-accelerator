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

  it('writes brand colors as RGB triplets (Tailwind alpha-channel compatible)', () => {
    writeTokensToRoot(sample);
    const style = document.documentElement.style;
    expect(style.getPropertyValue('--color-brand-primary')).toBe('17 34 51');         // #112233
    expect(style.getPropertyValue('--color-brand-accent')).toBe('68 85 102');         // #445566
    expect(style.getPropertyValue('--color-brand-on-primary')).toBe('255 255 255');   // #FFFFFF
  });

  it('sets the data-theme attribute', () => {
    writeTokensToRoot(sample);
    expect(document.documentElement.getAttribute('data-theme')).toBe('sample');
  });

  it('applies semantic overrides as RGB triplets', () => {
    writeTokensToRoot(sample);
    expect(document.documentElement.style.getPropertyValue('--color-semantic-danger')).toBe('255 0 0'); // #FF0000
  });

  it('leaves semantic vars unset when theme does not override them', () => {
    const noSemantic: Theme = { ...sample, semantic: undefined };
    writeTokensToRoot(noSemantic);
    expect(document.documentElement.style.getPropertyValue('--color-semantic-danger')).toBe('');
  });
});
