import { useState, useEffect } from 'react'
import { getAIStreamUrl } from '@/lib/api'

export interface AIEvent {
  event: string
  ts?: string | number
  [key: string]: unknown
}

export function useAIStream(sessionId: string | null) {
  const [events, setEvents] = useState<AIEvent[]>([])

  useEffect(() => {
    if (!sessionId) return
    const es = new EventSource(getAIStreamUrl(sessionId))

    es.onmessage = (e) => {
      try {
        const parsed: AIEvent = JSON.parse(e.data)
        setEvents(prev => [...prev, parsed])
      } catch {}
    }

    es.onerror = () => { /* allow EventSource auto-reconnect */ }

    return () => es.close()
  }, [sessionId])

  return { events }
}
