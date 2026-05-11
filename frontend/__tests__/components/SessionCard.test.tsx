import { render, screen } from '@testing-library/react'
import { SessionCard } from '@/components/sessions/SessionCard'
import type { SessionListEntry } from '@/lib/types'

const base: SessionListEntry = {
  id: 'abc',
  filename: 'sales.csv',
  stage: 'PROFILING',
  current_score: 0,
  baseline_score: 0,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

it('shows filename and stage badge', () => {
  render(<SessionCard entry={base} onOpen={() => {}} onDeleted={() => {}} />)
  expect(screen.getByText('sales.csv')).toBeInTheDocument()
  expect(screen.getByText(/Profiling/i)).toBeInTheDocument()
})

it('shows quality score bar when score > 0', () => {
  render(<SessionCard entry={{ ...base, current_score: 0.85 }} onOpen={() => {}} onDeleted={() => {}} />)
  expect(screen.getByText('85%')).toBeInTheDocument()
})

it('shows download button when complete', () => {
  render(<SessionCard entry={{ ...base, stage: 'COMPLETE', current_score: 0.94, baseline_score: 0.71 }} onOpen={() => {}} onDeleted={() => {}} />)
  expect(screen.getByText(/Download/i)).toBeInTheDocument()
})
