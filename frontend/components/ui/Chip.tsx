// frontend/components/ui/Chip.tsx
//
// Unified chip primitive. Three variants:
//   - status: semantic-colored soft-fill, no border (PASSED, alert types,
//     stage statuses, AI event badges, DQ dimensions)
//   - neutral: neutral elevated bg with a 1px border (Round counter, file-type
//     chips, category labels). Optional `value` renders a second
//     text-fg-emphasized span inside the same chip (e.g. "validity 78%").
//   - score: outline-only rounded-full pill, used only on the TopBar score
//     readout. Intentional exception kept distinct from the rest.
'use client'
import type { ReactNode } from 'react'

export type StatusTone =
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'accent-purple'
  | 'accent-indigo'
  | 'neutral'

export type ScoreTone = 'success' | 'warning' | 'danger'

type StatusProps = {
  variant: 'status'
  tone: StatusTone
  children: ReactNode
  className?: string
}

type NeutralProps = {
  variant: 'neutral'
  children: ReactNode
  value?: ReactNode
  className?: string
}

type ScoreProps = {
  variant: 'score'
  tone: ScoreTone
  children: ReactNode
  className?: string
}

type Props = StatusProps | NeutralProps | ScoreProps

const STATUS_TONE_CLASSES: Record<StatusTone, string> = {
  success: 'bg-success/15 text-success-deep',
  warning: 'bg-warning/15 text-warning-deep',
  danger: 'bg-danger/15 text-danger-deep',
  info: 'bg-info/15 text-info-deep',
  'accent-purple': 'bg-accent-purple/15 text-accent-purple-deep',
  'accent-indigo': 'bg-accent-indigo/15 text-accent-indigo-deep',
  neutral: 'bg-fg-subtle/15 text-fg-muted',
}

const SCORE_TONE_CLASSES: Record<ScoreTone, string> = {
  success: 'border-success text-success-deep',
  warning: 'border-warning text-warning-deep',
  danger: 'border-danger text-danger-deep',
}

const BASE_STATUS_OR_NEUTRAL =
  'inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold'
const BASE_NEUTRAL_CHROME = 'bg-elevated border border-border text-fg-muted'
const BASE_SCORE =
  'inline-flex items-center bg-surface border rounded-full px-2.5 py-0.5 text-xs font-semibold'

export function Chip(props: Props) {
  if (props.variant === 'status') {
    const cls = [
      BASE_STATUS_OR_NEUTRAL,
      STATUS_TONE_CLASSES[props.tone],
      props.className ?? '',
    ]
      .filter(Boolean)
      .join(' ')
    return <span className={cls}>{props.children}</span>
  }

  if (props.variant === 'neutral') {
    const cls = [
      BASE_STATUS_OR_NEUTRAL,
      BASE_NEUTRAL_CHROME,
      props.value != null ? 'gap-1.5' : '',
      props.className ?? '',
    ]
      .filter(Boolean)
      .join(' ')
    return (
      <span className={cls}>
        <span>{props.children}</span>
        {props.value != null && <span className="text-fg">{props.value}</span>}
      </span>
    )
  }

  // score
  const cls = [BASE_SCORE, SCORE_TONE_CLASSES[props.tone], props.className ?? '']
    .filter(Boolean)
    .join(' ')
  return <span className={cls}>{props.children}</span>
}
