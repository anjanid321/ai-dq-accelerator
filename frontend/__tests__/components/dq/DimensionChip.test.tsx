import { render, screen } from '@testing-library/react'
import { DimensionChip } from '@/components/dq/DimensionChip'

describe('DimensionChip', () => {
  it('renders the capitalized label for a known dimension', () => {
    render(<DimensionChip dimension="validity" />)
    expect(screen.getByText('Validity')).toBeInTheDocument()
  })

  it('renders the capitalized input for an unknown dimension', () => {
    render(<DimensionChip dimension="timeliness" />)
    expect(screen.getByText('Timeliness')).toBeInTheDocument()
  })

  it('exposes data-dimension attribute (lowercase) for selection in tests', () => {
    render(<DimensionChip dimension="Completeness" />)
    expect(screen.getByText('Completeness')).toHaveAttribute('data-dimension', 'completeness')
  })
})
