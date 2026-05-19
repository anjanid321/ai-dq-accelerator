// frontend/__tests__/components/ai-panel/ScrollToLatestPill.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { ScrollToLatestPill } from '@/components/ai-panel/ScrollToLatestPill'

describe('ScrollToLatestPill', () => {
  it('renders "Scroll to bottom" when unreadCount is 0', () => {
    render(<ScrollToLatestPill unreadCount={0} onClick={() => {}} />)
    expect(screen.getByRole('button', { name: /scroll to bottom/i })).toBeInTheDocument()
  })

  it('renders "<N> new" when unreadCount is positive', () => {
    render(<ScrollToLatestPill unreadCount={3} onClick={() => {}} />)
    expect(screen.getByRole('button', { name: /3 new/i })).toBeInTheDocument()
  })

  it('uses the primary-button token styling (bg-brand-accent + text-on-brand)', () => {
    render(<ScrollToLatestPill unreadCount={0} onClick={() => {}} />)
    const btn = screen.getByRole('button')
    expect(btn.classList.contains('bg-brand-accent')).toBe(true)
    expect(btn.classList.contains('text-on-brand')).toBe(true)
  })

  it('declares an aria-live region so the unread count is announced', () => {
    render(<ScrollToLatestPill unreadCount={3} onClick={() => {}} />)
    const btn = screen.getByRole('button')
    expect(btn.getAttribute('aria-live')).toBe('polite')
  })

  it('fires onClick when activated', () => {
    const onClick = jest.fn()
    render(<ScrollToLatestPill unreadCount={2} onClick={onClick} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
