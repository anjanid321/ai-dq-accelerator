// frontend/components/stages/_profile/chip-classes.ts
import type { StatusTone } from '@/components/ui/Chip'

/**
 * Map a ydata-profiling alert `type` string to the StatusTone used by the
 * Chip primitive. Three buckets:
 *
 *  - Missing / Constant                       → warning (amber)
 *  - High Cardinality / Duplicates / Skewness → info (blue)
 *  - Anything else                            → danger (red, intentional
 *                                               fallback so new alert types
 *                                               still surface visibly)
 *
 * Case-insensitive and null/undefined safe so we don't have to enumerate every
 * upstream variant.
 */
export function chipTone(type: string | null | undefined): StatusTone {
  const t = (type ?? '').toLowerCase()
  if (t.includes('missing') || t.includes('constant')) return 'warning'
  if (t.includes('cardinality') || t.includes('duplicate') || t.includes('skew')) return 'info'
  return 'danger'
}
