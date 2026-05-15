import { render, screen } from '@testing-library/react';
import { TopBar } from '@/components/workspace/TopBar';

jest.mock('@/components/theme/Logo', () => ({ Logo: () => <div data-testid="logo" /> }));

describe('TopBar', () => {
  it('renders the app title and filename', () => {
    render(<TopBar filename="sales.csv" />);
    expect(screen.getByText('DQ Accelerator')).toBeInTheDocument();
    expect(screen.getByText('sales.csv')).toBeInTheDocument();
  });

  it('uses success variant when score >= 0.9', () => {
    render(<TopBar filename="x.csv" currentScore={0.92} />);
    const chip = screen.getByText(/Score: 92%/);
    expect(chip.closest('[data-variant]')).toHaveAttribute('data-variant', 'success');
  });

  it('uses warning variant when 0.7 <= score < 0.9', () => {
    render(<TopBar filename="x.csv" currentScore={0.75} />);
    expect(screen.getByText(/Score: 75%/).closest('[data-variant]')).toHaveAttribute('data-variant', 'warning');
  });

  it('uses danger variant when score < 0.7', () => {
    render(<TopBar filename="x.csv" currentScore={0.58} />);
    expect(screen.getByText(/Score: 58%/).closest('[data-variant]')).toHaveAttribute('data-variant', 'danger');
  });

  it('hides chip when no score', () => {
    render(<TopBar filename="x.csv" />);
    expect(screen.queryByText(/Score:/)).toBeNull();
  });

  it('shows row/col metadata when provided', () => {
    render(<TopBar filename="x.csv" rowCount={18432} colCount={47} />);
    expect(screen.getByText(/18,432 rows/)).toBeInTheDocument();
  });
});
