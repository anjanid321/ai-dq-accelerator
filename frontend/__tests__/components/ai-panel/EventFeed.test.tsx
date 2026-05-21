// frontend/__tests__/components/ai-panel/EventFeed.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { EventFeed } from '@/components/ai-panel/EventFeed'
import type { AIEvent } from '@/hooks/useAIStream'

function ev(event: AIEvent['event'], extras: Partial<AIEvent> = {}): AIEvent {
  return { event, ts: Date.now(), ...extras } as AIEvent
}

describe('EventFeed', () => {
  it('renders a card per event', () => {
    const events: AIEvent[] = [
      ev('tool_call', { tool: 'read_file' }),
      ev('tool_result', { tool: 'read_file', preview: '47 columns' }),
      ev('thinking', { content: 'Validating column types.' }),
    ]
    render(<EventFeed events={events} />)
    expect(screen.getByText('Tool Call')).toBeInTheDocument()
    expect(screen.getByText('Result')).toBeInTheDocument()
    expect(screen.getByText('Thinking')).toBeInTheDocument()
  })

  it('does not show the scroll-to-latest pill while pinned to the bottom', () => {
    // jsdom default geometry: scrollHeight === clientHeight === 0 → pinned.
    const events: AIEvent[] = [ev('tool_call', { tool: 'read_file' })]
    render(<EventFeed events={events} />)
    expect(screen.queryByRole('button', { name: /scroll to bottom|new/i })).toBeNull()
  })

  it('shows the pill once the user scrolls up past the threshold', () => {
    const events: AIEvent[] = [ev('tool_call', { tool: 'read_file' })]
    const { container } = render(<EventFeed events={events} />)
    const scroller = container.querySelector('[data-testid="event-feed-scroller"]') as HTMLElement

    // Stage a lifted geometry then fire scroll.
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, get: () => 1000 })
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, get: () => 400 })
    Object.defineProperty(scroller, 'scrollTop', {
      configurable: true,
      get: () => 0,
      set: () => {},
    })
    fireEvent.scroll(scroller)

    expect(screen.getByRole('button', { name: /scroll to bottom/i })).toBeInTheDocument()
  })
})
