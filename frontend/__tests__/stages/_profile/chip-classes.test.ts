// frontend/__tests__/stages/_profile/chip-classes.test.ts
import { chipTone } from '@/components/stages/_profile/chip-classes'

describe('chipTone', () => {
  describe('warning bucket', () => {
    it.each(['Missing', 'missing', 'MISSING', 'Constant', 'constant'])(
      'maps %s to warning',
      (input) => {
        expect(chipTone(input)).toBe('warning')
      },
    )
  })

  describe('info bucket', () => {
    it.each(['High Cardinality', 'high cardinality', 'Duplicates', 'Skewness', 'Skew'])(
      'maps %s to info',
      (input) => {
        expect(chipTone(input)).toBe('info')
      },
    )
  })

  describe('danger bucket', () => {
    it.each(['Type Mismatch', 'Some Future Alert', 'unknown', ''])(
      'maps %s (unrecognized) to danger',
      (input) => {
        expect(chipTone(input)).toBe('danger')
      },
    )

    it('handles null and undefined safely', () => {
      expect(chipTone(null)).toBe('danger')
      expect(chipTone(undefined)).toBe('danger')
    })
  })
})
