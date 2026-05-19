// frontend/components/stages/_profile/chip-classes.ts

/**
 * Map a ydata-profiling alert `type` string to the Tailwind class set that
 * styles the chip in the Profile stage's alert list. Three buckets:
 *
 *  - Missing / Constant            → warning (amber)
 *  - High Cardinality / Duplicates / Skewness → info (blue)
 *  - Anything else                 → danger (red, intentional fallback so new
 *                                   alert types still surface visibly)
 *
 * Case-insensitive and null/undefined safe so we don't have to enumerate every
 * upstream variant.
 */
export function chipClasses(type: string | null | undefined): string {
  const t = (type ?? '').toLowerCase()
  if (t.includes('missing') || t.includes('constant')) {
    return 'bg-warning/15 text-warning-deep'
  }
  if (t.includes('cardinality') || t.includes('duplicate') || t.includes('skew')) {
    return 'bg-info/15 text-info-deep'
  }
  return 'bg-danger/15 text-danger-deep'
}
