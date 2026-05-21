// frontend/__tests__/sessions/UploadModal.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { UploadModal } from '@/components/sessions/UploadModal'
import * as api from '@/lib/api'

jest.mock('@/lib/api', () => ({
  createSession: jest.fn(),
}))

const mockedCreate = api.createSession as jest.MockedFunction<typeof api.createSession>

function makeFile(name = 'loan_applications.csv', size = 1234) {
  const f = new File(['col1,col2\n1,2\n'], name, { type: 'text/csv' })
  Object.defineProperty(f, 'size', { value: size })
  return f
}

describe('UploadModal', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockedCreate.mockResolvedValue({
      session_id: 'sess-1',
      workflow_id: 'sess-1',
      stage: 'LOADING',
      message: '',
    } as Awaited<ReturnType<typeof api.createSession>>)
  })

  it('renders the dialog header with title, subtitle, and close button', () => {
    render(<UploadModal onCreated={() => {}} onClose={() => {}} />)
    expect(screen.getByRole('dialog', { name: /upload dataset/i })).toBeInTheDocument()
    expect(screen.getByText('Upload dataset')).toBeInTheDocument()
    expect(screen.getByText(/Start a new AI-powered data quality session/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument()
  })

  it('renders all three accepted file-type chips', () => {
    render(<UploadModal onCreated={() => {}} onClose={() => {}} />)
    expect(screen.getByText('.csv')).toBeInTheDocument()
    expect(screen.getByText('.parquet')).toBeInTheDocument()
    expect(screen.getByText('.json')).toBeInTheDocument()
  })

  it('Start session button uses the primary navy class and has an ArrowRight icon', () => {
    render(<UploadModal onCreated={() => {}} onClose={() => {}} />)
    const btn = screen.getByRole('button', { name: /start session/i })
    expect(btn.className).toContain('bg-brand-accent')
    expect(btn.className).toContain('text-on-brand')
    expect(btn.querySelector('svg.lucide-arrow-right')).not.toBeNull()
  })

  it('Cancel button uses the neutral secondary class', () => {
    render(<UploadModal onCreated={() => {}} onClose={() => {}} />)
    const btn = screen.getByRole('button', { name: /^cancel$/i })
    expect(btn.className).toContain('bg-surface')
    expect(btn.className).toContain('border-border')
    expect(btn.className).toContain('text-fg-muted')
  })

  it('Start session is disabled until a file is picked', () => {
    render(<UploadModal onCreated={() => {}} onClose={() => {}} />)
    const start = screen.getByRole('button', { name: /start session/i }) as HTMLButtonElement
    expect(start.disabled).toBe(true)
  })

  it('enables Start session after a file is selected and shows the selected-file row', () => {
    render(<UploadModal onCreated={() => {}} onClose={() => {}} />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [makeFile('q1_signups.csv', 2048)] } })
    expect((screen.getByRole('button', { name: /start session/i }) as HTMLButtonElement).disabled).toBe(false)
    // Selected-file row renders with size + remove button.
    expect(screen.getAllByText('q1_signups.csv').length).toBeGreaterThan(0)
    expect(screen.getByText(/2\.0 KB/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /remove file/i })).toBeInTheDocument()
  })

  it('clicking the remove-file button clears the selection', () => {
    render(<UploadModal onCreated={() => {}} onClose={() => {}} />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [makeFile()] } })
    fireEvent.click(screen.getByRole('button', { name: /remove file/i }))
    expect(screen.queryByRole('button', { name: /remove file/i })).toBeNull()
    expect((screen.getByRole('button', { name: /start session/i }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('drop-zone gains a brand-primary background tint when dragging a file over it', () => {
    const { container } = render(<UploadModal onCreated={() => {}} onClose={() => {}} />)
    const dropZone = container.querySelector('.border-dashed') as HTMLElement
    fireEvent.dragOver(dropZone)
    // bg-brand-primary/5 only appears during drag; border-brand-primary is on
    // both the drag state and the hover state so we assert on the bg token.
    expect(dropZone.className).toContain('bg-brand-primary/5')
    fireEvent.dragLeave(dropZone)
    expect(dropZone.className).not.toContain('bg-brand-primary/5')
  })

  it('clicking the backdrop calls onClose', () => {
    const onClose = jest.fn()
    const { container } = render(<UploadModal onCreated={() => {}} onClose={onClose} />)
    const backdrop = container.firstChild as HTMLElement
    fireEvent.click(backdrop)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('clicking the X header button calls onClose', () => {
    const onClose = jest.fn()
    render(<UploadModal onCreated={() => {}} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalled()
  })

  it('clicking Cancel calls onClose', () => {
    const onClose = jest.fn()
    render(<UploadModal onCreated={() => {}} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }))
    expect(onClose).toHaveBeenCalled()
  })

  it('submitting calls createSession with the file and use case, then onCreated with the new id', async () => {
    const onCreated = jest.fn()
    render(<UploadModal onCreated={onCreated} onClose={() => {}} />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [makeFile('a.csv')] } })
    fireEvent.change(screen.getByPlaceholderText(/Clean customer CRM data/), {
      target: { value: 'demo case' },
    })
    fireEvent.click(screen.getByRole('button', { name: /start session/i }))
    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1))
    expect(mockedCreate.mock.calls[0][0].name).toBe('a.csv')
    expect(mockedCreate.mock.calls[0][1]).toBe('demo case')
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('sess-1'))
  })

  it('renders an error banner with dimension-chip danger tokens when createSession rejects', async () => {
    mockedCreate.mockRejectedValueOnce(new Error('Server exploded'))
    render(<UploadModal onCreated={() => {}} onClose={() => {}} />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [makeFile()] } })
    fireEvent.click(screen.getByRole('button', { name: /start session/i }))
    const banner = await screen.findByText(/Server exploded/)
    expect(banner.className).toContain('text-danger-deep')
    expect(banner.className).toContain('bg-danger/15')
  })

  describe('demo mode', () => {
    it('does NOT call createSession when demoMode is true', async () => {
      const onCreated = jest.fn()
      render(<UploadModal onCreated={onCreated} onClose={() => {}} demoMode />)
      const input = document.querySelector('input[type="file"]') as HTMLInputElement
      fireEvent.change(input, { target: { files: [makeFile()] } })
      fireEvent.click(screen.getByRole('button', { name: /start session/i }))
      await waitFor(() => expect(onCreated).toHaveBeenCalledWith('demo'), { timeout: 1200 })
      expect(mockedCreate).not.toHaveBeenCalled()
    })
  })
})
