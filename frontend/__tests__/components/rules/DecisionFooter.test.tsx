import { render, screen, fireEvent } from '@testing-library/react'
import { DecisionFooter } from '@/components/rules/DecisionFooter'

describe('DecisionFooter', () => {
  it('disables submit when there are undecided rules', () => {
    render(<DecisionFooter approved={2} denied={1} undecided={3} submitting={false} onSubmit={jest.fn()} />)
    expect(screen.getByTestId('submit-decisions')).toBeDisabled()
  })

  it('enables submit when all decided', () => {
    render(<DecisionFooter approved={2} denied={1} undecided={0} submitting={false} onSubmit={jest.fn()} />)
    expect(screen.getByTestId('submit-decisions')).not.toBeDisabled()
  })

  it('shows the submitting label and disables when submitting', () => {
    render(<DecisionFooter approved={2} denied={1} undecided={0} submitting={true} onSubmit={jest.fn()} />)
    expect(screen.getByText('Submitting…')).toBeInTheDocument()
    expect(screen.getByTestId('submit-decisions')).toBeDisabled()
  })

  it('fires onSubmit when clicked', () => {
    const onSubmit = jest.fn()
    render(<DecisionFooter approved={2} denied={1} undecided={0} submitting={false} onSubmit={onSubmit} />)
    fireEvent.click(screen.getByTestId('submit-decisions'))
    expect(onSubmit).toHaveBeenCalled()
  })
})
