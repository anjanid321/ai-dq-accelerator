import Link from 'next/link'
import { Logo } from '@/components/theme/Logo'

interface Props {
  filename: string
  rowCount?: number
  colCount?: number
  currentScore?: number
}

export function TopBar({ filename, rowCount, colCount, currentScore }: Props) {
  const pct = currentScore != null ? Math.round(currentScore * 100) : null

  const variant =
    pct === null ? null : pct >= 90 ? 'success' : pct >= 70 ? 'warning' : 'danger'

  const chipClass =
    variant === 'success'
      ? 'border-success text-success-deep'
      : variant === 'warning'
      ? 'border-warning text-warning-deep'
      : 'border-danger text-danger-deep'

  return (
    <div className="h-14 bg-elevated border-b border-border flex items-center gap-3 px-4 shrink-0">
      {/* Logo */}
      <Logo />

      {/* App title */}
      <span className="text-sm font-semibold text-fg">DQ Accelerator</span>

      {/* Vertical separator */}
      <span className="w-px h-[18px] bg-border self-center" />

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
      {pct !== null && variant !== null && (
        <div
          data-variant={variant}
          className={`bg-surface border rounded-full px-2.5 py-0.5 text-xs font-semibold ${chipClass}`}
        >
          Score: {pct}%
        </div>
      )}

      {/* Three-dots overflow indicator */}
      <span className="inline-flex items-center gap-0.5">
        <span className="w-[3px] h-[3px] rounded-full bg-fg-muted" />
        <span className="w-[3px] h-[3px] rounded-full bg-fg-muted" />
        <span className="w-[3px] h-[3px] rounded-full bg-fg-muted" />
      </span>
    </div>
  )
}
