import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@/components/theme/ThemeProvider';

describe('ThemeProvider', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('style');
  });

  it('renders children', () => {
    render(
      <ThemeProvider initialClient={null}>
        <div>hello</div>
      </ThemeProvider>
    );
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('sets data-theme=udig by default', () => {
    render(
      <ThemeProvider initialClient={null}>
        <span />
      </ThemeProvider>
    );
    expect(document.documentElement.getAttribute('data-theme')).toBe('udig');
  });

  it('honors initialClient prop', () => {
    render(
      <ThemeProvider initialClient="clayton">
        <span />
      </ThemeProvider>
    );
    expect(document.documentElement.getAttribute('data-theme')).toBe('clayton');
  });
});
