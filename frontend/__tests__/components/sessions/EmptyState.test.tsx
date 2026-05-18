import { render, screen, fireEvent } from '@testing-library/react'
import { EmptyState } from '@/components/sessions/EmptyState'

describe('EmptyState', () => {
  it('renders the headline and body copy', () => {
    render(<EmptyState onUpload={() => {}} />)
    expect(screen.getByText('Start your first data quality session')).toBeInTheDocument()
    expect(screen.getByText(/Upload a CSV, Parquet, or JSON file/)).toBeInTheDocument()
  })

  it('fires onUpload when the CTA is clicked', () => {
    const onUpload = jest.fn()
    render(<EmptyState onUpload={onUpload} />)
    fireEvent.click(screen.getByTestId('empty-state-upload'))
    expect(onUpload).toHaveBeenCalledTimes(1)
  })
})
