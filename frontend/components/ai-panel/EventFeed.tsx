import type { AIEvent } from '@/hooks/useAIStream'

// ── helpers ────────────────────────────────────────────────────────────────

function formatTimestamp(ts: string | number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

// ── Card sub-components ────────────────────────────────────────────────────

interface CardProps {
  event: AIEvent
  highlighted: boolean
}

function ToolCallCard({ event: ev, highlighted }: CardProps) {
  const body = JSON.stringify(
    (ev.input as object) ?? (ev.params as object) ?? {},
    null,
    0,
  )
    .replace(/^{|}$/g, '')
    .trim()

  return (
    <div
      className={[
        'bg-surface rounded-lg p-3 flex flex-col gap-1.5',
        'border border-border',
        highlighted ? 'ring-1 ring-accent-indigo/40 border-accent-indigo' : '',
      ].join(' ')}
    >
      {/* top row */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-accent-indigo/15 text-accent-indigo-deep uppercase">
          TOOL CALL
        </span>
        {ev.tool != null && (
          <span className="text-[10px] font-mono text-fg">{String(ev.tool)}</span>
        )}
        {ev.ts != null && (
          <span className="text-[9px] text-fg-subtle ml-auto">{formatTimestamp(ev.ts)}</span>
        )}
      </div>
      {/* body */}
      {body && (
        <pre className="text-[11px] font-mono text-fg-muted leading-relaxed whitespace-pre-wrap">
          {body}
        </pre>
      )}
    </div>
  )
}

function ResultCard({ event: ev, highlighted }: CardProps) {
  const preview = 'preview' in ev ? String(ev.preview) : ''

  return (
    <div
      className={[
        'bg-surface rounded-lg p-3 flex flex-col gap-1.5',
        'border border-border',
        highlighted ? 'ring-1 ring-success/40 border-success' : '',
      ].join(' ')}
    >
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-success/15 text-success-deep uppercase">
          RESULT
        </span>
        {ev.tool != null && (
          <span className="text-[10px] font-mono text-fg">{String(ev.tool)}</span>
        )}
        {ev.ts != null && (
          <span className="text-[9px] text-fg-subtle ml-auto">{formatTimestamp(ev.ts)}</span>
        )}
      </div>
      {preview && (
        <pre className="text-[11px] font-mono text-fg-muted leading-relaxed whitespace-pre-wrap">
          {preview}
        </pre>
      )}
    </div>
  )
}

function ThinkingCard({ event: ev, highlighted }: CardProps) {
  const text = String(ev.content ?? ev.text ?? '')

  return (
    <div
      className={[
        'bg-surface rounded-lg p-3 flex flex-col gap-1.5',
        'border border-border',
        highlighted ? 'ring-1 ring-accent-purple/40 border-accent-purple' : '',
      ].join(' ')}
    >
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-accent-purple/15 text-accent-purple-deep uppercase">
          THINKING
        </span>
        {ev.ts != null && (
          <span className="text-[9px] text-fg-subtle ml-auto">{formatTimestamp(ev.ts)}</span>
        )}
      </div>
      {text && (
        <p className="text-[11px] italic text-fg-muted leading-relaxed">{text}</p>
      )}
    </div>
  )
}

function DoneCard({ event: ev, highlighted }: CardProps) {
  return (
    <div
      className={[
        'bg-surface rounded-lg p-3 flex flex-col gap-1.5',
        'border border-border',
        highlighted ? 'ring-1 ring-fg-muted/40 border-fg-muted' : '',
      ].join(' ')}
    >
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-fg-subtle/15 text-fg-muted uppercase">
          DONE
        </span>
        {ev.tool != null && (
          <span className="text-[10px] font-mono text-fg">{String(ev.tool)}</span>
        )}
        {ev.ts != null && (
          <span className="text-[9px] text-fg-subtle ml-auto">{formatTimestamp(ev.ts)}</span>
        )}
      </div>
    </div>
  )
}

// ── Card selector ──────────────────────────────────────────────────────────

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

// ── EventFeed ──────────────────────────────────────────────────────────────

export function EventFeed({ events }: { events: AIEvent[] }) {
  if (events.length === 0) return <div className="flex-1" />

  const lastIndex = events.length - 1

  return (
    <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
      {events.map((ev, i) => (
        <EventCard key={i} event={ev} highlighted={i === lastIndex} />
      ))}
    </div>
  )
}
