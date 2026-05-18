import { dimensionTokens } from '@/lib/dq/dimensions'

interface Props {
  dimension: string
  className?: string
}

export function DimensionChip({ dimension, className = '' }: Props) {
  const t = dimensionTokens(dimension)
  return (
    <span
      data-dimension={t.label.toLowerCase()}
      className={[
        'inline-flex items-center px-2 py-1 rounded-md text-[12px] font-medium tracking-tight',
        t.fillClass,
        t.textClass,
        className,
      ].join(' ')}
    >
      {t.label}
    </span>
  )
}
