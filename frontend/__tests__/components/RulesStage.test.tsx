import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { RulesStage } from '@/components/stages/RulesStage'
import type { SessionState, Rule } from '@/lib/types'
import * as api from '@/lib/api'

jest.mock('@/lib/api')
const mockApprove = api.approveRules as jest.MockedFunction<typeof api.approveRules>

const rule: Rule = { id: 'r1', category: 'validity', column: 'email', check: 'not_null', threshold: 0, modified: false, rationale: 'High null rate' }
const session = { session_id: 's1', stage: 'AWAITING_RULE_APPROVAL', suggested_rules: [rule] } as unknown as SessionState

it('renders rule check text', () => {
  render(<RulesStage session={session} />)
  expect(screen.getByText('not_null')).toBeInTheDocument()
})

it('submit button is disabled when rules are undecided', () => {
  render(<RulesStage session={session} />)
  expect(screen.getByRole('button', { name: /submit/i })).toBeDisabled()
})

it('submit button enables after approving all rules', async () => {
  render(<RulesStage session={session} />)
  fireEvent.click(screen.getByRole('button', { name: /^Approve$/i }))
  await waitFor(() => expect(screen.getByRole('button', { name: /submit/i })).not.toBeDisabled())
})

it('calls approveRules with correct args on submit', async () => {
  mockApprove.mockResolvedValueOnce({ accepted: true, message: '' })
  render(<RulesStage session={session} />)
  fireEvent.click(screen.getByRole('button', { name: /^Approve$/i }))
  fireEvent.click(screen.getByRole('button', { name: /submit/i }))
  await waitFor(() => expect(mockApprove).toHaveBeenCalledWith('s1', [rule], []))
})
