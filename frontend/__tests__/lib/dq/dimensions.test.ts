import { dimensionTokens, DIMENSION_IDS } from '@/lib/dq/dimensions'

describe('dimensionTokens', () => {
  it.each(DIMENSION_IDS)('returns a non-empty mapping for known dimension %s', (id) => {
    const t = dimensionTokens(id)
    expect(t.fillClass).toMatch(/^bg-category-/)
    expect(t.textClass).toMatch(/^text-category-.*-deep$/)
    expect(t.label.length).toBeGreaterThan(0)
  })

  it('handles case- and whitespace-insensitive matching', () => {
    expect(dimensionTokens(' VALIDITY ').textClass).toBe('text-category-rose-deep')
  })

  it('falls back to slate for an unknown dimension', () => {
    const t = dimensionTokens('timeliness')
    expect(t.fillClass).toBe('bg-category-slate/15')
    expect(t.textClass).toBe('text-category-slate-deep')
    expect(t.label).toBe('Timeliness')
  })
})
