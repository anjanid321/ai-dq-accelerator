import { render, screen, fireEvent } from '@testing-library/react'
import { SelectionToolbar } from '@/components/rules/SelectionToolbar'

function setup(overrides = {}) {
  const handlers = {
    onToggleAllVisible: jest.fn(),
    onBulkApprove: jest.fn(),
    onBulkDeny: jest.fn(),
    onBulkClear: jest.fn(),
  }
  render(
    <SelectionToolbar
      selectedCount={2}
      allVisibleSelected={false}
      {...handlers}
      {...overrides}
    />
  )
  return handlers
}

describe('SelectionToolbar', () => {
  it('shows the selected count and per-button counts', () => {
    setup({ selectedCount: 3 })
    expect(screen.getByText(/3 selected/)).toBeInTheDocument()
    expect(screen.getByText(/Approve 3/)).toBeInTheDocument()
    expect(screen.getByText(/Deny 3/)).toBeInTheDocument()
    expect(screen.getByText(/Clear 3/)).toBeInTheDocument()
  })

  it('disables all bulk buttons when selection is empty', () => {
    setup({ selectedCount: 0 })
    expect(screen.getByText(/Approve/).closest('button')).toBeDisabled()
    expect(screen.getByText(/Deny/).closest('button')).toBeDisabled()
    expect(screen.getByText(/Clear/).closest('button')).toBeDisabled()
  })

  it('fires the right callback for each bulk action', () => {
    const h = setup()
    fireEvent.click(screen.getByText(/Approve/).closest('button')!)
    expect(h.onBulkApprove).toHaveBeenCalled()
    fireEvent.click(screen.getByText(/Deny/).closest('button')!)
    expect(h.onBulkDeny).toHaveBeenCalled()
    fireEvent.click(screen.getByText(/Clear/).closest('button')!)
    expect(h.onBulkClear).toHaveBeenCalled()
  })

  it('checking the header checkbox calls onToggleAllVisible', () => {
    const h = setup()
    fireEvent.click(screen.getByLabelText('Select all visible'))
    expect(h.onToggleAllVisible).toHaveBeenCalled()
  })
})
