// frontend/__tests__/stages/_profile/AlertRow.test.tsx
import { render, screen } from '@testing-library/react'
import { AlertRow } from '@/components/stages/_profile/AlertRow'

describe('AlertRow', () => {
  it('renders column name, type chip, and description', () => {
    render(
      <AlertRow
        alert={{
          column: 'co_signer_ssn',
          type: 'Missing',
          description: '7,617 (41%) values missing — column may be optional.',
        }}
      />,
    )
    expect(screen.getByText('co_signer_ssn')).toBeInTheDocument()
    expect(screen.getByText('Missing')).toBeInTheDocument()
    expect(screen.getByText(/7,617/)).toBeInTheDocument()
  })

  it('uses the warning bucket for Missing alerts', () => {
    render(<AlertRow alert={{ column: 'email', type: 'Missing', description: 'x' }} />)
    const chip = screen.getByText('Missing')
    expect(chip.className).toContain('text-warning-deep')
    expect(chip.className).toContain('bg-warning/15')
  })

  it('uses the info bucket for High Cardinality alerts', () => {
    render(<AlertRow alert={{ column: 'tenure', type: 'High Cardinality', description: 'x' }} />)
    expect(screen.getByText('High Cardinality').className).toContain('text-info-deep')
  })

  it('falls back to "Table-level" when the alert has no column', () => {
    render(<AlertRow alert={{ type: 'Duplicates', description: '42 duplicate rows' }} />)
    expect(screen.getByText('Table-level')).toBeInTheDocument()
  })

  it('hides the chip when the alert has no type', () => {
    render(<AlertRow alert={{ column: 'foo', description: 'something happened' }} />)
    expect(screen.getByText('foo')).toBeInTheDocument()
    // No chip should be rendered when type is absent.
    expect(screen.queryByText(/Missing|Constant|High Cardinality|Duplicates|Skewness/)).toBeNull()
  })

  it('hides the description paragraph when the alert has no description', () => {
    const { container } = render(<AlertRow alert={{ column: 'foo', type: 'Missing' }} />)
    expect(container.querySelector('p')).toBeNull()
  })

  it('renders as a <li> so it can be a flex-column child of a <ul>', () => {
    const { container } = render(<AlertRow alert={{ column: 'x', type: 'Missing', description: 'y' }} />)
    expect(container.firstChild?.nodeName).toBe('LI')
  })
})
