import { Chip } from '@/components/ui/Chip'
import { dimensionTokens } from '@/lib/dq/dimensions'

interface Props {
  dimension: string
  className?: string
}

export function DimensionChip({ dimension, className = '' }: Props) {
  const t = dimensionTokens(dimension)
  return (
    <Chip variant="status" tone={t.tone} className={className}>
      <span data-dimension={t.label.toLowerCase()}>{t.label}</span>
    </Chip>
  )
}
