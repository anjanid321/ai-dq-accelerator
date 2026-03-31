import { renderHook, waitFor } from '@testing-library/react'
import { useSession } from '@/hooks/useSession'

const mockFetch = jest.fn()
global.fetch = mockFetch

beforeEach(() => mockFetch.mockReset())

it('returns session state after fetch', async () => {
  const state = { session_id: 'abc', stage: 'PROFILING', profile: {}, ai_summary: '', suggested_rules: [], baseline_quality_score: 0, current_score: 0, validation_summary: '', anomaly_summary: '', transformation_log: [], scorecard: {}, narrative: '', output_dir: '', zip_path: '' }
  mockFetch.mockResolvedValue({ ok: true, json: async () => state })

  const { result } = renderHook(() => useSession('abc'))
  await waitFor(() => expect(result.current.session?.stage).toBe('PROFILING'))
})
