import { useState, useEffect, useRef } from 'react'
import { getAIStreamUrl } from '@/lib/api'

export interface AIEvent {
  event: string
  ts?: number
  [key: string]: unknown
}

export function useAIStream(sessionId: string | null) {
  const [events, setEvents] = useState<AIEvent[]>([])
  const doneRef = useRef(false)

  useEffect(() => {
    if (!sessionId) return
    doneRef.current = false
    const es = new EventSource(getAIStreamUrl(sessionId))

    es.onmessage = (e) => {
      if (doneRef.current) return
      try {
        const parsed: AIEvent = JSON.parse(e.data)
        if (parsed.event === 'done') {
          doneRef.current = true
          es.close()
          return
        }
        setEvents(prev => [...prev, parsed])
      } catch {}
    }

    es.onerror = () => { /* allow EventSource auto-reconnect */ }

    return () => es.close()
  }, [sessionId])

  return { events }
}
