// frontend/__tests__/stages/TriageStage.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TriageStage } from '@/components/stages/TriageStage'
import type { SessionState, TriageClassification, TriageResult } from '@/lib/types'
import { approveTriage } from '@/lib/api'

jest.mock('@/lib/api', () => ({
  approveTriage: jest.fn(),
}))

const approveTriageMock = approveTriage as jest.MockedFunction<typeof approveTriage>

function makeClassification(overrides: Partial<TriageClassification>): TriageClassification {
  return {
    rule_id: 'r-default',
    check: 'not_null',
    column: 'col',
    classification: 'threshold_too_strict',
    proposed_threshold: 0.97,
    proposed_remove: false,
    reason: 'reason placeholder',
    confidence: 'high',
    ...overrides,
  }
}

function makeTriageResult(
  classifications: TriageClassification[],
): TriageResult {
  const summary = {
    transform_fixable: classifications.filter(c => c.classification === 'transform_fixable').length,
    threshold_too_strict: classifications.filter(c => c.classification === 'threshold_too_strict').length,
    unfixable: classifications.filter(c => c.classification === 'unfixable').length,
    eval_error: classifications.filter(c => c.classification === 'eval_error').length,
  }
  return { classifications, summary }
}

function makeSession(
  overrides: Partial<SessionState> & { triage_result?: TriageResult } = {},
): SessionState {
  return {
    session_id: 'demo',
    stage: 'AWAITING_TRIAGE_APPROVAL',
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

describe('TriageStage', () => {
  beforeEach(() => {
    approveTriageMock.mockReset()
  })

  it('renders the brand-primary loading state when stage=TRIAGING', () => {
    render(<TriageStage session={makeSession({ stage: 'TRIAGING' })} />)
    const spinner = screen.getByRole('status', { name: /triaging/i })
    expect(spinner.classList.contains('border-brand-primary')).toBe(true)
    expect(screen.getByText(/investigating failing rules/i)).toBeInTheDocument()
    expect(screen.queryByText('Triage Results')).toBeNull()
  })

  it('renders the loading state when triage_result is missing (even if stage advanced)', () => {
    render(<TriageStage session={makeSession({ stage: 'AWAITING_TRIAGE_APPROVAL' })} />)
    expect(screen.getByRole('status', { name: /triaging/i })).toBeInTheDocument()
  })

  it('renders the header block when triage_result is present', () => {
    render(
      <TriageStage
        session={makeSession({
          triage_result: makeTriageResult([
            makeClassification({ rule_id: 'r1' }),
          ]),
        })}
      />,
    )
    expect(screen.getByRole('heading', { name: 'Triage Results' })).toBeInTheDocument()
    expect(screen.getByText(/AI's classification of every failing rule/i)).toBeInTheDocument()
  })

  it('renders only non-zero summary categories with Title Case labels and full-alpha dots', () => {
    const { container } = render(
      <TriageStage
        session={makeSession({
          triage_result: makeTriageResult([
            makeClassification({ rule_id: 'tf-1', classification: 'transform_fixable', proposed_remove: false }),
            makeClassification({ rule_id: 'tt-1', classification: 'threshold_too_strict' }),
            makeClassification({ rule_id: 'tt-2', classification: 'threshold_too_strict' }),
            makeClassification({ rule_id: 'un-1', classification: 'unfixable', proposed_remove: true }),
          ]),
        })}
      />,
    )
    expect(screen.getByText('1 Transform Fixable')).toBeInTheDocument()
    expect(screen.getByText('2 Threshold Too Strict')).toBeInTheDocument()
    expect(screen.getByText('1 Unfixable')).toBeInTheDocument()
    expect(screen.queryByText(/Eval Error/)).toBeNull()
    // Full-alpha foundation tokens, no /60 alpha suffix
    expect(container.querySelector('.bg-success.shrink-0')).not.toBeNull()
    expect(container.querySelector('.bg-warning.shrink-0')).not.toBeNull()
    expect(container.querySelector('.bg-danger.shrink-0')).not.toBeNull()
    expect(container.querySelector('.bg-success\\/60')).toBeNull()
    expect(container.querySelector('.bg-red-500\\/60')).toBeNull()
    expect(container.querySelector('.bg-amber-500\\/60')).toBeNull()
  })

  it('renders classification chips with the Chip primitive Title Case labels per tone', () => {
    render(
      <TriageStage
        session={makeSession({
          triage_result: makeTriageResult([
            makeClassification({ rule_id: 'tf', classification: 'transform_fixable', proposed_remove: false }),
            makeClassification({ rule_id: 'tts', classification: 'threshold_too_strict' }),
            makeClassification({ rule_id: 'un', classification: 'unfixable', proposed_remove: true }),
            makeClassification({ rule_id: 'ee', classification: 'eval_error', proposed_remove: true }),
          ]),
        })}
      />,
    )
    const tf = screen.getByText('Transform Fixable', { selector: 'span' })
    expect(tf.className).toContain('bg-success/15')
    expect(tf.className).toContain('text-success-deep')

    const tts = screen.getByText('Threshold Too Strict', { selector: 'span' })
    expect(tts.className).toContain('bg-warning/15')
    expect(tts.className).toContain('text-warning-deep')

    const un = screen.getByText('Unfixable', { selector: 'span' })
    expect(un.className).toContain('bg-danger/15')
    expect(un.className).toContain('text-danger-deep')

    const ee = screen.getByText('Eval Error', { selector: 'span' })
    expect(ee.className).toContain('bg-warning/15')
    expect(ee.className).toContain('text-warning-deep')
  })

  it('renders confidence as a Chip with success/warning/neutral tone per level', () => {
    render(
      <TriageStage
        session={makeSession({
          triage_result: makeTriageResult([
            makeClassification({ rule_id: 'h', confidence: 'high' }),
            makeClassification({ rule_id: 'm', confidence: 'medium' }),
            makeClassification({ rule_id: 'l', confidence: 'low' }),
          ]),
        })}
      />,
    )
    const high = screen.getByText('High Confidence', { selector: 'span' })
    expect(high.className).toContain('bg-success/15')
    expect(high.className).toContain('text-success-deep')
    const medium = screen.getByText('Medium Confidence', { selector: 'span' })
    expect(medium.className).toContain('bg-warning/15')
    expect(medium.className).toContain('text-warning-deep')
    const low = screen.getByText('Low Confidence', { selector: 'span' })
    expect(low.className).toContain('bg-fg-subtle/15')
    expect(low.className).toContain('text-fg-muted')
  })

  it('TriageCard for transform_fixable renders "(no decision required)" and no Accept/Keep buttons', () => {
    render(
      <TriageStage
        session={makeSession({
          triage_result: makeTriageResult([
            makeClassification({
              rule_id: 'tf1',
              classification: 'transform_fixable',
              proposed_remove: false,
              proposed_threshold: undefined,
              reason: 'A transform can fix this automatically.',
            }),
          ]),
        })}
      />,
    )
    expect(screen.getByText('(no decision required)')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Accept/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Keep/ })).toBeNull()
  })

  it('renders the threshold Proposed line with text-warning-deep on threshold_too_strict cards', () => {
    render(
      <TriageStage
        session={makeSession({
          triage_result: makeTriageResult([
            makeClassification({
              rule_id: 'tts1',
              classification: 'threshold_too_strict',
              proposed_threshold: 0.97,
              proposed_remove: false,
            }),
          ]),
        })}
      />,
    )
    const proposedValue = screen.getByText('97.00%')
    expect(proposedValue.className).toContain('text-warning-deep')
    expect(proposedValue.className).toContain('font-semibold')
  })

  it('renders the "remove rule" Proposed line with text-danger-deep on unfixable cards', () => {
    render(
      <TriageStage
        session={makeSession({
          triage_result: makeTriageResult([
            makeClassification({
              rule_id: 'un1',
              classification: 'unfixable',
              proposed_remove: true,
              proposed_threshold: undefined,
            }),
          ]),
        })}
      />,
    )
    const removeText = screen.getByText('remove rule')
    expect(removeText.className).toContain('text-danger-deep')
    expect(removeText.className).toContain('font-semibold')
  })

  it('starts every actionable card in the pending chrome (border-border, no ring)', () => {
    const { container } = render(
      <TriageStage
        session={makeSession({
          triage_result: makeTriageResult([
            makeClassification({
              rule_id: 'tts1',
              classification: 'threshold_too_strict',
              proposed_threshold: 0.97,
              proposed_remove: false,
            }),
          ]),
        })}
      />,
    )
    const card = container.querySelector('[data-triage-card="tts1"]')
    expect(card).not.toBeNull()
    expect(card!.className).toContain('border-border')
    expect(card!.className).not.toContain('ring-1')
    expect(card!.className).not.toContain('border-success')
    expect(card!.className).not.toContain('border-danger')
  })

  it('clicking Accept toggles the card to border-success ring-1 ring-success/40 and the Accept button to active deep-fill', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <TriageStage
        session={makeSession({
          triage_result: makeTriageResult([
            makeClassification({
              rule_id: 'tts1',
              classification: 'threshold_too_strict',
              proposed_threshold: 0.97,
              proposed_remove: false,
            }),
          ]),
        })}
      />,
    )
    const acceptBtn = screen.getByRole('button', { name: /Accept Change/i })
    await user.click(acceptBtn)
    const card = container.querySelector('[data-triage-card="tts1"]')!
    expect(card.className).toContain('border-success')
    expect(card.className).toContain('ring-1')
    expect(card.className).toContain('ring-success/40')
    // Active Accept button: deep fill
    expect(acceptBtn.className).toContain('bg-success-deep')
    expect(acceptBtn.className).toContain('text-on-brand')
  })

  it('clicking Keep toggles the card to border-danger ring-1 ring-danger/40 and the Keep button to active deep-fill', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <TriageStage
        session={makeSession({
          triage_result: makeTriageResult([
            makeClassification({
              rule_id: 'un1',
              classification: 'unfixable',
              proposed_remove: true,
              proposed_threshold: undefined,
            }),
          ]),
        })}
      />,
    )
    const keepBtn = screen.getByRole('button', { name: /Keep Rule/i })
    await user.click(keepBtn)
    const card = container.querySelector('[data-triage-card="un1"]')!
    expect(card.className).toContain('border-danger')
    expect(card.className).toContain('ring-1')
    expect(card.className).toContain('ring-danger/40')
    expect(keepBtn.className).toContain('bg-danger-deep')
    expect(keepBtn.className).toContain('text-on-brand')
  })

  it('clicking an active Accept again returns the card to pending', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <TriageStage
        session={makeSession({
          triage_result: makeTriageResult([
            makeClassification({
              rule_id: 'tts1',
              classification: 'threshold_too_strict',
              proposed_threshold: 0.97,
              proposed_remove: false,
            }),
          ]),
        })}
      />,
    )
    const acceptBtn = screen.getByRole('button', { name: /Accept Change/i })
    await user.click(acceptBtn)
    await user.click(acceptBtn)
    const card = container.querySelector('[data-triage-card="tts1"]')!
    expect(card.className).toContain('border-border')
    expect(card.className).not.toContain('border-success')
    expect(card.className).not.toContain('ring-1')
  })

  it('filter tabs: clicking Needs Decision hides transform_fixable cards; All restores them', async () => {
    const user = userEvent.setup()
    render(
      <TriageStage
        session={makeSession({
          triage_result: makeTriageResult([
            makeClassification({
              rule_id: 'tf1', classification: 'transform_fixable',
              proposed_remove: false, proposed_threshold: undefined,
            }),
            makeClassification({
              rule_id: 'tts1', classification: 'threshold_too_strict',
              proposed_threshold: 0.97, proposed_remove: false,
            }),
          ]),
        })}
      />,
    )
    expect(screen.getByText('tf1')).toBeInTheDocument()
    expect(screen.getByText('tts1')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^Needs Decision$/ }))
    expect(screen.queryByText('tf1')).toBeNull()
    expect(screen.getByText('tts1')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^All$/ }))
    expect(screen.getByText('tf1')).toBeInTheDocument()
    expect(screen.getByText('tts1')).toBeInTheDocument()
  })

  it('filter tabs adopt the Rules-style vocabulary (active: border-brand-primary + text-fg + font-semibold; inactive: border-border-strong + text-fg-muted)', () => {
    render(
      <TriageStage
        session={makeSession({
          triage_result: makeTriageResult([makeClassification({ rule_id: 'r1' })]),
        })}
      />,
    )
    const allBtn = screen.getByRole('button', { name: /^All$/ })
    expect(allBtn.className).toContain('border-brand-primary')
    expect(allBtn.className).toContain('text-fg')
    expect(allBtn.className).toContain('font-semibold')
    const fixableBtn = screen.getByRole('button', { name: /^Fixable$/ })
    expect(fixableBtn.className).toContain('bg-surface')
    expect(fixableBtn.className).toContain('border-border-strong')
    expect(fixableBtn.className).toContain('text-fg-muted')
  })

  it('footer tally shows Accepted/Kept/Pending counts and disables submit while Pending > 0', () => {
    render(
      <TriageStage
        session={makeSession({
          triage_result: makeTriageResult([
            makeClassification({
              rule_id: 'tts1', classification: 'threshold_too_strict',
              proposed_threshold: 0.97, proposed_remove: false,
            }),
            makeClassification({
              rule_id: 'tts2', classification: 'threshold_too_strict',
              proposed_threshold: 0.99, proposed_remove: false,
            }),
          ]),
        })}
      />,
    )
    const footer = screen.getByTestId('triage-footer')
    expect(footer).toHaveTextContent(/0 Accepted/)
    expect(footer).toHaveTextContent(/0 Kept/)
    expect(footer).toHaveTextContent(/2 Pending/)
    const submit = screen.getByTestId('apply-triage-decisions')
    expect(submit).toBeDisabled()
  })

  it('footer tally updates as decisions are made; submit enables once Pending hits 0', async () => {
    const user = userEvent.setup()
    render(
      <TriageStage
        session={makeSession({
          triage_result: makeTriageResult([
            makeClassification({
              rule_id: 'tts1', classification: 'threshold_too_strict',
              proposed_threshold: 0.97, proposed_remove: false,
            }),
            makeClassification({
              rule_id: 'un1', classification: 'unfixable',
              proposed_remove: true, proposed_threshold: undefined,
            }),
          ]),
        })}
      />,
    )
    await user.click(screen.getByRole('button', { name: /Accept Change/i }))
    await user.click(screen.getByRole('button', { name: /Keep Rule/i }))
    const footer = screen.getByTestId('triage-footer')
    expect(footer).toHaveTextContent(/1 Accepted/)
    expect(footer).toHaveTextContent(/1 Kept/)
    expect(footer).toHaveTextContent(/0 Pending/)
    expect(screen.getByTestId('apply-triage-decisions')).not.toBeDisabled()
  })

  it('submit button uses bg-brand-accent + text-on-brand (navy CTA, not orange)', () => {
    render(
      <TriageStage
        session={makeSession({
          triage_result: makeTriageResult([
            makeClassification({
              rule_id: 'tts1', classification: 'threshold_too_strict',
              proposed_threshold: 0.97, proposed_remove: false,
            }),
          ]),
        })}
      />,
    )
    const submit = screen.getByRole('button', { name: /Apply Triage Decisions/i })
    expect(submit.className).toContain('bg-brand-accent')
    expect(submit.className).toContain('text-on-brand')
    expect(submit.className).not.toContain('bg-indigo')
  })

  it('clicking submit calls approveTriage with the expected payload shape', async () => {
    approveTriageMock.mockResolvedValue(undefined as never)
    const user = userEvent.setup()
    render(
      <TriageStage
        session={makeSession({
          session_id: 'sess-1',
          triage_result: makeTriageResult([
            makeClassification({
              rule_id: 'tts1', classification: 'threshold_too_strict',
              proposed_threshold: 0.97, proposed_remove: false,
            }),
            makeClassification({
              rule_id: 'un1', classification: 'unfixable',
              proposed_remove: true, proposed_threshold: undefined,
            }),
            makeClassification({
              rule_id: 'tts2', classification: 'threshold_too_strict',
              proposed_threshold: 0.99, proposed_remove: false,
            }),
          ]),
        })}
      />,
    )
    await user.click(screen.getAllByRole('button', { name: /Accept Change/i })[0])  // tts1 accepted
    await user.click(screen.getByRole('button', { name: /Accept Removal/i }))       // un1 accepted (remove)
    await user.click(screen.getAllByRole('button', { name: /Keep Original/i })[1])  // tts2 kept
    await user.click(screen.getByRole('button', { name: /Apply Triage Decisions/i }))
    expect(approveTriageMock).toHaveBeenCalledWith(
      'sess-1',
      [{ rule_id: 'tts1', new_threshold: 0.97 }],
      ['un1'],
    )
  })

  it('renders the error banner with bg-danger/15 + border-danger/30 + text-danger-deep when approveTriage rejects', async () => {
    approveTriageMock.mockRejectedValue(new Error('boom — server down'))
    const user = userEvent.setup()
    render(
      <TriageStage
        session={makeSession({
          triage_result: makeTriageResult([
            makeClassification({
              rule_id: 'tts1', classification: 'threshold_too_strict',
              proposed_threshold: 0.97, proposed_remove: false,
            }),
          ]),
        })}
      />,
    )
    await user.click(screen.getByRole('button', { name: /Accept Change/i }))
    await user.click(screen.getByRole('button', { name: /Apply Triage Decisions/i }))
    const banner = await screen.findByText(/boom — server down/)
    expect(banner.className).toContain('bg-danger/15')
    expect(banner.className).toContain('border-danger/30')
    expect(banner.className).toContain('text-danger-deep')
  })

  it('readOnly hides decision buttons, the "(no decision required)" note, and the submit bar', () => {
    render(
      <TriageStage
        readOnly
        session={makeSession({
          triage_result: makeTriageResult([
            makeClassification({
              rule_id: 'tts1', classification: 'threshold_too_strict',
              proposed_threshold: 0.97, proposed_remove: false,
            }),
            makeClassification({
              rule_id: 'tf1', classification: 'transform_fixable',
              proposed_remove: false, proposed_threshold: undefined,
            }),
          ]),
        })}
      />,
    )
    expect(screen.queryByRole('button', { name: /Accept/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Keep/ })).toBeNull()
    expect(screen.queryByText('(no decision required)')).toBeNull()
    expect(screen.queryByRole('button', { name: /Apply Triage Decisions/i })).toBeNull()
    // But cards still render — rule_ids visible
    expect(screen.getByText('tts1')).toBeInTheDocument()
    expect(screen.getByText('tf1')).toBeInTheDocument()
  })

  it('hides the submit bar when there are no actionable cards (transform_fixable-only result)', () => {
    render(
      <TriageStage
        session={makeSession({
          triage_result: makeTriageResult([
            makeClassification({
              rule_id: 'tf1', classification: 'transform_fixable',
              proposed_remove: false, proposed_threshold: undefined,
            }),
            makeClassification({
              rule_id: 'tf2', classification: 'transform_fixable',
              proposed_remove: false, proposed_threshold: undefined,
            }),
          ]),
        })}
      />,
    )
    expect(screen.queryByRole('button', { name: /Apply Triage Decisions/i })).toBeNull()
    expect(screen.queryByText(/rules need a decision/)).toBeNull()
    expect(screen.queryByText(/All decisions made/)).toBeNull()
  })
})
