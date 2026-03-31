import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TransformStage } from '@/components/stages/TransformStage'
import type { SessionState } from '@/lib/types'
import * as api from '@/lib/api'

jest.mock('@/lib/api')
const mockDecide = api.decideTransformation as jest.MockedFunction<typeof api.decideTransformation>

const session: Partial<SessionState> = {
  session_id: 's1',
  stage: 'TRANSFORMATION_LOOP',
  baseline_quality_score: 0.71,
  current_score: 0.78,
  current_suggestion: {
    transformation_id: 't1',
    type: 'fill_nulls',
    params: { column: 'email', value: 'unknown@placeholder.com' },
    rationale: '504 null emails detected.',
    preview: {
      before_sample: [{ id: 1, email: null }],
      after_sample: [{ id: 1, email: 'unknown@placeholder.com' }],
      affected_row_count: 504,
      projected_score_delta: 0.042,
      projected_score: 0.82,
    },
  },
  transformation_log: [],
}

it('renders type badge and rationale', () => {
  render(<TransformStage session={session as SessionState} />)
  expect(screen.getByText('fill_nulls')).toBeInTheDocument()
  expect(screen.getByText(/504 null emails/i)).toBeInTheDocument()
})

it('shows before/after preview samples', () => {
  render(<TransformStage session={session as SessionState} />)
  expect(screen.getByText('Before / After Preview')).toBeInTheDocument()
  expect(screen.getAllByText('Before')).toHaveLength(1)
  expect(screen.getAllByText('After')).toHaveLength(1)
})

it('accept calls decideTransformation with approved: true', async () => {
  mockDecide.mockResolvedValueOnce({ accepted: true, transformation_id: 't1', applied: true, transformation_log: [] })
  render(<TransformStage session={session as SessionState} />)
  fireEvent.click(screen.getByRole('button', { name: /accept/i }))
  await waitFor(() => expect(mockDecide).toHaveBeenCalledWith('s1', 't1', true))
})

it('reject calls decideTransformation with approved: false', async () => {
  mockDecide.mockResolvedValueOnce({ accepted: true, transformation_id: 't1', applied: false, transformation_log: [] })
  render(<TransformStage session={session as SessionState} />)
  fireEvent.click(screen.getByRole('button', { name: /reject/i }))
  await waitFor(() => expect(mockDecide).toHaveBeenCalledWith('s1', 't1', false))
})
