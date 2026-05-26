'use client'

import { useRef } from 'react'
import type { AIEvent } from '@/hooks/useAIStream'
import { useStickToBottom } from '@/hooks/useStickToBottom'
import { ScrollToLatestPill } from './ScrollToLatestPill'

// Token-driven, tinted-at-15-alpha so glyphs read clearly on the white surface.
const GLYPH: Record<string, string> = { tool_call: '▶', tool_result: '✓', thinking: '~', done: '■' }
const GLYPH_COLOR: Record<string, string> = {
  tool_call:   'text-accent-indigo-deep',
  tool_result: 'text-success-deep',
  thinking:    'text-accent-purple-deep',
  done:        'text-fg-muted',
}

function formatTimestamp(ts: unknown): string {
  if (ts == null) return '--'
  const ms = typeof ts === 'number' ? ts : Date.parse(String(ts))
  if (Number.isNaN(ms)) return '--'
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function eventBody(ev: AIEvent): string {
  if (ev.event === 'thinking') return String(ev.content ?? ev.text ?? '')
  if (ev.event === 'tool_call') return JSON.stringify(ev.input ?? ev.params ?? {}, null, 0)
  if (ev.event === 'tool_result') return String(ev.preview ?? '')
  return JSON.stringify(ev.params ?? ev.result ?? {}, null, 0)
}

export function EventTerminal({ events }: { events: AIEvent[] }) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const { pinned, unreadCount, scrollToBottom } = useStickToBottom(scrollerRef, events.length)

  return (
    <div
      ref={scrollerRef}
      data-testid="event-terminal-scroller"
      className="relative flex-1 overflow-y-auto overflow-x-hidden p-3 font-mono text-xs leading-relaxed text-fg"
    >
      {events.map((ev, i) => {
        const glyphCls = GLYPH_COLOR[ev.event] ?? 'text-fg-muted'
        const glyph = GLYPH[ev.event] ?? '?'
        const body = eventBody(ev)
        const isThinking = ev.event === 'thinking'
        return (
          <div key={i} className="break-words">
            <span className="text-fg-muted">[{formatTimestamp(ev.ts)}]</span>{' '}
            <span className={glyphCls}>{glyph}</span>{' '}
            <span className="text-fg font-semibold">{String(ev.tool ?? ev.event)}</span>
            {body && (
              <div className={`pl-4 break-all whitespace-pre-wrap text-fg-muted ${isThinking ? 'italic' : ''}`}>
                {body}
              </div>
            )}
          </div>
        )
      })}
      <span className="text-fg">█</span>
      {!pinned && <ScrollToLatestPill unreadCount={unreadCount} onClick={scrollToBottom} />}
    </div>
  )
}
