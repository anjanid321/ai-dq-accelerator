// frontend/__tests__/stages/ExplorationStage.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ExplorationStage } from '@/components/stages/ExplorationStage'
import * as api from '@/lib/api'

jest.mock('@/lib/api', () => ({
  getExplorationState: jest.fn(),
  getNotebookHtmlUrl: jest.fn((id: string) => `/api/v1/sessions/${id}/exploration/notebook`),
  getNotebookDownloadUrl: jest.fn((id: string) => `/api/v1/sessions/${id}/exploration/notebook/download`),
  submitExplorationFeedback: jest.fn(),
}))

const mockedGetState = api.getExplorationState as jest.MockedFunction<typeof api.getExplorationState>
const mockedSubmit = api.submitExplorationFeedback as jest.MockedFunction<typeof api.submitExplorationFeedback>

function makeState(overrides: Partial<{
  open_questions: string[]
  investigation_round: number
  notebook_ready: boolean
  synthesis_constrained: boolean
  synthesis_constraint_reasons: string[]
}> = {}) {
  return {
    exploration_findings: {},
    open_questions: [],
    investigation_round: 0,
    notebook_ready: true,
    synthesis_constrained: false,
    synthesis_constraint_reasons: [],
    ...overrides,
  }
}

describe('ExplorationStage', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockedGetState.mockResolvedValue(makeState())
    mockedSubmit.mockResolvedValue({ accepted: true, message: '', investigation_round: 0 })
  })

  it('renders the loading notebook card with brand-primary spinner when notebook_ready is false', async () => {
    mockedGetState.mockResolvedValue(makeState({ notebook_ready: false }))
    render(<ExplorationStage sessionId="s1" stage="AWAITING_INVESTIGATION_REVIEW" />)
    const spinner = await screen.findByRole('status', { name: /loading/i })
    expect(spinner.classList.contains('border-brand-primary')).toBe(true)
    expect(screen.getByText(/Generating exploration notebook/)).toBeInTheDocument()
  })

  it('renders the reinvestigating copy when stage=REINVESTIGATING and notebook not ready', async () => {
    mockedGetState.mockResolvedValue(makeState({ notebook_ready: false }))
    render(<ExplorationStage sessionId="s1" stage="REINVESTIGATING" />)
    expect(await screen.findByText(/Agent is re-investigating your data/)).toBeInTheDocument()
  })

  it('renders the iframe wrapper with the Download link when notebook_ready is true', async () => {
    render(<ExplorationStage sessionId="s1" stage="AWAITING_INVESTIGATION_REVIEW" />)
    expect(await screen.findByText('Exploration Notebook')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /Download \.ipynb/i })
    expect(link).toHaveAttribute('href', '/api/v1/sessions/s1/exploration/notebook/download')
    expect(link.className).toContain('text-fg-muted')
  })

  it('renders the Open Questions card when open_questions has entries', async () => {
    mockedGetState.mockResolvedValue(
      makeState({ open_questions: ['Is co_signer_ssn really optional?', 'Why is state_code constant?'] }),
    )
    render(<ExplorationStage sessionId="s1" stage="AWAITING_INVESTIGATION_REVIEW" />)
    expect(await screen.findByText('Open Questions — Requires Your Input')).toBeInTheDocument()
    expect(screen.getByText(/Is co_signer_ssn/)).toBeInTheDocument()
    expect(screen.getByText(/Why is state_code/)).toBeInTheDocument()
  })

  it('hides the Open Questions card when open_questions is empty', async () => {
    render(<ExplorationStage sessionId="s1" stage="AWAITING_INVESTIGATION_REVIEW" />)
    await screen.findByText('Exploration Notebook')
    expect(screen.queryByText('Open Questions — Requires Your Input')).toBeNull()
  })

  it('renders the Constraint warning when synthesis_constrained is true', async () => {
    mockedGetState.mockResolvedValue(
      makeState({ synthesis_constrained: true, synthesis_constraint_reasons: ['Unresolved Q1', 'Unresolved Q2'] }),
    )
    render(<ExplorationStage sessionId="s1" stage="AWAITING_INVESTIGATION_REVIEW" />)
    expect(await screen.findByText('Constrained Synthesis')).toBeInTheDocument()
    expect(screen.getByText(/Unresolved Q1/)).toBeInTheDocument()
    expect(screen.getByText(/Unresolved Q2/)).toBeInTheDocument()
  })

  it('hides the Constraint warning when synthesis_constrained is false', async () => {
    render(<ExplorationStage sessionId="s1" stage="AWAITING_INVESTIGATION_REVIEW" />)
    await screen.findByText('Exploration Notebook')
    expect(screen.queryByText('Constrained Synthesis')).toBeNull()
  })

  it('renders Round chip with investigation_round + 1', async () => {
    mockedGetState.mockResolvedValue(makeState({ investigation_round: 1 }))
    render(<ExplorationStage sessionId="s1" stage="AWAITING_INVESTIGATION_REVIEW" />)
    expect(await screen.findByText('Round 2 of 3')).toBeInTheDocument()
  })

  it('hides feedback section and Re-investigate when maxRoundsReached (investigation_round >= 2); Approve stays', async () => {
    mockedGetState.mockResolvedValue(makeState({ investigation_round: 2 }))
    render(<ExplorationStage sessionId="s1" stage="AWAITING_INVESTIGATION_REVIEW" />)
    await screen.findByText('Exploration Notebook')
    expect(screen.queryByLabelText(/targeted re-investigation/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /Re-investigate/i })).toBeNull()
    expect(screen.getByRole('button', { name: /Approve & Continue/i })).toBeInTheDocument()
    expect(screen.getByText(/Maximum re-investigation rounds reached/)).toBeInTheDocument()
  })

  it('hides feedback and both buttons when readOnly', async () => {
    render(<ExplorationStage sessionId="s1" stage="COMPLETE" readOnly />)
    await screen.findByText('Exploration Notebook')
    expect(screen.queryByLabelText(/targeted re-investigation/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /Re-investigate/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /Approve & Continue/i })).toBeNull()
  })

  it('disables Re-investigate when feedback is empty, enables when non-empty', async () => {
    render(<ExplorationStage sessionId="s1" stage="AWAITING_INVESTIGATION_REVIEW" />)
    const btn = (await screen.findByRole('button', { name: /Re-investigate/i })) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    const textarea = screen.getByPlaceholderText(/Dig deeper into the relationship/)
    fireEvent.change(textarea, { target: { value: 'Look into cosigner clusters' } })
    expect(btn.disabled).toBe(false)
  })

  it('Approve button uses the primary navy class and renders ArrowRight icon', async () => {
    render(<ExplorationStage sessionId="s1" stage="AWAITING_INVESTIGATION_REVIEW" />)
    const btn = await screen.findByRole('button', { name: /Approve & Continue/i })
    expect(btn.className).toContain('bg-brand-accent')
    expect(btn.className).toContain('text-on-brand')
    // lucide icons render as <svg> with lucide-arrow-right class
    expect(btn.querySelector('svg.lucide-arrow-right')).not.toBeNull()
  })

  it('Re-investigate button uses neutral secondary class and renders RefreshCw icon', async () => {
    render(<ExplorationStage sessionId="s1" stage="AWAITING_INVESTIGATION_REVIEW" />)
    const btn = await screen.findByRole('button', { name: /Re-investigate/i })
    expect(btn.className).toContain('bg-surface')
    expect(btn.className).toContain('border-border')
    expect(btn.className).toContain('text-fg-muted')
    expect(btn.querySelector('svg.lucide-refresh-cw')).not.toBeNull()
  })

  it('clicking Approve calls submitExplorationFeedback(sessionId, true)', async () => {
    render(<ExplorationStage sessionId="s1" stage="AWAITING_INVESTIGATION_REVIEW" />)
    const btn = await screen.findByRole('button', { name: /Approve & Continue/i })
    fireEvent.click(btn)
    await waitFor(() => expect(mockedSubmit).toHaveBeenCalledWith('s1', true))
  })

  it('clicking Re-investigate with feedback calls submitExplorationFeedback(sessionId, false, trimmedFeedback)', async () => {
    render(<ExplorationStage sessionId="s1" stage="AWAITING_INVESTIGATION_REVIEW" />)
    await screen.findByRole('button', { name: /Re-investigate/i })
    const textarea = screen.getByPlaceholderText(/Dig deeper/) as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '   please dig deeper   ' } })
    fireEvent.click(screen.getByRole('button', { name: /Re-investigate/i }))
    await waitFor(() =>
      expect(mockedSubmit).toHaveBeenCalledWith('s1', false, 'please dig deeper'),
    )
  })

  it('after successful Approve, swaps to the submitted state with brand-primary spinner and "Moving to rule proposal…" copy', async () => {
    render(<ExplorationStage sessionId="s1" stage="AWAITING_INVESTIGATION_REVIEW" />)
    fireEvent.click(await screen.findByRole('button', { name: /Approve & Continue/i }))
    const spinner = await screen.findByRole('status', { name: /submitting/i })
    expect(spinner.classList.contains('border-brand-primary')).toBe(true)
    expect(screen.getByText(/Moving to rule proposal/)).toBeInTheDocument()
  })

  it('submitted state uses "Re-investigating…" copy when stage is REINVESTIGATING', async () => {
    render(<ExplorationStage sessionId="s1" stage="REINVESTIGATING" />)
    // notebook is ready in default mock state, so the Approve button still renders
    fireEvent.click(await screen.findByRole('button', { name: /Approve & Continue/i }))
    expect(await screen.findByText(/Re-investigating…/)).toBeInTheDocument()
  })

  it('renders an error banner when submitExplorationFeedback rejects', async () => {
    mockedSubmit.mockRejectedValueOnce(new Error('Network blew up'))
    render(<ExplorationStage sessionId="s1" stage="AWAITING_INVESTIGATION_REVIEW" />)
    fireEvent.click(await screen.findByRole('button', { name: /Approve & Continue/i }))
    const banner = await screen.findByText('Network blew up')
    expect(banner.className).toContain('text-danger-deep')
    expect(banner.className).toContain('bg-danger/15')
  })

  describe('demo mode (mockState provided)', () => {
    it('does NOT call getExplorationState when mockState is provided', async () => {
      render(
        <ExplorationStage
          sessionId="demo"
          stage="AWAITING_INVESTIGATION_REVIEW"
          mockState={makeState({ open_questions: ['Why is state_code constant?'] })}
        />,
      )
      expect(await screen.findByText('Exploration Notebook')).toBeInTheDocument()
      expect(screen.getByText(/Why is state_code constant/)).toBeInTheDocument()
      expect(mockedGetState).not.toHaveBeenCalled()
    })

    it('renders the loading state when mockState has notebook_ready=false', async () => {
      render(
        <ExplorationStage
          sessionId="demo"
          stage="AWAITING_INVESTIGATION_REVIEW"
          mockState={makeState({ notebook_ready: false })}
        />,
      )
      const spinner = await screen.findByRole('status', { name: /loading/i })
      expect(spinner.classList.contains('border-brand-primary')).toBe(true)
      expect(mockedGetState).not.toHaveBeenCalled()
    })

    it('clicking Approve in demo mode swaps to the submitted state without calling submitExplorationFeedback', async () => {
      render(
        <ExplorationStage
          sessionId="demo"
          stage="AWAITING_INVESTIGATION_REVIEW"
          mockState={makeState()}
        />,
      )
      fireEvent.click(await screen.findByRole('button', { name: /Approve & Continue/i }))
      expect(await screen.findByText(/Moving to rule proposal/)).toBeInTheDocument()
      expect(mockedSubmit).not.toHaveBeenCalled()
    })

    it('clicking Re-investigate with feedback in demo mode submits without calling the API', async () => {
      render(
        <ExplorationStage
          sessionId="demo"
          stage="AWAITING_INVESTIGATION_REVIEW"
          mockState={makeState()}
        />,
      )
      const textarea = await screen.findByPlaceholderText(/Dig deeper/)
      fireEvent.change(textarea, { target: { value: 'dig in' } })
      fireEvent.click(screen.getByRole('button', { name: /Re-investigate/i }))
      expect(await screen.findByText(/Moving to rule proposal/)).toBeInTheDocument()
      expect(mockedSubmit).not.toHaveBeenCalled()
    })
  })
})
