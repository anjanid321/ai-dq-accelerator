import useSWR from 'swr'
import { listSessions } from '@/lib/api'
import type { SessionListEntry } from '@/lib/types'

export function useSessionsList() {
  const { data, error, isLoading, mutate } = useSWR<SessionListEntry[]>(
    '/api/v1/sessions',
    () => listSessions(),
    { refreshInterval: 5000, refreshWhenHidden: false }
  )
  return {
    sessions: data ?? [],
    error,
    isLoading,
    refresh: () => mutate(),
  }
}
