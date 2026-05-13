import useSWR from 'swr'
import { getStageSnapshot } from '@/lib/api'
import type { StageSnapshot } from '@/lib/types'

export function useStageSnapshot<T = Record<string, unknown>>(
  sessionId: string | null,
  stage: string | null,
  enabled: boolean,
) {
  const key = sessionId && stage && enabled ? `/api/v1/sessions/${sessionId}/stages/${stage}` : null
  const { data, error, isLoading } = useSWR<StageSnapshot<T>>(
    key,
    () => getStageSnapshot<T>(sessionId!, stage!),
    { revalidateOnFocus: false, refreshInterval: 0 },
  )
  return { snapshot: data, error, isLoading }
}
