// frontend/__tests__/stages/LoadingStage.test.tsx
import { render, screen } from '@testing-library/react'
import { LoadingStage } from '@/components/stages/LoadingStage'

describe('LoadingStage', () => {
  it('renders the loading copy with a real ellipsis character', () => {
    render(<LoadingStage />)
    expect(screen.getByText('Loading your dataset…')).toBeInTheDocument()
  })

  it('exposes the spinner as an aria-live status with the brand-primary border', () => {
    render(<LoadingStage />)
    const spinner = screen.getByRole('status', { name: /loading/i })
    expect(spinner.classList.contains('border-brand-primary')).toBe(true)
    expect(spinner.classList.contains('border-t-transparent')).toBe(true)
    expect(spinner.classList.contains('animate-spin')).toBe(true)
  })

  it('uses the foundation fg-muted token on the wrapper, not the legacy text-text-muted', () => {
    const { container } = render(<LoadingStage />)
    const wrapper = container.firstChild as HTMLElement
    expect(wrapper.classList.contains('text-fg-muted')).toBe(true)
    expect(wrapper.classList.contains('text-text-muted')).toBe(false)
  })
})
