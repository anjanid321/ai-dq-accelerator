// frontend/components/ai-panel/EventFeed.tsx
'use client'
import { useRef } from 'react'
import type { AIEvent } from '@/hooks/useAIStream'
import { useStickToBottom } from '@/hooks/useStickToBottom'
import { ScrollToLatestPill } from './ScrollToLatestPill'

function formatTimestamp(ts: string | number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

interface CardProps {
  event: AIEvent
  highlighted: boolean
}

const cardBase = 'bg-surface rounded-lg p-3 flex flex-col gap-1.5 border min-w-0 overflow-hidden'
const bodyClass = 'text-[11px] font-mono text-fg-muted leading-relaxed whitespace-pre-wrap break-all'
const badgeBase = 'inline-flex items-center text-[10px] font-mono font-semibold px-2 py-0.5 rounded uppercase tracking-wide shrink-0'
const toolNameClass = 'text-[10px] font-mono text-fg truncate min-w-0'
const timestampClass = 'text-[10px] text-fg-muted ml-auto shrink-0 tabular-nums'

function ToolCallCard({ event: ev, highlighted }: CardProps) {
  const body = JSON.stringify(
    (ev.input as object) ?? (ev.params as object) ?? {},
    null,
    0,
  )
    .replace(/^{|}$/g, '')
    .trim()

  return (
    <div className={[cardBase, highlighted ? 'border-accent-indigo ring-1 ring-accent-indigo/40' : 'border-border'].join(' ')}>
      <div className="flex items-center gap-2">
        <span className={`${badgeBase} bg-accent-indigo/15 text-accent-indigo-deep`}>TOOL CALL</span>
        {ev.tool != null && <span className={toolNameClass}>{String(ev.tool)}</span>}
        {ev.ts != null && <span className={timestampClass}>{formatTimestamp(ev.ts)}</span>}
      </div>
      {body && <pre className={bodyClass}>{body}</pre>}
    </div>
  )
}

function ResultCard({ event: ev, highlighted }: CardProps) {
  const preview = 'preview' in ev ? String(ev.preview) : ''
  return (
    <div className={[cardBase, highlighted ? 'border-success ring-1 ring-success/40' : 'border-border'].join(' ')}>
      <div className="flex items-center gap-2">
        <span className={`${badgeBase} bg-success/15 text-success-deep`}>RESULT</span>
        {ev.tool != null && <span className={toolNameClass}>{String(ev.tool)}</span>}
        {ev.ts != null && <span className={timestampClass}>{formatTimestamp(ev.ts)}</span>}
      </div>
      {preview && <pre className={bodyClass}>{preview}</pre>}
    </div>
  )
}

function ThinkingCard({ event: ev, highlighted }: CardProps) {
  const text = String(ev.content ?? ev.text ?? '')
  return (
    <div className={[cardBase, highlighted ? 'border-accent-purple ring-1 ring-accent-purple/40' : 'border-border'].join(' ')}>
      <div className="flex items-center gap-2">
        <span className={`${badgeBase} bg-accent-purple/15 text-accent-purple-deep`}>THINKING</span>
        {ev.ts != null && <span className={timestampClass}>{formatTimestamp(ev.ts)}</span>}
      </div>
      {text && <p className="text-[11px] italic text-fg-muted leading-relaxed break-words">{text}</p>}
    </div>
  )
}

function DoneCard({ event: ev, highlighted }: CardProps) {
  return (
    <div className={[cardBase, highlighted ? 'border-fg-muted ring-1 ring-fg-muted/40' : 'border-border'].join(' ')}>
      <div className="flex items-center gap-2">
        <span className={`${badgeBase} bg-fg-subtle/15 text-fg-muted`}>DONE</span>
        {ev.tool != null && <span className={toolNameClass}>{String(ev.tool)}</span>}
        {ev.ts != null && <span className={timestampClass}>{formatTimestamp(ev.ts)}</span>}
      </div>
    </div>
  )
}

function EventCard({ event, highlighted }: CardProps) {
  switch (event.event) {
    case 'tool_call':
      return <ToolCallCard event={event} highlighted={highlighted} />
    case 'tool_result':
      return <ResultCard event={event} highlighted={highlighted} />
    case 'thinking':
      return <ThinkingCard event={event} highlighted={highlighted} />
    default:
      return <DoneCard event={event} highlighted={highlighted} />
  }
}

export function EventFeed({ events }: { events: AIEvent[] }) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const { pinned, unreadCount, scrollToBottom } = useStickToBottom(scrollerRef, events.length)

  if (events.length === 0) return <div className="flex-1" />

  const lastIndex = events.length - 1
  return (
    <div
      ref={scrollerRef}
      data-testid="event-feed-scroller"
      className="relative flex-1 overflow-y-auto overflow-x-hidden p-3 flex flex-col gap-2"
    >
      {events.map((ev, i) => (
        <EventCard key={i} event={ev} highlighted={i === lastIndex} />
      ))}
      {!pinned && <ScrollToLatestPill unreadCount={unreadCount} onClick={scrollToBottom} />}
    </div>
  )
}
