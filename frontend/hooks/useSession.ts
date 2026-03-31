import useSWR from 'swr'
import { getSession } from '@/lib/api'
import type { SessionState } from '@/lib/types'

export function useSession(id: string | null) {
  const { data, error, isLoading, mutate } = useSWR<SessionState>(
    id ? `/session/${id}` : null,
    () => getSession(id!),
    { refreshInterval: 2000 }
  )
  return { session: data, error, isLoading, refresh: mutate }
}
