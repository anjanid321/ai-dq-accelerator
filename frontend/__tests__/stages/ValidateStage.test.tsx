// frontend/__tests__/stages/ValidateStage.test.tsx
import { render, screen } from '@testing-library/react'
import { ValidateStage } from '@/components/stages/ValidateStage'
import type { SessionState, PerRuleResult } from '@/lib/types'

function makeRule(overrides: Partial<PerRuleResult>): PerRuleResult {
  return {
    id: 'r-default',
    category: 'validity',
    check: 'not_null',
    column: 'col',
    passed: true,
    failure_count: 0,
    failure_rate: 0,
    sample_failing_rows: [],
    rationale: '',
    ...overrides,
  }
}

function makeSession(
  overrides: Partial<SessionState> & {
    validation_results?: SessionState['validation_results']
  } = {},
): SessionState {
  return {
    session_id: 'demo',
    stage: 'VALIDATING',
    profile: {},
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
  } as SessionState
}

describe('ValidateStage', () => {
  it('renders the brand-primary loading state when per_rule is empty', () => {
    render(<ValidateStage session={makeSession()} />)
    const spinner = screen.getByRole('status', { name: /validating/i })
    expect(spinner.classList.contains('border-brand-primary')).toBe(true)
    expect(screen.getByText(/AI is running validation rules/)).toBeInTheDocument()
  })

  it('hides the loading state when per_rule has results', () => {
    render(
      <ValidateStage
        session={makeSession({
          validation_results: {
            per_rule: [makeRule({ id: 'r1', column: 'email', check: 'not_null' })],
            category_scores: {},
            baseline_quality_score: 0,
          },
        })}
      />,
    )
    expect(screen.queryByRole('status', { name: /validating/i })).toBeNull()
    expect(screen.getByText('Validation Results')).toBeInTheDocument()
  })

  it('renders the score header with rounded percent and baseline subline only when different', () => {
    const { rerender } = render(
      <ValidateStage
        session={makeSession({
          baseline_quality_score: 0.78,
          current_score: 0.85,
          validation_results: {
            per_rule: [makeRule({ id: 'r1' })],
            category_scores: {},
            baseline_quality_score: 0.78,
          },
        })}
      />,
    )
    expect(screen.getByText('85')).toBeInTheDocument()
    expect(screen.getByText(/baseline: 78%/)).toBeInTheDocument()

    // Same score = no baseline subline.
    rerender(
      <ValidateStage
        session={makeSession({
          baseline_quality_score: 0.78,
          current_score: 0.78,
          validation_results: {
            per_rule: [makeRule({ id: 'r1' })],
            category_scores: {},
            baseline_quality_score: 0.78,
          },
        })}
      />,
    )
    expect(screen.queryByText(/baseline:/)).toBeNull()
  })

  it('renders the counts row with passed / failed / errored spans in the right tokens', () => {
    render(
      <ValidateStage
        session={makeSession({
          validation_results: {
            per_rule: [
              makeRule({ id: 'p1', passed: true }),
              makeRule({ id: 'p2', passed: true }),
              makeRule({ id: 'f1', passed: false, failure_count: 6, failure_rate: 0.03 }),
              makeRule({ id: 'e1', passed: false, error: 'boom' }),
            ],
            category_scores: {},
            baseline_quality_score: 0,
          },
        })}
      />,
    )
    expect(screen.getByText('2 passed').className).toContain('text-success-deep')
    expect(screen.getByText('1 failed').className).toContain('text-danger-deep')
    expect(screen.getByText('1 errored').className).toContain('text-warning-deep')
    expect(screen.getByText(/of 4 rules/)).toBeInTheDocument()
  })

  it('hides the errored span when there are no eval errors', () => {
    render(
      <ValidateStage
        session={makeSession({
          validation_results: {
            per_rule: [makeRule({ id: 'p1', passed: true })],
            category_scores: {},
            baseline_quality_score: 0,
          },
        })}
      />,
    )
    expect(screen.queryByText(/errored/)).toBeNull()
  })

  it('renders one category pill per category_scores entry, hides the row when empty', () => {
    const { rerender } = render(
      <ValidateStage
        session={makeSession({
          validation_results: {
            per_rule: [makeRule({ id: 'r1' })],
            category_scores: { validity: 0.92, completeness: 1.0, uniqueness: 1.0 },
            baseline_quality_score: 0,
          },
        })}
      />,
    )
    expect(screen.getByText('validity')).toBeInTheDocument()
    expect(screen.getByText('92%')).toBeInTheDocument()
    expect(screen.getByText('completeness')).toBeInTheDocument()
    expect(screen.getAllByText('100%').length).toBeGreaterThanOrEqual(2)

    rerender(
      <ValidateStage
        session={makeSession({
          validation_results: {
            per_rule: [makeRule({ id: 'r1' })],
            category_scores: {},
            baseline_quality_score: 0,
          },
        })}
      />,
    )
    expect(screen.queryByText('validity')).toBeNull()
  })

  it('sections rules Passed → Failed → Errored, with Failed sorted by failure_count desc', () => {
    render(
      <ValidateStage
        session={makeSession({
          validation_results: {
            per_rule: [
              makeRule({ id: 'pass-a', column: 'pass_a', passed: true }),
              makeRule({
                id: 'fail-small', column: 'fail_small', passed: false,
                failure_count: 3, failure_rate: 0.015,
              }),
              makeRule({
                id: 'fail-big', column: 'fail_big', passed: false,
                failure_count: 80, failure_rate: 0.4,
              }),
              makeRule({ id: 'eval-err', column: 'err_col', passed: false, error: 'NameError' }),
              makeRule({ id: 'pass-b', column: 'pass_b', passed: true }),
            ],
            category_scores: {},
            baseline_quality_score: 0,
          },
        })}
      />,
    )
    const columnNodes = screen.getAllByText(/^(pass_a|pass_b|fail_small|fail_big|err_col)$/)
    const order = columnNodes.map((n) => n.textContent)
    // Passed first (mock order), then Failed by failure_count desc, then Errored
    expect(order.slice(0, 2).sort()).toEqual(['pass_a', 'pass_b'])
    expect(order[2]).toBe('fail_big')
    expect(order[3]).toBe('fail_small')
    expect(order[4]).toBe('err_col')
    // Each section's title is rendered with its count
    expect(screen.getByTestId('passed-section')).toHaveTextContent(/Passed Rules.*·.*2/)
    expect(screen.getByTestId('failed-section')).toHaveTextContent(/Failed Rules.*·.*2/)
    expect(screen.getByTestId('errored-section')).toHaveTextContent(/Errored Rules.*·.*1/)
  })

  it('hides empty sections (no Failed/Errored section when every rule passed)', () => {
    render(
      <ValidateStage
        session={makeSession({
          validation_results: {
            per_rule: [
              makeRule({ id: 'r1', column: 'c1', passed: true }),
              makeRule({ id: 'r2', column: 'c2', passed: true }),
            ],
            category_scores: {},
            baseline_quality_score: 0,
          },
        })}
      />,
    )
    expect(screen.getByTestId('passed-section')).toBeInTheDocument()
    expect(screen.queryByTestId('failed-section')).toBeNull()
    expect(screen.queryByTestId('errored-section')).toBeNull()
  })

  it('renders a Failed chip with danger-deep tokens and left-border on a failed rule', () => {
    const { container } = render(
      <ValidateStage
        session={makeSession({
          validation_results: {
            per_rule: [
              makeRule({
                id: 'r1', column: 'email', check: 'regex',
                passed: false, failure_count: 6, failure_rate: 0.03,
              }),
            ],
            category_scores: {},
            baseline_quality_score: 0,
          },
        })}
      />,
    )
    const chip = screen.getByText(/Failed · 6/)
    expect(chip.className).toContain('bg-danger/15')
    expect(chip.className).toContain('text-danger-deep')
    // Card chrome matches the Rules approved/denied pattern: full border +
    // soft ring keyed to the result tone.
    expect(container.querySelector('.border-danger')).not.toBeNull()
    expect(container.querySelector('.ring-danger\\/40')).not.toBeNull()
    expect(screen.getByText('3.0% of rows')).toBeInTheDocument()
  })

  it('renders an Eval Error chip with warning-deep tokens and the error block', () => {
    const { container } = render(
      <ValidateStage
        session={makeSession({
          validation_results: {
            per_rule: [
              makeRule({
                id: 'r1', column: 'custom', check: 'custom_code',
                passed: false, error: 'NameError: foo is not defined',
              }),
            ],
            category_scores: {},
            baseline_quality_score: 0,
          },
        })}
      />,
    )
    const chip = screen.getByText('Eval Error')
    expect(chip.className).toContain('bg-warning/15')
    expect(chip.className).toContain('text-warning-deep')
    expect(container.querySelector('.border-warning')).not.toBeNull()
    expect(container.querySelector('.ring-warning\\/40')).not.toBeNull()
    const errorBlock = screen.getByText(/NameError: foo is not defined/)
    expect(errorBlock.className).toContain('bg-warning/15')
    expect(errorBlock.className).toContain('text-warning-deep')
    expect(errorBlock.className).toContain('font-mono')
  })

  it('renders a Passed chip with success-deep tokens and a success-bordered card', () => {
    const { container } = render(
      <ValidateStage
        session={makeSession({
          validation_results: {
            per_rule: [
              makeRule({
                id: 'r1', column: 'application_id', check: 'unique',
                passed: true,
              }),
            ],
            category_scores: {},
            baseline_quality_score: 0,
          },
        })}
      />,
    )
    const chip = screen.getByText('Passed')
    expect(chip.className).toContain('bg-success/15')
    expect(chip.className).toContain('text-success-deep')
    expect(container.querySelector('.border-success')).not.toBeNull()
    expect(container.querySelector('.ring-success\\/40')).not.toBeNull()
  })

  it('renders sample failing rows for failed rules with sample_failing_rows entries', () => {
    render(
      <ValidateStage
        session={makeSession({
          validation_results: {
            per_rule: [
              makeRule({
                id: 'r1', column: 'email', check: 'regex',
                passed: false, failure_count: 2, failure_rate: 0.01,
                sample_failing_rows: [
                  { email: 'not.an.email', application_id: 'LA-000005' },
                  { email: 'also-bad', application_id: 'LA-000017' },
                ],
              }),
            ],
            category_scores: {},
            baseline_quality_score: 0,
          },
        })}
      />,
    )
    expect(screen.getAllByText('email').length).toBeGreaterThanOrEqual(1) // table header (column name also appears in the rule card)
    expect(screen.getByText('not.an.email')).toBeInTheDocument()
    expect(screen.getByText('also-bad')).toBeInTheDocument()
  })

  it('puts the target column first in the sample-failing-rows header', () => {
    const { container } = render(
      <ValidateStage
        session={makeSession({
          validation_results: {
            per_rule: [
              makeRule({
                id: 'r1', column: 'application_date', check: 'range',
                passed: false, failure_count: 1, failure_rate: 0.005,
                sample_failing_rows: [
                  { application_id: 'LA-000003', application_date: '2030-04-15', credit_score: 720 },
                ],
              }),
            ],
            category_scores: {},
            baseline_quality_score: 0,
          },
        })}
      />,
    )
    const headers = Array.from(container.querySelectorAll('thead th')).map((th) => th.textContent)
    expect(headers[0]).toBe('application_date')
  })

  it('renders both AI prose cards with accent-purple tokens and the ✦ section labels', () => {
    render(
      <ValidateStage
        session={makeSession({
          validation_summary: 'Most rules passed; format issues on email and phone account for the bulk of failures.',
          anomaly_summary: 'Two low-credit APPROVED rows look like data-entry mistakes worth surfacing to the underwriter.',
          validation_results: {
            per_rule: [makeRule({ id: 'r1' })],
            category_scores: {},
            baseline_quality_score: 0,
          },
        })}
      />,
    )
    const validationLabel = screen.getByText('✦ VALIDATION ANALYSIS')
    expect(validationLabel.className).toContain('text-accent-purple-deep')
    const validationBody = screen.getByText(/format issues on email/)
    expect(validationBody.className).toContain('text-accent-purple-deep')

    const anomalyLabel = screen.getByText('✦ ANOMALY ANALYSIS')
    expect(anomalyLabel.className).toContain('text-accent-purple-deep')
    expect(screen.getByText(/data-entry mistakes/)).toBeInTheDocument()
  })

  it('hides each AI prose card independently when its body is empty', () => {
    render(
      <ValidateStage
        session={makeSession({
          validation_summary: 'Only the validation analysis is set.',
          anomaly_summary: '',
          validation_results: {
            per_rule: [makeRule({ id: 'r1' })],
            category_scores: {},
            baseline_quality_score: 0,
          },
        })}
      />,
    )
    expect(screen.getByText('✦ VALIDATION ANALYSIS')).toBeInTheDocument()
    expect(screen.queryByText('✦ ANOMALY ANALYSIS')).toBeNull()
  })

  it('accepts readOnly without crashing — rule list still renders', () => {
    render(
      <ValidateStage
        readOnly
        session={makeSession({
          validation_results: {
            per_rule: [makeRule({ id: 'r1', column: 'email' })],
            category_scores: {},
            baseline_quality_score: 0,
          },
        })}
      />,
    )
    expect(screen.getByText('email')).toBeInTheDocument()
  })
})
