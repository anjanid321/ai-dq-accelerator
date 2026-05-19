// frontend/__tests__/stages/_profile/chip-classes.test.ts
import { chipClasses } from '@/components/stages/_profile/chip-classes'

describe('chipClasses', () => {
  describe('warning bucket (amber)', () => {
    it.each(['Missing', 'missing', 'MISSING', 'Constant', 'constant'])(
      'maps %s to warning',
      (input) => {
        const cls = chipClasses(input)
        expect(cls).toContain('bg-warning/15')
        expect(cls).toContain('text-warning-deep')
      },
    )
  })

  describe('info bucket (blue)', () => {
    it.each(['High Cardinality', 'high cardinality', 'Duplicates', 'Skewness', 'Skew'])(
      'maps %s to info',
      (input) => {
        const cls = chipClasses(input)
        expect(cls).toContain('bg-info/15')
        expect(cls).toContain('text-info-deep')
      },
    )
  })

  describe('danger bucket (red fallback)', () => {
    it.each(['Type Mismatch', 'Some Future Alert', 'unknown', ''])(
      'maps %s (unrecognized) to danger',
      (input) => {
        const cls = chipClasses(input)
        expect(cls).toContain('bg-danger/15')
        expect(cls).toContain('text-danger-deep')
      },
    )

    it('handles null and undefined safely', () => {
      expect(chipClasses(null)).toContain('text-danger-deep')
      expect(chipClasses(undefined)).toContain('text-danger-deep')
    })
  })
})
