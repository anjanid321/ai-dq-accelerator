export const DIMENSION_IDS = [
  'validity',
  'completeness',
  'uniqueness',
  'consistency',
] as const

export type DimensionId = (typeof DIMENSION_IDS)[number]

export interface DimensionTokens {
  /** Tailwind class fragment for the 8% tinted fill, e.g. 'bg-category-teal/[0.08]' */
  fillClass: string
  /** Tailwind class fragment for the deep text color, e.g. 'text-category-teal-deep' */
  textClass: string
  /** Human-readable label (capitalized). */
  label: string
}

const NEUTRAL: DimensionTokens = {
  fillClass: 'bg-category-slate/[0.08]',
  textClass: 'text-category-slate-deep',
  label: '',
}

const MAP: Record<DimensionId, DimensionTokens> = {
  completeness: { fillClass: 'bg-category-teal/[0.08]',  textClass: 'text-category-teal-deep',  label: 'Completeness' },
  validity:     { fillClass: 'bg-category-rose/[0.08]',  textClass: 'text-category-rose-deep',  label: 'Validity'     },
  uniqueness:   { fillClass: 'bg-category-amber/[0.08]', textClass: 'text-category-amber-deep', label: 'Uniqueness'   },
  consistency:  { fillClass: 'bg-category-slate/[0.08]', textClass: 'text-category-slate-deep', label: 'Consistency'  },
}

export function dimensionTokens(rawId: string): DimensionTokens {
  const normalized = rawId.toLowerCase().trim()
  if (normalized in MAP) return MAP[normalized as DimensionId]
  // Fallback: unknown dimension renders with the neutral slate token, label = capitalized input.
  return {
    ...NEUTRAL,
    label: normalized.charAt(0).toUpperCase() + normalized.slice(1),
  }
}
