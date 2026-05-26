// frontend/__tests__/ui/Chip.test.tsx
import { render, screen } from '@testing-library/react'
import { Chip, type StatusTone } from '@/components/ui/Chip'

const STATUS_TONE_EXPECTATIONS: Array<[StatusTone, string, string]> = [
  ['success',        'bg-success/15',        'text-success-deep'],
  ['warning',        'bg-warning/15',        'text-warning-deep'],
  ['danger',         'bg-danger/15',         'text-danger-deep'],
  ['info',           'bg-info/15',           'text-info-deep'],
  ['accent-purple',  'bg-accent-purple/15',  'text-accent-purple-deep'],
  ['accent-indigo',  'bg-accent-indigo/15',  'text-accent-indigo-deep'],
  ['neutral',        'bg-fg-subtle/15',      'text-fg-muted'],
]

describe('Chip', () => {
  describe('variant=status', () => {
    it.each(STATUS_TONE_EXPECTATIONS)(
      'tone=%s applies %s + %s',
      (tone, bgClass, textClass) => {
        render(<Chip variant="status" tone={tone}>Label</Chip>)
        const el = screen.getByText('Label')
        expect(el.className).toContain('inline-flex')
        expect(el.className).toContain('px-2')
        expect(el.className).toContain('py-0.5')
        expect(el.className).toContain('rounded-md')
        expect(el.className).toContain('text-xs')
        expect(el.className).toContain('font-semibold')
        expect(el.className).toContain(bgClass)
        expect(el.className).toContain(textClass)
      },
    )

    it('does NOT apply a border class on the status variant', () => {
      render(<Chip variant="status" tone="danger">Failed · 152</Chip>)
      const el = screen.getByText('Failed · 152')
      // Foundation tokens use `border-border` etc. for chrome; status chips shouldn't.
      expect(el.className).not.toContain('border ')
      expect(el.className).not.toMatch(/border-[a-z]+/)
    })
  })

  describe('variant=neutral', () => {
    it('applies bg-elevated + border-border + text-fg-muted without a value slot', () => {
      render(<Chip variant="neutral">Round 1 of 3</Chip>)
      const label = screen.getByText('Round 1 of 3')
      const chip = label.parentElement as HTMLElement
      expect(chip.className).toContain('bg-elevated')
      expect(chip.className).toContain('border')
      expect(chip.className).toContain('border-border')
      expect(chip.className).toContain('text-fg-muted')
      expect(chip.className).toContain('font-semibold')
      // value-only chrome should be absent
      expect(chip.className).not.toContain('gap-1.5')
    })

    it('renders the value span with text-fg and applies gap-1.5 when value is provided', () => {
      render(<Chip variant="neutral" value="78%">validity</Chip>)
      const label = screen.getByText('validity')
      const value = screen.getByText('78%')
      // both are inside the same chip
      expect(label.parentElement).toBe(value.parentElement)
      const chip = label.parentElement as HTMLElement
      expect(chip.className).toContain('gap-1.5')
      expect(value.className).toContain('text-fg')
    })
  })

  describe('variant=score', () => {
    it.each<[Exclude<StatusTone, 'info' | 'accent-purple' | 'accent-indigo' | 'neutral'>, string, string]>([
      ['success', 'border-success', 'text-success-deep'],
      ['warning', 'border-warning', 'text-warning-deep'],
      ['danger',  'border-danger',  'text-danger-deep'],
    ])('tone=%s applies %s + %s on the outline pill', (tone, borderClass, textClass) => {
      render(<Chip variant="score" tone={tone}>Score: 82%</Chip>)
      const el = screen.getByText('Score: 82%')
      expect(el.className).toContain('rounded-full')
      expect(el.className).toContain('bg-surface')
      expect(el.className).toContain('px-2.5')
      expect(el.className).toContain('py-0.5')
      expect(el.className).toContain('text-xs')
      expect(el.className).toContain('font-semibold')
      expect(el.className).toContain(borderClass)
      expect(el.className).toContain(textClass)
    })
  })

  describe('className passthrough', () => {
    it('appends a custom className on the status variant', () => {
      render(<Chip variant="status" tone="success" className="ml-2">Done</Chip>)
      expect(screen.getByText('Done').className).toContain('ml-2')
    })

    it('appends a custom className on the neutral variant', () => {
      render(<Chip variant="neutral" className="ml-2">Round 1 of 3</Chip>)
      expect(screen.getByText('Round 1 of 3').parentElement?.className).toContain('ml-2')
    })

    it('appends a custom className on the score variant', () => {
      render(<Chip variant="score" tone="success" className="ml-2">Score: 82%</Chip>)
      expect(screen.getByText('Score: 82%').className).toContain('ml-2')
    })
  })
})
