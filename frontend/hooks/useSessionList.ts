import { useState, useEffect } from 'react'
import type { SessionListEntry } from '@/lib/types'

const KEY = 'dq_sessions'

function load(): SessionListEntry[] {
  if (typeof window === 'undefined') return []
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') } catch { return [] }
}

function save(entries: SessionListEntry[]) {
  localStorage.setItem(KEY, JSON.stringify(entries))
}

export function useSessionList() {
  const [sessions, setSessions] = useState<SessionListEntry[]>([])

  useEffect(() => { setSessions(load()) }, [])

  function addSession(entry: SessionListEntry) {
    setSessions(prev => {
      const next = [entry, ...prev.filter(s => s.id !== entry.id)]
      save(next)
      return next
    })
  }

  function removeSession(id: string) {
    setSessions(prev => {
      const next = prev.filter(s => s.id !== id)
      save(next)
      return next
    })
  }

  return { sessions, addSession, removeSession }
}
