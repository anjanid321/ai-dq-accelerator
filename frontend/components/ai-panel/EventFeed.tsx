import type { AIEvent } from '@/hooks/useAIStream'

const BORDER: Record<string, string> = {
  tool_call: 'border-l-indigo',
  tool_result: 'border-l-success',
  thinking: 'border-l-purple',
}
const BADGE_STYLE: Record<string, string> = {
  tool_call: 'bg-indigo/20 text-indigo-light',
  tool_result: 'bg-success/20 text-success-light',
  thinking: 'bg-purple/20 text-purple-light',
}
const BADGE_LABEL: Record<string, string> = {
  tool_call: 'TOOL CALL',
  tool_result: 'RESULT',
  thinking: 'THINKING',
}

export function EventFeed({ events }: { events: AIEvent[] }) {
  return (
    <div className="flex-1 overflow-y-auto p-2.5 flex flex-col gap-1.5">
      {events.map((ev, i) => (
        <div key={i} className={`bg-surface rounded-lg p-2 border-l-2 ${BORDER[ev.event] ?? 'border-l-border'}`}>
          <div className="flex items-center gap-1.5 mb-1">
            <span className={`text-[9px] font-mono px-1 py-0.5 rounded font-semibold ${BADGE_STYLE[ev.event] ?? ''}`}>
              {BADGE_LABEL[ev.event] ?? ev.event.toUpperCase()}
            </span>
            {ev.tool != null && <span className="text-[10px] font-mono text-text-primary">{String(ev.tool)}</span>}
            {ev.ts != null && <span className="text-[9px] text-border ml-auto">{new Date(ev.ts as string).toLocaleTimeString()}</span>}
          </div>
          {ev.event === 'thinking'
            ? <p className="text-[10px] text-text-secondary italic leading-relaxed">{String(ev.content ?? ev.text ?? '')}</p>
            : ev.event === 'tool_call'
                ? <pre className="text-[10px] font-mono text-text-muted leading-relaxed whitespace-pre-wrap">{JSON.stringify(ev.input ?? ev.params ?? {}, null, 0).replace(/[{}]/g, '').trim()}</pre>
                : ev.event === 'tool_result'
                    ? <pre className="text-[10px] font-mono text-text-muted leading-relaxed whitespace-pre-wrap">{'preview' in ev ? String(ev.preview) : ''}</pre>
                    : <pre className="text-[10px] font-mono text-text-muted leading-relaxed whitespace-pre-wrap">{JSON.stringify(ev.params ?? ev.result ?? ev.output ?? {}, null, 0).replace(/[{}]/g, '').trim()}</pre>
          }
        </div>
      ))}
    </div>
  )
}
