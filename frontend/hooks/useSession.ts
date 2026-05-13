import useSWR from 'swr'
import { getSession } from '@/lib/api'
import type { SessionState } from '@/lib/types'

export function useSession(id: string | null, opts: { enabled?: boolean } = {}) {
  const enabled = opts.enabled ?? true
  const { data, error, isLoading, mutate } = useSWR<SessionState>(
    id && enabled ? `/session/${id}` : null,
    () => getSession(id!),
    { refreshInterval: 2000, refreshWhenHidden: false, revalidateOnFocus: true }
  )
  return { session: data, error, isLoading, refresh: mutate }
}
