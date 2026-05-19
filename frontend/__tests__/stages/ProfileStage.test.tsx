// frontend/__tests__/stages/ProfileStage.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { ProfileStage } from '@/components/stages/ProfileStage'
import type { SessionState } from '@/lib/types'

function makeSession(overrides: Partial<SessionState> & { profile?: Record<string, unknown> } = {}): SessionState {
  return {
    session_id: 's1',
    stage: 'PROFILING',
    profile: {
      table: { n_rows: 18432, n_columns: 47, p_cells_missing: 0.07 },
      alerts: [],
    },
    ai_summary: '',
    suggested_rules: [],
    baseline_quality_score: 0,
    current_score: 0,
    validation_summary: '',
    anomaly_summary: '',
    transformation_log: [],
    scorecard: {},
    narrative: '',
    output_dir: '',
    zip_path: '',
    ...overrides,
  } as unknown as SessionState
}

describe('ProfileStage', () => {
  it('renders the loading AI summary card when ai_summary is empty', () => {
    render(<ProfileStage session={makeSession()} onContinue={() => {}} />)
    expect(screen.getByText(/AI is analyzing your dataset/)).toBeInTheDocument()
    const spinner = screen.getByRole('status', { name: /analyzing/i })
    expect(spinner.classList.contains('border-brand-primary')).toBe(true)
  })

  it('renders the populated AI summary card when ai_summary is set', () => {
    render(
      <ProfileStage
        session={makeSession({ ai_summary: 'A loan-origination dataset (18,432 rows).' })}
        onContinue={() => {}}
      />,
    )
    expect(screen.getByText(/loan-origination dataset/)).toBeInTheDocument()
    expect(screen.getByText('✦ AI SUMMARY')).toBeInTheDocument()
  })

  it('formats large row counts with thousands separators', () => {
    render(<ProfileStage session={makeSession()} onContinue={() => {}} />)
    expect(screen.getByText('18,432')).toBeInTheDocument()
  })

  it('shows "—" placeholders when table.n_rows / n_columns are missing', () => {
    render(
      <ProfileStage
        session={makeSession({ profile: { table: {}, alerts: [] } })}
        onContinue={() => {}}
      />,
    )
    // Both Rows and Columns tiles render —
    const dashes = screen.getAllByText('—')
    expect(dashes.length).toBeGreaterThanOrEqual(2)
  })

  it('colors completeness success-deep at 93%', () => {
    render(<ProfileStage session={makeSession()} onContinue={() => {}} />)
    const value = screen.getByText('93%')
    expect(value.className).toContain('text-success-deep')
  })

  it('colors completeness warning-deep below 90%', () => {
    render(
      <ProfileStage
        session={makeSession({
          profile: { table: { n_rows: 100, n_columns: 5, p_cells_missing: 0.25 }, alerts: [] },
        })}
        onContinue={() => {}}
      />,
    )
    const value = screen.getByText('75%')
    expect(value.className).toContain('text-warning-deep')
  })

  it('colors the Alerts tile warning-deep when alerts.length > 0', () => {
    render(
      <ProfileStage
        session={makeSession({
          profile: {
            table: { n_rows: 100, n_columns: 5, p_cells_missing: 0 },
            alerts: [{ column: 'email', type: 'Missing', description: 'x' }],
          },
        })}
        onContinue={() => {}}
      />,
    )
    const value = screen.getByText('1')
    expect(value.className).toContain('text-warning-deep')
  })

  it('hides the alerts list when alerts is empty', () => {
    render(<ProfileStage session={makeSession()} onContinue={() => {}} />)
    expect(screen.queryByText(/^Alerts \(/)).toBeNull()
  })

  it('renders one row per alert with column, type, and description', () => {
    render(
      <ProfileStage
        session={makeSession({
          profile: {
            table: { n_rows: 100, n_columns: 5, p_cells_missing: 0 },
            alerts: [
              { column: 'email', type: 'Missing', description: '6.7% missing' },
              { column: 'tenure', type: 'High Cardinality', description: '100% distinct' },
            ],
          },
        })}
        onContinue={() => {}}
      />,
    )
    expect(screen.getByText('Alerts (2)')).toBeInTheDocument()
    expect(screen.getByText('email')).toBeInTheDocument()
    expect(screen.getByText('tenure')).toBeInTheDocument()
    expect(screen.getByText('Missing')).toBeInTheDocument()
    expect(screen.getByText('High Cardinality')).toBeInTheDocument()
    expect(screen.getByText('6.7% missing')).toBeInTheDocument()
    expect(screen.getByText('100% distinct')).toBeInTheDocument()
  })

  it('hides the Continue button when ai_summary is empty (live)', () => {
    render(<ProfileStage session={makeSession()} onContinue={() => {}} />)
    expect(screen.queryByRole('button', { name: /continue to rules/i })).toBeNull()
  })

  it('hides the Continue button in readOnly mode even when ai_summary is set', () => {
    render(
      <ProfileStage
        session={makeSession({ ai_summary: 'done.' })}
        onContinue={() => {}}
        readOnly
      />,
    )
    expect(screen.queryByRole('button', { name: /continue to rules/i })).toBeNull()
  })

  it('renders the Continue button when ai_summary is set and not readOnly', () => {
    render(
      <ProfileStage
        session={makeSession({ ai_summary: 'done.' })}
        onContinue={() => {}}
      />,
    )
    const btn = screen.getByRole('button', { name: /continue to rules/i })
    expect(btn.className).toContain('bg-brand-accent')
    expect(btn.className).toContain('text-on-brand')
  })

  it('fires onContinue when the Continue button is clicked', () => {
    const onContinue = jest.fn()
    render(
      <ProfileStage
        session={makeSession({ ai_summary: 'done.' })}
        onContinue={onContinue}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /continue to rules/i }))
    expect(onContinue).toHaveBeenCalledTimes(1)
  })
})
