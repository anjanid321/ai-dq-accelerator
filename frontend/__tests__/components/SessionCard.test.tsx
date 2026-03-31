import { render, screen } from '@testing-library/react'
import { SessionCard } from '@/components/sessions/SessionCard'
import type { SessionState } from '@/lib/types'

const base: SessionState = {
  session_id: 'abc',
  stage: 'PROFILING',
  profile: {},
  ai_summary: '',
  suggested_rules: [],
  baseline_quality_score: 0,
  current_score: 0,
  validation_summary: '',
  anomaly_summary: '',
  transformation_log: [],
  scorecard: {},
  narrative: '',
  output_dir: '',
  zip_path: '',
}

it('shows filename and stage badge', () => {
  render(<SessionCard sessionId="abc" filename="sales.csv" state={base} onOpen={() => {}} />)
  expect(screen.getByText('sales.csv')).toBeInTheDocument()
  expect(screen.getByText(/Profiling/i)).toBeInTheDocument()
})

it('shows action banner when awaiting rule approval', () => {
  render(<SessionCard sessionId="abc" filename="sales.csv" state={{ ...base, stage: 'AWAITING_RULE_APPROVAL' }} onOpen={() => {}} />)
  expect(screen.getByText(/rules need approval/i)).toBeInTheDocument()
})

it('shows download button when complete', () => {
  render(<SessionCard sessionId="abc" filename="sales.csv" state={{ ...base, stage: 'COMPLETE', current_score: 0.94, baseline_quality_score: 0.71 }} onOpen={() => {}} />)
  expect(screen.getByText(/Download/i)).toBeInTheDocument()
})
