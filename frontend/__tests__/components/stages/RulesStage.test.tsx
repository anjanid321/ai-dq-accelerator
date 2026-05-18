import { render, screen, fireEvent, within } from '@testing-library/react'
import { RulesStage } from '@/components/stages/RulesStage'
import type { SessionState, Rule } from '@/lib/types'

jest.mock('@/lib/api', () => ({ approveRules: jest.fn().mockResolvedValue({ accepted: true, message: '' }) }))

function makeRule(id: string, category: string, check: string): Rule {
  return { id, category, check, threshold: 1, modified: false }
}
const rules: Rule[] = [
  makeRule('r1', 'validity',     'email format'),
  makeRule('r2', 'completeness', 'amount not null'),
  makeRule('r3', 'completeness', 'date not null'),
  makeRule('r4', 'uniqueness',   'id unique'),
]
const session = { session_id: 's1', suggested_rules: rules } as unknown as SessionState

describe('RulesStage', () => {
  it('renders one card per rule', () => {
    render(<RulesStage session={session} />)
    expect(document.querySelectorAll('[data-rule-id]').length).toBe(4)
  })

  it('Submit decisions is disabled until every rule is decided', () => {
    render(<RulesStage session={session} />)
    expect(screen.getByTestId('submit-decisions')).toBeDisabled()
    fireEvent.click(screen.getByText(/Approve all/))
    expect(screen.getByTestId('submit-decisions')).not.toBeDisabled()
  })

  it('decision toggle: re-clicking Approve on an approved rule reverts to pending', () => {
    render(<RulesStage session={session} />)
    const card = document.querySelector('[data-rule-id="r1"]')!
    fireEvent.click(within(card as HTMLElement).getByText('Approve'))
    expect(card.getAttribute('data-decision')).toBe('approved')
    fireEvent.click(within(card as HTMLElement).getByText('Approved'))
    expect(card.getAttribute('data-decision')).toBe('pending')
  })

  it('Select mode hides per-row buttons and shows checkboxes; Cancel exits and clears selection', () => {
    render(<RulesStage session={session} />)
    fireEvent.click(screen.getByTestId('select-toggle'))
    // Per-card decision buttons (data-decision="success" lives on the RuleCard buttons) should be gone
    expect(document.querySelector('[data-decision="success"]')).toBeNull()
    expect(screen.getAllByLabelText(/Select rule/).length).toBe(4)
    fireEvent.click(screen.getByLabelText('Select rule r1'))
    fireEvent.click(screen.getByLabelText('Select rule r3'))
    expect(screen.getByText(/2 selected/)).toBeInTheDocument()
    // Click Cancel — exits selection mode entirely
    fireEvent.click(screen.getByTestId('select-toggle'))
    expect(screen.queryByText(/2 selected/)).toBeNull()
    // Re-entering selection mode — selection was cleared
    fireEvent.click(screen.getByTestId('select-toggle'))
    expect(screen.getByText(/0 selected/)).toBeInTheDocument()
  })

  it('bulk Approve sets all selected rules to approved and auto-exits selection mode', () => {
    render(<RulesStage session={session} />)
    fireEvent.click(screen.getByTestId('select-toggle'))
    fireEvent.click(screen.getByLabelText('Select rule r1'))
    fireEvent.click(screen.getByLabelText('Select rule r2'))
    fireEvent.click(screen.getByText(/Approve 2/).closest('button')!)
    expect(document.querySelector('[data-rule-id="r1"]')?.getAttribute('data-decision')).toBe('approved')
    expect(document.querySelector('[data-rule-id="r2"]')?.getAttribute('data-decision')).toBe('approved')
    expect(document.querySelector('[data-rule-id="r3"]')?.getAttribute('data-decision')).toBe('pending')
    // Selection mode auto-exited — bulk action bar is gone
    expect(screen.queryByText(/selected/)).toBeNull()
    // Per-row Approve/Deny back
    expect(document.querySelector('[data-decision="success"]')).not.toBeNull()
  })

  it('bulk Clear reverts decisions of selected rules and auto-exits selection mode', () => {
    render(<RulesStage session={session} />)
    // Pre-approve everything first
    fireEvent.click(screen.getByText(/Approve all/))
    fireEvent.click(screen.getByTestId('select-toggle'))
    fireEvent.click(screen.getByLabelText('Select rule r1'))
    fireEvent.click(screen.getByLabelText('Select rule r2'))
    fireEvent.click(screen.getByText(/Clear 2/).closest('button')!)
    expect(document.querySelector('[data-rule-id="r1"]')?.getAttribute('data-decision')).toBe('pending')
    expect(document.querySelector('[data-rule-id="r2"]')?.getAttribute('data-decision')).toBe('pending')
    expect(document.querySelector('[data-rule-id="r3"]')?.getAttribute('data-decision')).toBe('approved')
    // Selection mode auto-exited
    expect(screen.queryByText(/selected/)).toBeNull()
  })

  it('selection persists across filter changes', () => {
    render(<RulesStage session={session} />)
    fireEvent.click(screen.getByTestId('select-toggle'))
    fireEvent.click(screen.getByLabelText('Select rule r2'))
    expect(screen.getByText(/1 selected/)).toBeInTheDocument()
    fireEvent.click(screen.getByText(/Validity \(1\)/))
    expect(screen.getByText(/1 selected/)).toBeInTheDocument()
    fireEvent.click(screen.getByText(/All \(4\)/))
    expect(screen.getByText(/1 selected/)).toBeInTheDocument()
  })

  it('Approve all hidden in selection mode', () => {
    render(<RulesStage session={session} />)
    expect(screen.getByText(/Approve all/)).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('select-toggle'))
    expect(screen.queryByText(/Approve all/)).toBeNull()
  })
})
