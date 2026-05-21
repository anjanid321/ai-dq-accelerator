import Link from 'next/link'
import { Ellipsis } from 'lucide-react'
import { Logo } from '@/components/theme/Logo'
import { Chip, type ScoreTone } from '@/components/ui/Chip'

interface Props {
  filename: string
  rowCount?: number
  colCount?: number
  currentScore?: number
}

export function TopBar({ filename, rowCount, colCount, currentScore }: Props) {
  const pct = currentScore != null ? Math.round(currentScore * 100) : null
  const tone: ScoreTone | null =
    pct === null ? null : pct >= 90 ? 'success' : pct >= 70 ? 'warning' : 'danger'

  return (
    <div className="h-14 bg-surface border-b border-border flex items-center gap-3 px-4 shrink-0">
      {/* Logo */}
      <Logo />

      {/* App title */}
      <span className="text-sm font-semibold text-fg">DQ Accelerator</span>

      {/* Vertical separator */}
      <span className="w-px h-[18px] bg-border-strong self-center" />

      {/* Sessions link */}
      <Link href="/" className="text-sm text-fg-muted hover:text-fg">
        ← Sessions
      </Link>

      {/* Breadcrumb slash */}
      <span className="text-border-strong">/</span>

      {/* Filename */}
      <span className="text-sm font-semibold text-fg">{filename}</span>

      {/* Row/col metadata */}
      {rowCount != null && (
        <span className="text-xs text-fg-muted">
          {rowCount.toLocaleString()} rows · {colCount} cols
        </span>
      )}

      {/* Spacer */}
      <span className="flex-1" />

      {/* Score chip */}
      {pct !== null && tone !== null && (
        <Chip variant="score" tone={tone}>
          <span data-variant={tone}>Score: {pct}%</span>
        </Chip>
      )}

      {/* Three-dots overflow indicator */}
      <Ellipsis size={16} strokeWidth={2} className="text-fg-muted" />
    </div>
  )
}
