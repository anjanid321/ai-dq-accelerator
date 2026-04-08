'use client'

import { useRef, useEffect } from 'react'
import type { AIEvent } from '@/hooks/useAIStream'

const GLYPH: Record<string, string> = { tool_call: '▶', tool_result: '✓', thinking: '~' }
const COLOR: Record<string, string> = { tool_call: 'text-indigo-light', tool_result: 'text-success-light', thinking: 'text-purple-light' }

export function EventTerminal({ events }: { events: AIEvent[] }) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView()
  }, [events])

  return (
    <div className="flex-1 overflow-y-auto p-3 font-mono text-[10px] leading-relaxed">
      {events.map((ev, i) => (
        <div key={i}>
          <span className="text-border">[{ev.ts ? new Date(ev.ts as string).toLocaleTimeString() : '--'}]</span>{' '}
          <span className={COLOR[ev.event] ?? 'text-text-muted'}>{GLYPH[ev.event] ?? '?'}</span>{' '}
          <span className="text-text-primary">{String(ev.tool ?? ev.event)}</span>
          {ev.event === 'thinking'
            ? <div className="pl-4 text-text-muted italic">{String(ev.content ?? ev.text ?? '')}</div>
            : <div className="pl-4 text-text-muted">
                {ev.event === 'tool_call'
                  ? JSON.stringify(ev.input ?? ev.params ?? {}).slice(0, 120)
                  : ev.event === 'tool_result'
                      ? String(ev.preview ?? '')
                      : JSON.stringify(ev.params ?? ev.result ?? {}).slice(0, 120)}
              </div>
          }
        </div>
      ))}
      <span className="text-text-primary">█</span>
      <div ref={bottomRef} />
    </div>
  )
}
