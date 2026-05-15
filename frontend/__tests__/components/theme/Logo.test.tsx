import { render, screen } from '@testing-library/react';
import { Logo } from '@/components/theme/Logo';

const themeLogo = { src: '/logos/x.svg', width: 88, height: 24, alt: 'Acme' };

jest.mock('@/components/theme/useActiveTheme', () => ({
  useActiveTheme: () => ({ logo: themeLogo, displayName: 'Acme' }),
}));

describe('Logo', () => {
  it('renders an image with theme logo src and alt', () => {
    render(<Logo />);
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', '/logos/x.svg');
    expect(img).toHaveAttribute('alt', 'Acme');
  });
});
