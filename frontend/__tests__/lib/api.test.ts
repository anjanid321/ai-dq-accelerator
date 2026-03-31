import { createSession, getSession, approveRules, decideTransformation, generatePipeline, getScorecard } from '@/lib/api'

const mockFetch = jest.fn()
global.fetch = mockFetch

beforeEach(() => mockFetch.mockReset())

describe('createSession', () => {
  it('posts FormData to /api/v1/sessions', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ session_id: 'abc', workflow_id: 'abc', stage: 'LOADING', row_count: 0, col_count: 0, message: '' }),
    })
    const file = new File(['col\nval'], 'test.csv', { type: 'text/csv' })
    const result = await createSession(file, 'clean data')
    expect(mockFetch).toHaveBeenCalledWith('/api/v1/sessions', expect.objectContaining({ method: 'POST' }))
    expect(result.session_id).toBe('abc')
  })
})

describe('approveRules', () => {
  it('posts approved and rejected rule ids', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ accepted: true, message: '' }) })
    await approveRules('sess1', [{ id: 'r1' } as any], ['r2'])
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.approved_rules[0].id).toBe('r1')
    expect(body.rejected_rule_ids).toEqual(['r2'])
  })
})

describe('decideTransformation', () => {
  it('posts decision with approved flag', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ accepted: true, transformation_id: 't1', applied: true, transformation_log: [] }) })
    await decideTransformation('sess1', 't1', true)
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.approved).toBe(true)
  })
})
