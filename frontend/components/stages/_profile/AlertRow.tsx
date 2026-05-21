// frontend/components/stages/_profile/AlertRow.tsx
'use client'
import { Chip } from '@/components/ui/Chip'
import { chipTone } from './chip-classes'

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
    <li className="bg-surface border border-border rounded-lg py-3.5 px-4 flex flex-col gap-1.5 list-none">
      <div className="flex items-center gap-2.5">
        <span className="text-[13px] font-semibold text-fg">{column || 'Table-level'}</span>
        {type && (
          <Chip variant="status" tone={chipTone(type)}>{type}</Chip>
        )}
      </div>
      {description && <p className="text-xs text-fg-muted leading-relaxed">{description}</p>}
    </li>
  )
}
