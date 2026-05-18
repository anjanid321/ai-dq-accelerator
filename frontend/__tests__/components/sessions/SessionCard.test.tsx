// frontend/__tests__/components/sessions/SessionCard.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { SessionCard } from '@/components/sessions/SessionCard'
import type { SessionListEntry } from '@/lib/types'

function makeEntry(overrides: Partial<SessionListEntry> = {}): SessionListEntry {
  return {
    id: 's1',
    filename: 'loans.csv',
    stage: 'AWAITING_RULE_APPROVAL',
    created_at: '2026-04-28T12:00:00Z',
    current_score: 0.72,
    baseline_score: 0.5,
    ...overrides,
  } as SessionListEntry
}

jest.mock('@/lib/api', () => ({
  deleteSession: jest.fn().mockResolvedValue(undefined),
  getPipelineDownloadUrl: (id: string) => `/api/sessions/${id}/pipeline`,
}))

describe('SessionCard', () => {
  it('renders filename, date, stage label, and score', () => {
    render(<SessionCard entry={makeEntry()} onOpen={() => {}} onDeleted={() => {}} />)
    expect(screen.getByText('loans.csv')).toBeInTheDocument()
    expect(screen.getByText(/Apr/)).toBeInTheDocument()
    expect(screen.getByText('Awaiting Rules')).toBeInTheDocument()
    expect(screen.getByText('72%')).toBeInTheDocument()
  })

  it('exposes data-stage-category on the chip', () => {
    render(<SessionCard entry={makeEntry()} onOpen={() => {}} onDeleted={() => {}} />)
    expect(screen.getByText('Awaiting Rules').closest('[data-stage-category]'))
      .toHaveAttribute('data-stage-category', 'awaiting')
  })

  it('exposes data-score-variant on the score block', () => {
    const { rerender } = render(
      <SessionCard entry={makeEntry({ current_score: 0.95 })} onOpen={() => {}} onDeleted={() => {}} />,
    )
    expect(screen.getByTestId('score-block')).toHaveAttribute('data-score-variant', 'success')

    rerender(
      <SessionCard entry={makeEntry({ current_score: 0.75 })} onOpen={() => {}} onDeleted={() => {}} />,
    )
    expect(screen.getByTestId('score-block')).toHaveAttribute('data-score-variant', 'warning')

    rerender(
      <SessionCard entry={makeEntry({ current_score: 0.55 })} onOpen={() => {}} onDeleted={() => {}} />,
    )
    expect(screen.getByTestId('score-block')).toHaveAttribute('data-score-variant', 'danger')
  })

  it('shows the per-stage detail line when stageDetail returns a string', () => {
    render(
      <SessionCard
        entry={makeEntry({ stage: 'AWAITING_RULE_APPROVAL', rule_count: 14 } as Partial<SessionListEntry>)}
        onOpen={() => {}}
        onDeleted={() => {}}
      />,
    )
    expect(screen.getByText('14 rules awaiting decision')).toBeInTheDocument()
  })

  it('hides the detail line when stageDetail returns null', () => {
    render(
      <SessionCard
        entry={makeEntry({ stage: 'LOADING', current_score: 0, baseline_score: 0 })}
        onOpen={() => {}}
        onDeleted={() => {}}
      />,
    )
    expect(screen.queryByTestId('stage-detail')).toBeNull()
  })

  it('renders the Download button only when the stage is COMPLETE', () => {
    const { rerender } = render(
      <SessionCard entry={makeEntry({ stage: 'AWAITING_RULE_APPROVAL' })} onOpen={() => {}} onDeleted={() => {}} />,
    )
    expect(screen.queryByText('Download')).toBeNull()

    rerender(
      <SessionCard
        entry={makeEntry({ stage: 'COMPLETE', current_score: 0.92, baseline_score: 0.74 })}
        onOpen={() => {}}
        onDeleted={() => {}}
      />,
    )
    expect(screen.getByText('Download')).toBeInTheDocument()
  })

  it('clicking the card fires onOpen', () => {
    const onOpen = jest.fn()
    render(<SessionCard entry={makeEntry()} onOpen={onOpen} onDeleted={() => {}} />)
    fireEvent.click(screen.getByTestId('session-card'))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('delete menu item is hidden until the edit kebab is clicked', () => {
    render(<SessionCard entry={makeEntry()} onOpen={() => {}} onDeleted={() => {}} />)
    expect(screen.queryByTestId('session-delete')).toBeNull()
    fireEvent.click(screen.getByTestId('session-edit'))
    expect(screen.getByTestId('session-delete')).toBeInTheDocument()
  })

  it('clicking delete twice (after opening the menu) deletes the session', async () => {
    const onDeleted = jest.fn()
    render(<SessionCard entry={makeEntry()} onOpen={() => {}} onDeleted={onDeleted} />)
    fireEvent.click(screen.getByTestId('session-edit'))
    const btn = screen.getByTestId('session-delete')
    fireEvent.click(btn)
    expect(btn).toHaveTextContent(/confirm/i)
    fireEvent.click(btn)
    await Promise.resolve()
    await Promise.resolve()
    expect(onDeleted).toHaveBeenCalledTimes(1)
  })
})
