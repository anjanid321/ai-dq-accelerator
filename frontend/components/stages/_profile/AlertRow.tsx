// frontend/components/stages/_profile/AlertRow.tsx
'use client'
import { chipClasses } from './chip-classes'

export interface AlertEntry {
  column?: string
  type?: string
  description?: string
}

interface Props {
  alert: AlertEntry
}

export function AlertRow({ alert }: Props) {
  const { column, type, description } = alert
  return (
    <li className="bg-surface border border-border rounded-lg p-3 flex flex-col gap-1.5 list-none">
      <div className="flex items-center gap-2.5">
        <span className="text-[13px] font-semibold text-fg">{column || 'Table-level'}</span>
        {type && (
          <span className={`${chipClasses(type)} text-[11px] font-semibold px-2 py-0.5 rounded-md`}>
            {type}
          </span>
        )}
      </div>
      {description && <p className="text-xs text-fg-muted leading-relaxed">{description}</p>}
    </li>
  )
}
