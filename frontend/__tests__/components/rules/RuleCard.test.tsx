import { render, screen, fireEvent } from '@testing-library/react'
import { RuleCard } from '@/components/rules/RuleCard'
import type { Rule } from '@/lib/types'

const sample: Rule = {
  id: 'r1',
  category: 'validity',
  check: 'email matches regex',
  column: 'customer_email',
  rationale: 'standard format',
  threshold: 1,
  modified: false,
}

function setup(overrides: Partial<Parameters<typeof RuleCard>[0]> = {}) {
  const handlers = {
    onDecide: jest.fn(),
    onToggleSelect: jest.fn(),
    onEditOpen: jest.fn(),
    onEditClose: jest.fn(),
    onEditChange: jest.fn(),
    onSaveAndApprove: jest.fn(),
  }
  render(
    <RuleCard
      rule={sample}
      decision="pending"
      edit={{}}
      isEditing={false}
      isSelectionMode={false}
      isSelected={false}
      {...handlers}
      {...overrides}
    />
  )
  return handlers
}

describe('RuleCard', () => {
  it('renders Approve and Deny buttons in default (non-selection) mode', () => {
    setup()
    expect(screen.getByText('Approve')).toBeInTheDocument()
    expect(screen.getByText('Deny')).toBeInTheDocument()
  })

  it('clicking Approve when pending fires onDecide("approved")', () => {
    const h = setup({ decision: 'pending' })
    fireEvent.click(screen.getByText('Approve'))
    expect(h.onDecide).toHaveBeenCalledWith('approved')
  })

  it('clicking Approve when already approved reverts to pending', () => {
    const h = setup({ decision: 'approved' })
    fireEvent.click(screen.getByText('Approved'))
    expect(h.onDecide).toHaveBeenCalledWith('pending')
  })

  it('clicking Deny when already denied reverts to pending', () => {
    const h = setup({ decision: 'denied' })
    fireEvent.click(screen.getByText('Denied'))
    expect(h.onDecide).toHaveBeenCalledWith('pending')
  })

  it('hides decision buttons and shows checkbox in selection mode', () => {
    setup({ isSelectionMode: true })
    expect(screen.queryByText('Approve')).toBeNull()
    expect(screen.queryByText('Deny')).toBeNull()
    expect(screen.getByLabelText(/Select rule r1/)).toBeInTheDocument()
  })

  it('clicking the checkbox calls onToggleSelect', () => {
    const h = setup({ isSelectionMode: true })
    fireEvent.click(screen.getByLabelText(/Select rule r1/))
    expect(h.onToggleSelect).toHaveBeenCalledTimes(1)
  })

  it('Edit button is visible when not editing', () => {
    setup({ isEditing: false })
    expect(screen.getByText('Edit')).toBeInTheDocument()
  })

  it('Edit button is hidden and inline editor renders when isEditing is true', () => {
    setup({ isEditing: true })
    expect(screen.queryByText('Edit')).toBeNull()
    expect(screen.getByText('Modify Rule')).toBeInTheDocument()
    // Editor exposes Cancel + Save & Approve in lieu of the Edit toggle
    expect(screen.getByText('Cancel')).toBeInTheDocument()
    expect(screen.getByText('Save & Approve')).toBeInTheDocument()
  })
})
