import Link from 'next/link'

interface Props {
  filename: string
  rowCount?: number
  colCount?: number
  currentScore?: number
}

export function TopBar({ filename, rowCount, colCount, currentScore }: Props) {
  const pct = currentScore ? Math.round(currentScore * 100) : null
  const scoreColor = pct === null ? '' : pct >= 90 ? 'text-success-light border-success/40 bg-success/10' : pct >= 70 ? 'text-warning border-warning/40 bg-warning/10' : 'text-danger-light border-danger/40 bg-danger/10'

  return (
    <div className="h-11 bg-elevated border-b border-border flex items-center gap-3 px-4 shrink-0">
      <div className="w-6 h-6 rounded-md flex items-center justify-center text-xs shrink-0" style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>⬡</div>
      <Link href="/" className="text-text-muted text-xs hover:text-text-secondary">← Sessions</Link>
      <span className="text-border">/</span>
      <span className="font-semibold text-sm text-text-primary">{filename}</span>
      {rowCount && <span className="text-xs text-text-muted">{rowCount.toLocaleString()} rows · {colCount} cols</span>}
      {pct !== null && (
        <div className={`ml-auto border rounded-full px-2.5 py-0.5 text-xs font-semibold ${scoreColor}`}>
          Score: {pct}%
        </div>
      )}
    </div>
  )
}
