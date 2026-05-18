# Rules Stage Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Rules stage UI in `frontend/components/stages/RulesStage.tsx` to match the approved Figma frames — token-driven dimension chips, decoupled Edit affordance, word+icon buttons, reversible decisions, multi-select with bulk Approve/Deny/Clear, and a primary CTA in the new brand-accent style. Adopt Lucide as the canonical icon library and retrofit the three Round 1 icon mismatches in the same change.

**Architecture:** Decompose the existing 145-line `RulesStage.tsx` into a parent + five children (`RuleCard`, `RuleInlineEditor`, `DimensionChip`, `SelectionToolbar`, `DecisionFooter`) plus a `lib/dq/dimensions.ts` map. State lives in the parent. Icons come from `lucide-react`. New tokens (`category-{teal,rose,amber,slate}` + `-deep` siblings) are added at the System level in `globals.css` and `tailwind.config.ts`.

**Tech Stack:** Next 16, React 19, TypeScript 5, Tailwind 3.4, Jest 30 + ts-jest + jsdom + @testing-library/react. New dependency: `lucide-react`.

**Spec:** `docs/superpowers/specs/2026-05-17-rules-stage-redesign.md`

**Pre-locked decisions** (from spec follow-ups):
1. `approveRules` wire shape is unchanged — still `{ approved_rules, rejected_rule_ids }` on the body. UI-internal value `'denied'` maps to `rejected_rule_ids` at submit time.
2. "Approve all" is **hidden in selection mode** (the bulk action bar covers that need).
3. `Clear N` clears **decisions** of selected rules but **keeps the selection** so the user can re-decide without re-selecting.

---

## File Structure

```
frontend/
  app/sessions/[id]/page.tsx                       # unchanged signature; consumer of RulesStage
  components/
    stages/
      RulesStage.tsx                               # MODIFIED — parent orchestrator (state owner)
    rules/                                         # NEW directory for stage-scoped components
      RuleCard.tsx                                 # NEW
      RuleInlineEditor.tsx                         # NEW
      SelectionToolbar.tsx                         # NEW
      DecisionFooter.tsx                           # NEW
    dq/
      DimensionChip.tsx                            # NEW (cross-stage; reusable)
    workspace/
      Stepper.tsx                                  # MODIFIED — Lucide Check
      TopBar.tsx                                   # MODIFIED — Lucide Ellipsis
    ai-panel/
      AIPanel.tsx                                  # MODIFIED — Lucide Pause
  lib/
    dq/
      dimensions.ts                                # NEW — DimensionId + dimension→token map
  app/globals.css                                  # MODIFIED — add 8 new category-* vars
  tailwind.config.ts                               # MODIFIED — wire category-* tokens
  __tests__/
    lib/dq/
      dimensions.test.ts                           # NEW
    components/
      dq/DimensionChip.test.tsx                    # NEW
      rules/
        RuleCard.test.tsx                          # NEW
        SelectionToolbar.test.tsx                  # NEW
        DecisionFooter.test.tsx                    # NEW
      stages/
        RulesStage.test.tsx                        # NEW (selection persistence + bulk behavior)
```

Path alias `@/` resolves to `frontend/` (existing).

---

## Phase 0 — Prep

### Task 0.1: Install lucide-react

**Files:**
- Modify: `frontend/package.json`

- [ ] **Step 1: Install the dependency**

```bash
cd frontend && npm install lucide-react
```

- [ ] **Step 2: Verify it landed in package.json**

```bash
cd frontend && grep lucide-react package.json
```
Expected: a line like `"lucide-react": "^0.x.y"`.

- [ ] **Step 3: Confirm a tree-shaken import resolves**

```bash
cd frontend && node -e "console.log(typeof require('lucide-react').Check)"
```
Expected: `function`.

- [ ] **Step 4: Commit**

```bash
git add frontend/package.json frontend/package-lock.json
git commit -m "build: add lucide-react as canonical icon library"
```

---

## Phase 1 — Round 1 Lucide retrofit

These are small, isolated edits to shipped components — get them out of the way so the rest of Round 2 work is on a fully consistent icon system.

### Task 1.1: Stepper done-state check → Lucide Check

**Files:**
- Modify: `frontend/components/workspace/Stepper.tsx:36-44`

- [ ] **Step 1: Update the `done` branch of `StageCircle`**

Replace the inline `<svg>` with the Lucide `Check` component. Stroke color comes from `currentColor` so the parent's text color drives it.

```tsx
import { Check } from 'lucide-react'

// ...inside StageCircle:
if (state === 'done') {
  return (
    <div className="w-[18px] h-[18px] rounded-full bg-success shrink-0 flex items-center justify-center text-fg-inverse">
      <Check size={10} strokeWidth={2.5} />
    </div>
  )
}
```

- [ ] **Step 2: Type-check + tests**

```bash
cd frontend && npx tsc --noEmit && npx jest __tests__/components/workspace
```
Expected: clean tsc, all existing tests pass.

- [ ] **Step 3: Do NOT commit yet** — Phase 1's three icon swaps go in one commit at the end of Task 1.3.

### Task 1.2: AIPanel WaitingBanner pause → Lucide Pause

**Files:**
- Modify: `frontend/components/ai-panel/AIPanel.tsx:55-65` (the WaitingBanner footer bar)

- [ ] **Step 1: Replace the two `<div>` rectangles with `<Pause />`**

```tsx
import { Pause } from 'lucide-react'

// ...inside the WaitingBanner footer JSX:
{waitingMessage && (
  <div className="w-full bg-elevated border-t border-border py-3.5 px-3 flex items-center justify-center gap-2 shrink-0 text-fg-muted">
    <Pause size={14} strokeWidth={2} />
    <span className="text-[12px] font-semibold">{waitingMessage}</span>
  </div>
)}
```

(The wrapping `<div>` gets the `text-fg-muted` so both the icon's `currentColor` stroke and the label inherit.)

- [ ] **Step 2: Type-check**

```bash
cd frontend && npx tsc --noEmit
```
Expected: clean.

### Task 1.3: TopBar overflow indicator → Lucide Ellipsis

**Files:**
- Modify: `frontend/components/workspace/TopBar.tsx:67-71` (the three-circle span)

- [ ] **Step 1: Replace the three `<span>` dots with `<Ellipsis />`**

```tsx
import { Ellipsis } from 'lucide-react'

// ...replacing the three-dot span at the end of TopBar JSX:
<Ellipsis size={16} strokeWidth={2} className="text-fg-muted" />
```

- [ ] **Step 2: Type-check + run all tests**

```bash
cd frontend && npx tsc --noEmit && npx jest __tests__/components/workspace
```
Expected: clean, 6/6 TopBar tests still pass (none assert on the overflow indicator markup).

- [ ] **Step 3: Commit Phase 1 (all three icon retrofits together)**

```bash
git add frontend/components/workspace/Stepper.tsx frontend/components/workspace/TopBar.tsx frontend/components/ai-panel/AIPanel.tsx
git commit -m "fix(icons): retrofit Round 1 components to Lucide

Stepper done-state check, AIPanel WaitingBanner pause, and TopBar
overflow indicator now use lucide-react. Removes the inconsistency
between the custom Stepper polyline and Unicode glyphs/hand-drawn
rectangles elsewhere. All existing tests still pass — no markup
assertions covered the swapped elements."
```

---

## Phase 2 — Token additions

### Task 2.1: Add category-* CSS variables to globals.css

**Files:**
- Modify: `frontend/app/globals.css` (insert after the `accent-indigo-deep` line)

- [ ] **Step 1: Add eight new variables under `:root`**

Insert this block immediately after `--color-accent-indigo-deep: #3730A3;` and before the `/* Type */` block:

```css
  /* Category (DQ dimension chips — system-level, not theme-scoped) */
  --color-category-teal:       #0D9488;
  --color-category-teal-deep:  #115E59;
  --color-category-rose:       #DB2777;
  --color-category-rose-deep:  #9D174D;
  --color-category-amber:      #92400E;
  --color-category-amber-deep: #451A03;
  --color-category-slate:      #475569;
  --color-category-slate-deep: #334155;
```

- [ ] **Step 2: Verify the CSS is still valid**

```bash
cd frontend && npm run build 2>&1 | tail -5
```
Expected: build succeeds (this verifies Tailwind + PostCSS can parse the file).

- [ ] **Step 3: Do NOT commit yet** — Phase 2's two changes go together at end of Task 2.2.

### Task 2.2: Wire category-* tokens in Tailwind

**Files:**
- Modify: `frontend/tailwind.config.ts` (extend the `colors` block)

- [ ] **Step 1: Add the eight category color mappings**

Insert into `theme.extend.colors`, anywhere after the existing `accent-indigo-deep` mapping:

```ts
        // Category (DQ dimension chips)
        'category-teal':       'var(--color-category-teal)',
        'category-teal-deep':  'var(--color-category-teal-deep)',
        'category-rose':       'var(--color-category-rose)',
        'category-rose-deep':  'var(--color-category-rose-deep)',
        'category-amber':      'var(--color-category-amber)',
        'category-amber-deep': 'var(--color-category-amber-deep)',
        'category-slate':      'var(--color-category-slate)',
        'category-slate-deep': 'var(--color-category-slate-deep)',
```

- [ ] **Step 2: Build to verify Tailwind picks them up**

```bash
cd frontend && npm run build 2>&1 | tail -5
```
Expected: build succeeds.

- [ ] **Step 3: Commit Phase 2**

```bash
git add frontend/app/globals.css frontend/tailwind.config.ts
git commit -m "style(tokens): add category-* color family for DQ dimension chips

Eight new System tokens (teal, rose, amber, slate × base + -deep)
backing the redesigned dimension chips in the Rules stage. System-
level, not theme-scoped — these don't vary by client."
```

---

## Phase 3 — Dimension support library

### Task 3.1: Create `lib/dq/dimensions.ts`

**Files:**
- Create: `frontend/lib/dq/dimensions.ts`

- [ ] **Step 1: Write the module**

```ts
// frontend/lib/dq/dimensions.ts

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
```

- [ ] **Step 2: Type-check**

```bash
cd frontend && npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 3: Do NOT commit yet** — combined with 3.2 test commit.

### Task 3.2: Test the dimension fallback

**Files:**
- Create: `frontend/__tests__/lib/dq/dimensions.test.ts`

- [ ] **Step 1: Write the test**

```ts
// frontend/__tests__/lib/dq/dimensions.test.ts
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
    expect(t.fillClass).toBe('bg-category-slate/[0.08]')
    expect(t.textClass).toBe('text-category-slate-deep')
    expect(t.label).toBe('Timeliness') // capitalized input
  })
})
```

- [ ] **Step 2: Run the test**

```bash
cd frontend && npx jest __tests__/lib/dq/dimensions.test.ts
```
Expected: 6 passing assertions (4 from `it.each` + 2 others). Confirm count.

- [ ] **Step 3: Commit Phase 3**

```bash
git add frontend/lib/dq/ frontend/__tests__/lib/dq/
git commit -m "feat(dq): add dimension token map with safe fallback

DimensionId union + dimensionTokens() resolver maps validity/
completeness/uniqueness/consistency to category-* token classes.
Unknown dimensions fall back to slate so future backends adding new
dimensions never break the chip rendering."
```

---

## Phase 4 — DimensionChip component

### Task 4.1: Create `DimensionChip.tsx`

**Files:**
- Create: `frontend/components/dq/DimensionChip.tsx`

- [ ] **Step 1: Write the component**

```tsx
// frontend/components/dq/DimensionChip.tsx
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
```

- [ ] **Step 2: Write the test**

Create: `frontend/__tests__/components/dq/DimensionChip.test.tsx`

```tsx
import { render, screen } from '@testing-library/react'
import { DimensionChip } from '@/components/dq/DimensionChip'

describe('DimensionChip', () => {
  it('renders the capitalized label for a known dimension', () => {
    render(<DimensionChip dimension="validity" />)
    expect(screen.getByText('Validity')).toBeInTheDocument()
  })

  it('renders the capitalized input for an unknown dimension', () => {
    render(<DimensionChip dimension="timeliness" />)
    expect(screen.getByText('Timeliness')).toBeInTheDocument()
  })

  it('exposes data-dimension attribute (lowercase) for selection in tests', () => {
    render(<DimensionChip dimension="Completeness" />)
    expect(screen.getByText('Completeness')).toHaveAttribute('data-dimension', 'completeness')
  })
})
```

- [ ] **Step 3: Run the tests**

```bash
cd frontend && npx jest __tests__/components/dq/DimensionChip.test.tsx
```
Expected: 3/3 pass.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/dq/ frontend/__tests__/components/dq/
git commit -m "feat(dq): add DimensionChip component"
```

---

## Phase 5 — Extract RuleInlineEditor

### Task 5.1: Move the existing editor body into its own component

**Files:**
- Create: `frontend/components/rules/RuleInlineEditor.tsx`
- Reference for content: `frontend/components/stages/RulesStage.tsx:105-126` (the existing inline editor block inside the rule card)

- [ ] **Step 1: Write the new component**

Reuses the same fields as today (Min/Max/Pattern/Values/SodaCL), retokenized to the new vocabulary. The component does not own state — it accepts the rule, current edits, and callbacks.

```tsx
// frontend/components/rules/RuleInlineEditor.tsx
'use client'
import type { Rule } from '@/lib/types'

interface Props {
  rule: Rule
  edit: Partial<Rule>
  onChange: (patch: Partial<Rule>) => void
  onCancel: () => void
  onSaveAndApprove: () => void
}

export function RuleInlineEditor({ rule, edit, onChange, onCancel, onSaveAndApprove }: Props) {
  return (
    <div className="bg-canvas border border-fg-default rounded-lg p-3">
      <div className="text-[10px] uppercase tracking-widest text-fg-default mb-2">Modify Rule</div>
      <div className="grid grid-cols-2 gap-2 mb-2">
        {rule.min !== undefined && (
          <div>
            <label className="text-[10px] text-fg-muted">Min</label>
            <input
              className="w-full mt-1 bg-surface border border-border text-fg rounded px-2 py-1 text-xs font-mono"
              defaultValue={edit.min ?? rule.min}
              onChange={(e) => onChange({ min: Number(e.target.value) })}
            />
          </div>
        )}
        {rule.max !== undefined && (
          <div>
            <label className="text-[10px] text-fg-muted">Max</label>
            <input
              className="w-full mt-1 bg-surface border border-border text-fg rounded px-2 py-1 text-xs font-mono"
              defaultValue={edit.max ?? rule.max}
              onChange={(e) => onChange({ max: Number(e.target.value) })}
            />
          </div>
        )}
        {rule.pattern !== undefined && (
          <div className="col-span-2">
            <label className="text-[10px] text-fg-muted">Pattern (regex)</label>
            <input
              className="w-full mt-1 bg-surface border border-border text-fg rounded px-2 py-1 text-xs font-mono"
              defaultValue={edit.pattern ?? rule.pattern}
              onChange={(e) => onChange({ pattern: e.target.value })}
            />
          </div>
        )}
        {rule.values !== undefined && (
          <div className="col-span-2">
            <label className="text-[10px] text-fg-muted">Values (comma-separated)</label>
            <input
              className="w-full mt-1 bg-surface border border-border text-fg rounded px-2 py-1 text-xs font-mono"
              defaultValue={((edit.values ?? rule.values ?? []) as unknown[]).join(', ')}
              onChange={(e) =>
                onChange({
                  values: e.target.value.split(',').map((v) => v.trim()).filter(Boolean),
                })
              }
            />
          </div>
        )}
      </div>
      {rule.sodacl && (
        <div className="mb-2">
          <label className="text-[10px] text-fg-muted">SodaCL (editable)</label>
          <textarea
            className="w-full mt-1 bg-surface border border-border text-fg rounded px-2 py-1 text-xs font-mono resize-y min-h-[56px]"
            defaultValue={edit.sodacl ?? rule.sodacl}
            onChange={(e) => onChange({ sodacl: e.target.value })}
          />
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="text-xs text-fg-muted border border-border-strong bg-surface px-3 py-1.5 rounded-md"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className="text-xs font-semibold bg-brand-accent text-on-brand px-3 py-1.5 rounded-md"
          onClick={onSaveAndApprove}
        >
          Save & Approve
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
cd frontend && npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 3: Do NOT commit yet** — combined with Task 6.* commits at the end of Phase 6 (component is unused until RuleCard wires it).

---

## Phase 6 — RuleCard

### Task 6.1: Build `RuleCard.tsx`

**Files:**
- Create: `frontend/components/rules/RuleCard.tsx`

- [ ] **Step 1: Write the component**

```tsx
// frontend/components/rules/RuleCard.tsx
'use client'
import { Check, X, Pencil } from 'lucide-react'
import type { Rule } from '@/lib/types'
import { DimensionChip } from '@/components/dq/DimensionChip'
import { RuleInlineEditor } from './RuleInlineEditor'

export type Decision = 'approved' | 'denied' | 'pending'

interface Props {
  rule: Rule
  decision: Decision
  edit: Partial<Rule>
  isEditing: boolean
  isSelectionMode: boolean
  isSelected: boolean
  onDecide: (next: Decision) => void
  onToggleSelect: () => void
  onEditOpen: () => void
  onEditClose: () => void
  onEditChange: (patch: Partial<Rule>) => void
  onSaveAndApprove: () => void
}

function cardChrome({ decision, isEditing }: { decision: Decision; isEditing: boolean }): string {
  if (decision === 'approved') return 'border-success ring-1 ring-success/40'
  if (decision === 'denied') return 'border-danger ring-1 ring-danger/40 opacity-70'
  if (isEditing) return 'border-fg-default ring-1 ring-fg-default/20'
  return 'border-border'
}

function decisionButton({
  active,
  variant,
  label,
  Icon,
  onClick,
}: {
  active: boolean
  variant: 'success' | 'danger'
  label: string
  Icon: typeof Check
  onClick: () => void
}) {
  const baseIdle = variant === 'success'
    ? 'bg-surface border-success text-success-deep'
    : 'bg-surface border-danger text-danger-deep'
  const baseActive = variant === 'success'
    ? 'bg-success-deep border-success-deep text-on-brand'
    : 'bg-danger-deep border-danger-deep text-on-brand'
  return (
    <button
      type="button"
      onClick={onClick}
      data-decision={variant}
      data-active={active}
      className={[
        'inline-flex items-center gap-1.5 px-3 py-1 rounded-md border text-[13px] font-medium',
        active ? baseActive : baseIdle,
      ].join(' ')}
    >
      <Icon size={14} strokeWidth={2} />
      {label}
    </button>
  )
}

export function RuleCard({
  rule, decision, edit, isEditing, isSelectionMode, isSelected,
  onDecide, onToggleSelect, onEditOpen, onEditClose, onEditChange, onSaveAndApprove,
}: Props) {
  const onApprove = () => onDecide(decision === 'approved' ? 'pending' : 'approved')
  const onDeny    = () => onDecide(decision === 'denied'   ? 'pending' : 'denied')

  return (
    <div
      data-rule-id={rule.id}
      data-decision={decision}
      className={[
        'bg-surface rounded-lg border p-4 flex flex-col gap-2',
        cardChrome({ decision, isEditing }),
      ].join(' ')}
    >
      <div className="flex items-start gap-2.5">
        {isSelectionMode && (
          <input
            type="checkbox"
            aria-label={`Select rule ${rule.id}`}
            checked={isSelected}
            onChange={onToggleSelect}
            className="mt-1 w-4 h-4 accent-brand-primary"
          />
        )}
        <DimensionChip dimension={rule.category} className="shrink-0 mt-0.5" />
        <span className="font-mono text-[13px] text-fg flex-1 break-words">{edit.check ?? rule.check}</span>
        {!isSelectionMode && (
          <div className="flex gap-2 shrink-0">
            {decisionButton({ active: decision === 'approved', variant: 'success', label: decision === 'approved' ? 'Approved' : 'Approve', Icon: Check, onClick: onApprove })}
            {decisionButton({ active: decision === 'denied',   variant: 'danger',  label: decision === 'denied'   ? 'Denied'   : 'Deny',    Icon: X,     onClick: onDeny })}
          </div>
        )}
      </div>

      <div className="flex gap-3 text-[11px] text-fg-muted">
        {rule.column && <span>column: {rule.column}</span>}
        <span>check: {rule.check}</span>
      </div>
      {rule.rationale && (
        <p className="text-[11px] italic text-fg-muted leading-relaxed">{rule.rationale}</p>
      )}

      {isEditing && (
        <RuleInlineEditor
          rule={rule}
          edit={edit}
          onChange={onEditChange}
          onCancel={onEditClose}
          onSaveAndApprove={onSaveAndApprove}
        />
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={isEditing ? onEditClose : onEditOpen}
          data-editing={isEditing}
          className={[
            'inline-flex items-center gap-1.5 px-3 py-1 rounded-md border text-[13px] font-medium',
            isEditing
              ? 'bg-elevated border-fg-default text-fg-default'
              : 'bg-surface border-border-strong text-fg-muted',
          ].join(' ')}
        >
          <Pencil size={14} strokeWidth={2} />
          {isEditing ? 'Editing' : 'Edit'}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
cd frontend && npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 3: Do NOT commit yet** — combined with Task 6.2 tests.

### Task 6.2: Test the decision toggle + selection-mode chrome

**Files:**
- Create: `frontend/__tests__/components/rules/RuleCard.test.tsx`

- [ ] **Step 1: Write the tests**

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { RuleCard } from '@/components/rules/RuleCard'
import type { Rule } from '@/lib/types'

const sample: Rule = {
  id: 'r1',
  category: 'validity',
  check: 'email matches regex',
  column: 'customer_email',
  rationale: 'standard format',
  threshold: 1,
  modified: false,
}

function setup(overrides: Partial<Parameters<typeof RuleCard>[0]> = {}) {
  const handlers = {
    onDecide: jest.fn(),
    onToggleSelect: jest.fn(),
    onEditOpen: jest.fn(),
    onEditClose: jest.fn(),
    onEditChange: jest.fn(),
    onSaveAndApprove: jest.fn(),
  }
  render(
    <RuleCard
      rule={sample}
      decision="pending"
      edit={{}}
      isEditing={false}
      isSelectionMode={false}
      isSelected={false}
      {...handlers}
      {...overrides}
    />
  )
  return handlers
}

describe('RuleCard', () => {
  it('renders Approve and Deny buttons in default (non-selection) mode', () => {
    setup()
    expect(screen.getByText('Approve')).toBeInTheDocument()
    expect(screen.getByText('Deny')).toBeInTheDocument()
  })

  it('clicking Approve when pending fires onDecide("approved")', () => {
    const h = setup({ decision: 'pending' })
    fireEvent.click(screen.getByText('Approve'))
    expect(h.onDecide).toHaveBeenCalledWith('approved')
  })

  it('clicking Approve when already approved reverts to pending', () => {
    const h = setup({ decision: 'approved' })
    fireEvent.click(screen.getByText('Approved'))
    expect(h.onDecide).toHaveBeenCalledWith('pending')
  })

  it('clicking Deny when already denied reverts to pending', () => {
    const h = setup({ decision: 'denied' })
    fireEvent.click(screen.getByText('Denied'))
    expect(h.onDecide).toHaveBeenCalledWith('pending')
  })

  it('hides decision buttons and shows checkbox in selection mode', () => {
    const h = setup({ isSelectionMode: true })
    expect(screen.queryByText('Approve')).toBeNull()
    expect(screen.queryByText('Deny')).toBeNull()
    expect(screen.getByLabelText(/Select rule r1/)).toBeInTheDocument()
  })

  it('clicking the checkbox calls onToggleSelect', () => {
    const h = setup({ isSelectionMode: true })
    fireEvent.click(screen.getByLabelText(/Select rule r1/))
    expect(h.onToggleSelect).toHaveBeenCalledTimes(1)
  })

  it('Edit button label and styling flip when editing', () => {
    setup({ isEditing: false })
    expect(screen.getByText('Edit')).toBeInTheDocument()
    expect(screen.queryByText('Editing')).toBeNull()
  })

  it('Edit button label becomes "Editing" and renders the inline editor when isEditing is true', () => {
    setup({ isEditing: true })
    expect(screen.getByText('Editing')).toBeInTheDocument()
    // The inline editor renders the Modify Rule heading; smoke check.
    expect(screen.getByText('Modify Rule')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the tests**

```bash
cd frontend && npx jest __tests__/components/rules/RuleCard.test.tsx
```
Expected: 8/8 pass.

- [ ] **Step 3: Commit Phase 5+6 together**

```bash
git add frontend/components/rules/RuleCard.tsx frontend/components/rules/RuleInlineEditor.tsx frontend/__tests__/components/rules/RuleCard.test.tsx
git commit -m "feat(rules): RuleCard + RuleInlineEditor with new decision/edit affordances

Decision buttons are reversible (re-clicking the active button returns
to pending). Edit is decoupled to the card's bottom-right. Selection
mode replaces the decision buttons with a checkbox column."
```

---

## Phase 7 — SelectionToolbar (bulk action bar)

### Task 7.1: Build `SelectionToolbar.tsx`

**Files:**
- Create: `frontend/components/rules/SelectionToolbar.tsx`

- [ ] **Step 1: Write the component**

```tsx
// frontend/components/rules/SelectionToolbar.tsx
'use client'
import { Check, X, RotateCcw } from 'lucide-react'

interface Props {
  selectedCount: number
  visibleCount: number
  allVisibleSelected: boolean
  onToggleAllVisible: () => void
  onBulkApprove: () => void
  onBulkDeny: () => void
  onBulkClear: () => void
}

export function SelectionToolbar({
  selectedCount, visibleCount, allVisibleSelected,
  onToggleAllVisible, onBulkApprove, onBulkDeny, onBulkClear,
}: Props) {
  const disabled = selectedCount === 0
  return (
    <div
      data-testid="selection-toolbar"
      className="bg-elevated border border-border rounded-lg px-4 py-2.5 flex items-center gap-3"
    >
      <input
        type="checkbox"
        aria-label="Select all visible"
        checked={allVisibleSelected}
        onChange={onToggleAllVisible}
        className="w-4 h-4 accent-brand-primary"
      />
      <span className="text-[12px] font-medium text-fg">
        Select all visible · {selectedCount} selected
      </span>
      <div className="flex-1" />
      <button
        type="button"
        onClick={onBulkApprove}
        disabled={disabled}
        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md border bg-surface border-success text-success-deep text-[13px] font-medium disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Check size={14} strokeWidth={2} /> Approve {selectedCount || ''}
      </button>
      <button
        type="button"
        onClick={onBulkDeny}
        disabled={disabled}
        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md border bg-surface border-danger text-danger-deep text-[13px] font-medium disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <X size={14} strokeWidth={2} /> Deny {selectedCount || ''}
      </button>
      <button
        type="button"
        onClick={onBulkClear}
        disabled={disabled}
        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md border bg-surface border-border-strong text-fg-muted text-[13px] font-medium disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <RotateCcw size={14} strokeWidth={2} /> Clear {selectedCount || ''}
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Write a smoke test**

Create: `frontend/__tests__/components/rules/SelectionToolbar.test.tsx`

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { SelectionToolbar } from '@/components/rules/SelectionToolbar'

function setup(overrides = {}) {
  const handlers = {
    onToggleAllVisible: jest.fn(),
    onBulkApprove: jest.fn(),
    onBulkDeny: jest.fn(),
    onBulkClear: jest.fn(),
  }
  render(
    <SelectionToolbar
      selectedCount={2}
      visibleCount={4}
      allVisibleSelected={false}
      {...handlers}
      {...overrides}
    />
  )
  return handlers
}

describe('SelectionToolbar', () => {
  it('shows the selected count and per-button counts', () => {
    setup({ selectedCount: 3 })
    expect(screen.getByText(/3 selected/)).toBeInTheDocument()
    expect(screen.getByText(/Approve 3/)).toBeInTheDocument()
    expect(screen.getByText(/Deny 3/)).toBeInTheDocument()
    expect(screen.getByText(/Clear 3/)).toBeInTheDocument()
  })

  it('disables all bulk buttons when selection is empty', () => {
    setup({ selectedCount: 0 })
    expect(screen.getByText(/Approve/).closest('button')).toBeDisabled()
    expect(screen.getByText(/Deny/).closest('button')).toBeDisabled()
    expect(screen.getByText(/Clear/).closest('button')).toBeDisabled()
  })

  it('fires the right callback for each bulk action', () => {
    const h = setup()
    fireEvent.click(screen.getByText(/Approve/).closest('button')!)
    expect(h.onBulkApprove).toHaveBeenCalled()
    fireEvent.click(screen.getByText(/Deny/).closest('button')!)
    expect(h.onBulkDeny).toHaveBeenCalled()
    fireEvent.click(screen.getByText(/Clear/).closest('button')!)
    expect(h.onBulkClear).toHaveBeenCalled()
  })

  it('checking the header checkbox calls onToggleAllVisible', () => {
    const h = setup()
    fireEvent.click(screen.getByLabelText('Select all visible'))
    expect(h.onToggleAllVisible).toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run + commit**

```bash
cd frontend && npx jest __tests__/components/rules/SelectionToolbar.test.tsx
```
Expected: 4/4 pass.

```bash
git add frontend/components/rules/SelectionToolbar.tsx frontend/__tests__/components/rules/SelectionToolbar.test.tsx
git commit -m "feat(rules): SelectionToolbar with bulk Approve/Deny/Clear"
```

---

## Phase 8 — DecisionFooter

### Task 8.1: Build `DecisionFooter.tsx`

**Files:**
- Create: `frontend/components/rules/DecisionFooter.tsx`

- [ ] **Step 1: Write the component**

```tsx
// frontend/components/rules/DecisionFooter.tsx
'use client'
import { ArrowRight } from 'lucide-react'

interface Props {
  approved: number
  denied: number
  undecided: number
  submitting: boolean
  onSubmit: () => void
}

function tallyItem(color: string, deep: string, label: string) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full ${color}`} />
      <span className={`text-[12px] font-medium ${deep}`}>{label}</span>
    </span>
  )
}

export function DecisionFooter({ approved, denied, undecided, submitting, onSubmit }: Props) {
  const disabled = undecided > 0 || submitting
  return (
    <div
      data-testid="decision-footer"
      className="bg-surface border-t border-border px-6 py-3 flex items-center gap-4 shrink-0"
    >
      <div className="flex items-center gap-4">
        {tallyItem('bg-success', 'text-success-deep', `${approved} approved`)}
        {tallyItem('bg-danger',  'text-danger-deep',  `${denied} denied`)}
        {tallyItem('bg-border-strong', 'text-fg-muted', `${undecided} undecided`)}
      </div>
      <div className="flex-1" />
      <button
        type="button"
        onClick={onSubmit}
        disabled={disabled}
        data-testid="submit-decisions"
        className="inline-flex items-center gap-1.5 bg-brand-accent text-on-brand text-[13px] font-semibold px-4 py-2 rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {submitting ? 'Submitting…' : 'Submit decisions'}
        {!submitting && <ArrowRight size={14} strokeWidth={2} />}
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Write a smoke test**

Create: `frontend/__tests__/components/rules/DecisionFooter.test.tsx`

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { DecisionFooter } from '@/components/rules/DecisionFooter'

describe('DecisionFooter', () => {
  it('disables submit when there are undecided rules', () => {
    render(<DecisionFooter approved={2} denied={1} undecided={3} submitting={false} onSubmit={jest.fn()} />)
    expect(screen.getByTestId('submit-decisions')).toBeDisabled()
  })

  it('enables submit when all decided', () => {
    render(<DecisionFooter approved={2} denied={1} undecided={0} submitting={false} onSubmit={jest.fn()} />)
    expect(screen.getByTestId('submit-decisions')).not.toBeDisabled()
  })

  it('shows the submitting label and disables when submitting', () => {
    render(<DecisionFooter approved={2} denied={1} undecided={0} submitting={true} onSubmit={jest.fn()} />)
    expect(screen.getByText('Submitting…')).toBeInTheDocument()
    expect(screen.getByTestId('submit-decisions')).toBeDisabled()
  })

  it('fires onSubmit when clicked', () => {
    const onSubmit = jest.fn()
    render(<DecisionFooter approved={2} denied={1} undecided={0} submitting={false} onSubmit={onSubmit} />)
    fireEvent.click(screen.getByTestId('submit-decisions'))
    expect(onSubmit).toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run + commit**

```bash
cd frontend && npx jest __tests__/components/rules/DecisionFooter.test.tsx
```
Expected: 4/4 pass.

```bash
git add frontend/components/rules/DecisionFooter.tsx frontend/__tests__/components/rules/DecisionFooter.test.tsx
git commit -m "feat(rules): DecisionFooter with tally and primary CTA"
```

---

## Phase 9 — RulesStage parent rewrite

### Task 9.1: Rewrite `RulesStage.tsx` to orchestrate the new children

**Files:**
- Modify: `frontend/components/stages/RulesStage.tsx` (full rewrite)

- [ ] **Step 1: Replace file contents**

```tsx
// frontend/components/stages/RulesStage.tsx
'use client'
import { useMemo, useState } from 'react'
import { Check, SquareCheckBig } from 'lucide-react'
import type { SessionState, Rule } from '@/lib/types'
import { approveRules } from '@/lib/api'
import { DIMENSION_IDS } from '@/lib/dq/dimensions'
import { RuleCard, type Decision } from '@/components/rules/RuleCard'
import { SelectionToolbar } from '@/components/rules/SelectionToolbar'
import { DecisionFooter } from '@/components/rules/DecisionFooter'

interface Props {
  session: SessionState
  readOnly?: boolean
}

type Filter = 'all' | (typeof DIMENSION_IDS)[number]

export function RulesStage({ session, readOnly }: Props) {
  const rules = session.suggested_rules as Rule[]

  const [decisions, setDecisions] = useState<Record<string, Decision>>(
    () => Object.fromEntries(rules.map((r) => [r.id, 'pending']))
  )
  const [edits, setEdits] = useState<Record<string, Partial<Rule>>>({})
  const [editingId, setEditingId] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [submitting, setSubmitting] = useState(false)

  const counts = useMemo(() => {
    let approved = 0, denied = 0, undecided = 0
    for (const id of Object.keys(decisions)) {
      const d = decisions[id]
      if (d === 'approved') approved++
      else if (d === 'denied') denied++
      else undecided++
    }
    return { approved, denied, undecided }
  }, [decisions])

  const visible = useMemo(
    () => (filter === 'all' ? rules : rules.filter((r) => r.category.toLowerCase() === filter)),
    [rules, filter]
  )
  const visibleIds = useMemo(() => visible.map((r) => r.id), [visible])
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id))

  function decide(id: string, next: Decision) {
    setDecisions((prev) => ({ ...prev, [id]: next }))
  }

  function approveAll() {
    setDecisions((prev) => {
      const out = { ...prev }
      for (const r of rules) out[r.id] = 'approved'
      return out
    })
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleAllVisible() {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (allVisibleSelected) {
        for (const id of visibleIds) next.delete(id)
      } else {
        for (const id of visibleIds) next.add(id)
      }
      return next
    })
  }

  function bulkSet(value: Decision) {
    setDecisions((prev) => {
      const out = { ...prev }
      for (const id of selectedIds) out[id] = value
      return out
    })
  }

  function exitSelectionMode() {
    setSelectionMode(false)
    setSelectedIds(new Set())
  }

  async function handleSubmit() {
    setSubmitting(true)
    const approvedRules = rules
      .filter((r) => decisions[r.id] === 'approved')
      .map((r) => {
        const e = edits[r.id]
        return e ? { ...r, ...e } : r
      })
    const rejectedIds = rules.filter((r) => decisions[r.id] === 'denied').map((r) => r.id)
    try {
      await approveRules(session.session_id, approvedRules, rejectedIds)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
        <header>
          <h1 className="text-base font-bold text-fg">Rule Approval</h1>
          <p className="text-xs text-fg-muted">
            Approve, deny, or edit each AI-proposed rule. You can edit any rule before approving.
          </p>
        </header>

        <div className="flex items-center gap-2 flex-wrap">
          {(['all', ...DIMENSION_IDS] as Filter[]).map((f) => {
            const count = f === 'all' ? rules.length : rules.filter((r) => r.category.toLowerCase() === f).length
            const isActive = filter === f
            const label = f === 'all' ? `All (${count})` : `${f.charAt(0).toUpperCase()}${f.slice(1)} (${count})`
            return (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                data-filter={f}
                data-active={isActive}
                className={[
                  'text-xs px-2.5 py-1 rounded-md border bg-surface',
                  isActive ? 'border-brand-primary text-fg font-semibold' : 'border-border-strong text-fg-muted',
                ].join(' ')}
              >
                {label}
              </button>
            )
          })}
          <div className="flex-1" />
          {!readOnly && (
            <>
              <button
                type="button"
                onClick={() => (selectionMode ? exitSelectionMode() : setSelectionMode(true))}
                data-testid="select-toggle"
                data-active={selectionMode}
                className={[
                  'inline-flex items-center gap-1.5 px-3 py-1 rounded-md border text-[13px] font-medium',
                  selectionMode
                    ? 'bg-elevated border-fg-default text-fg-default'
                    : 'bg-surface border-border-strong text-fg-muted',
                ].join(' ')}
              >
                <SquareCheckBig size={14} strokeWidth={2} />
                {selectionMode ? 'Done selecting' : 'Select'}
              </button>
              {!selectionMode && (
                <button
                  type="button"
                  onClick={approveAll}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md border bg-surface border-success text-success-deep text-[13px] font-medium"
                >
                  <Check size={14} strokeWidth={2} /> Approve all
                </button>
              )}
            </>
          )}
        </div>

        {selectionMode && !readOnly && (
          <SelectionToolbar
            selectedCount={selectedIds.size}
            visibleCount={visible.length}
            allVisibleSelected={allVisibleSelected}
            onToggleAllVisible={toggleAllVisible}
            onBulkApprove={() => bulkSet('approved')}
            onBulkDeny={() => bulkSet('denied')}
            onBulkClear={() => bulkSet('pending')}
          />
        )}

        <div className="flex flex-col gap-2">
          {visible.map((rule) => (
            <RuleCard
              key={rule.id}
              rule={rule}
              decision={decisions[rule.id]}
              edit={edits[rule.id] ?? {}}
              isEditing={editingId === rule.id}
              isSelectionMode={selectionMode}
              isSelected={selectedIds.has(rule.id)}
              onDecide={(d) => decide(rule.id, d)}
              onToggleSelect={() => toggleSelect(rule.id)}
              onEditOpen={() => setEditingId(rule.id)}
              onEditClose={() => setEditingId(null)}
              onEditChange={(patch) =>
                setEdits((prev) => ({ ...prev, [rule.id]: { ...prev[rule.id], ...patch } }))
              }
              onSaveAndApprove={() => {
                decide(rule.id, 'approved')
                setEditingId(null)
              }}
            />
          ))}
        </div>
      </div>

      {!readOnly && (
        <DecisionFooter
          approved={counts.approved}
          denied={counts.denied}
          undecided={counts.undecided}
          submitting={submitting}
          onSubmit={handleSubmit}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Type-check + run all existing tests**

```bash
cd frontend && npx tsc --noEmit && npx jest
```
Expected: clean tsc; theme + workspace + dq + rules tests all pass; the two pre-existing useAIStream / useSessionList failures remain (unrelated).

- [ ] **Step 3: Do NOT commit yet** — combined with Task 9.2 tests.

### Task 9.2: Test parent-level behaviors

**Files:**
- Create: `frontend/__tests__/components/stages/RulesStage.test.tsx`

- [ ] **Step 1: Write the tests**

```tsx
import { render, screen, fireEvent, within } from '@testing-library/react'
import { RulesStage } from '@/components/stages/RulesStage'
import type { SessionState, Rule } from '@/lib/types'

jest.mock('@/lib/api', () => ({ approveRules: jest.fn().mockResolvedValue({ accepted: true, message: '' }) }))

function makeRule(id: string, category: string, check: string): Rule {
  return { id, category, check, threshold: 1, modified: false }
}
const rules: Rule[] = [
  makeRule('r1', 'validity',     'email format'),
  makeRule('r2', 'completeness', 'amount not null'),
  makeRule('r3', 'completeness', 'date not null'),
  makeRule('r4', 'uniqueness',   'id unique'),
]
const session = { session_id: 's1', suggested_rules: rules } as unknown as SessionState

describe('RulesStage', () => {
  it('renders one card per rule', () => {
    render(<RulesStage session={session} />)
    expect(document.querySelectorAll('[data-rule-id]').length).toBe(4)
  })

  it('Submit decisions is disabled until every rule is decided', () => {
    render(<RulesStage session={session} />)
    expect(screen.getByTestId('submit-decisions')).toBeDisabled()
    // Approve all via the toolbar action
    fireEvent.click(screen.getByText(/Approve all/))
    expect(screen.getByTestId('submit-decisions')).not.toBeDisabled()
  })

  it('decision toggle: re-clicking Approve on an approved rule reverts to pending', () => {
    render(<RulesStage session={session} />)
    const card = document.querySelector('[data-rule-id="r1"]')!
    fireEvent.click(within(card as HTMLElement).getByText('Approve'))
    expect(card.getAttribute('data-decision')).toBe('approved')
    fireEvent.click(within(card as HTMLElement).getByText('Approved'))
    expect(card.getAttribute('data-decision')).toBe('pending')
  })

  it('Select mode hides per-row buttons and shows checkboxes; Done selecting clears selection', () => {
    render(<RulesStage session={session} />)
    fireEvent.click(screen.getByTestId('select-toggle'))
    expect(screen.queryByText('Approve')).toBeNull()
    expect(screen.getAllByLabelText(/Select rule/).length).toBe(4)
    // Select two rules
    fireEvent.click(screen.getByLabelText('Select rule r1'))
    fireEvent.click(screen.getByLabelText('Select rule r3'))
    expect(screen.getByText(/2 selected/)).toBeInTheDocument()
    // Exit selection mode — selection clears
    fireEvent.click(screen.getByTestId('select-toggle'))
    fireEvent.click(screen.getByTestId('select-toggle')) // re-enter to verify selection didn't persist
    expect(screen.getByText(/0 selected/)).toBeInTheDocument()
  })

  it('bulk Approve sets all selected rules to approved', () => {
    render(<RulesStage session={session} />)
    fireEvent.click(screen.getByTestId('select-toggle'))
    fireEvent.click(screen.getByLabelText('Select rule r1'))
    fireEvent.click(screen.getByLabelText('Select rule r2'))
    fireEvent.click(screen.getByText(/Approve 2/).closest('button')!)
    expect(document.querySelector('[data-rule-id="r1"]')?.getAttribute('data-decision')).toBe('approved')
    expect(document.querySelector('[data-rule-id="r2"]')?.getAttribute('data-decision')).toBe('approved')
    expect(document.querySelector('[data-rule-id="r3"]')?.getAttribute('data-decision')).toBe('pending')
  })

  it('bulk Clear reverts decisions of selected rules but keeps the selection', () => {
    render(<RulesStage session={session} />)
    fireEvent.click(screen.getByTestId('select-toggle'))
    fireEvent.click(screen.getByLabelText('Select rule r1'))
    fireEvent.click(screen.getByLabelText('Select rule r2'))
    fireEvent.click(screen.getByText(/Approve 2/).closest('button')!)
    fireEvent.click(screen.getByText(/Clear 2/).closest('button')!)
    expect(document.querySelector('[data-rule-id="r1"]')?.getAttribute('data-decision')).toBe('pending')
    expect(document.querySelector('[data-rule-id="r2"]')?.getAttribute('data-decision')).toBe('pending')
    // Selection should still be 2
    expect(screen.getByText(/2 selected/)).toBeInTheDocument()
  })

  it('selection persists across filter changes', () => {
    render(<RulesStage session={session} />)
    fireEvent.click(screen.getByTestId('select-toggle'))
    fireEvent.click(screen.getByLabelText('Select rule r2')) // completeness
    expect(screen.getByText(/1 selected/)).toBeInTheDocument()
    // Switch to Validity filter — r2 not visible but still selected
    fireEvent.click(screen.getByText(/Validity \(1\)/))
    expect(screen.getByText(/1 selected/)).toBeInTheDocument()
    // Switch back to All
    fireEvent.click(screen.getByText(/All \(4\)/))
    expect(screen.getByText(/1 selected/)).toBeInTheDocument()
  })

  it('Approve all hidden in selection mode', () => {
    render(<RulesStage session={session} />)
    expect(screen.getByText(/Approve all/)).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('select-toggle'))
    expect(screen.queryByText(/Approve all/)).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests**

```bash
cd frontend && npx jest __tests__/components/stages/RulesStage.test.tsx
```
Expected: 8/8 pass.

- [ ] **Step 3: Commit Phase 9**

```bash
git add frontend/components/stages/RulesStage.tsx frontend/__tests__/components/stages/RulesStage.test.tsx
git commit -m "feat(rules): rewrite RulesStage parent to orchestrate redesigned children

Decomposes the previous 145-line monolithic stage into a parent that
owns decisions/edits/selection state and delegates rendering to
RuleCard, SelectionToolbar, and DecisionFooter. Selection mode is a
top-level toggle controlled from the toolbar; selection persists
across filter changes; bulk Clear keeps the selection but resets
decisions. 8 parent-level tests cover the cross-cutting behaviors."
```

---

## Phase 10 — Verification & wrap-up

### Task 10.1: Full local verification

- [ ] **Step 1: Run the full test suite**

```bash
cd frontend && npx jest
```
Expected: theme + workspace + dq + rules + stages suites all green. Two pre-existing failures (useAIStream, useSessionList) remain. Compare against the baseline counts from Round 1 to confirm no new failures.

- [ ] **Step 2: Production build**

```bash
cd frontend && npm run build
```
Expected: completes successfully. Watch for any "unknown class" Tailwind warnings (would mean a category-* alias didn't make it).

- [ ] **Step 3: Manual smoke test on dev server**

Start the dev server (or hot-reload an existing one), navigate to a session whose stage is `RULE_REVIEW`. Verify in order:

1. Default mode renders correctly: chip colors, Approve/Deny + Edit per row, sticky footer with Submit disabled.
2. Click Approve on one rule → button flips to "Approved" filled green; the card border + ring turns green.
3. Click "Approved" again → reverts to pending; card chrome returns to default.
4. Click Edit on a rule → Edit button label flips to "Editing"; inline editor renders; Save & Approve closes the editor and approves the rule.
5. Click `Select` in the toolbar → bulk action bar appears; per-row Approve/Deny hide; checkboxes appear on cards; `Approve all` disappears.
6. Select 2 rules → bulk buttons show "Approve 2", "Deny 2", "Clear 2".
7. Click Approve 2 → both rules turn approved.
8. Click Clear 2 → both rules revert to pending; selection still says "2 selected".
9. Switch to Validity filter → only validity rules visible; "2 selected" still shown if non-validity rules were selected.
10. Click "Done selecting" → exits selection mode; selection clears; per-row buttons return.
11. After every rule is decided, Submit decisions enables; clicking it calls the existing approveRules backend (no network change).
12. Verify brand swap: append `?client=clayton` to the URL, refresh, confirm the active filter pill border + checkbox accent switch to Clayton Blue.

- [ ] **Step 4: Tag** (if all green)

```bash
git tag -a rules-stage-v1 -m "Round 2 Stage 1 — Rules stage redesign

Six asks from the round-2 brainstorm shipped:
- Accessible, token-driven dimension chips (new category-* family).
- Multi-select with bulk Approve / Deny / Clear.
- Edit decoupled from decision buttons; bottom-right placement.
- All buttons word + icon (lucide-react).
- Submit decisions uses the new brand-accent primary CTA.
- Decisions reversible via toggle.

Round 1 icon retrofit (Stepper / AIPanel / TopBar) included."
```

---

## Self-review notes

**Spec coverage check** — every spec requirement has a task:

| Spec section | Implemented in |
|---|---|
| Default mode layout | Task 9.1 (RulesStage filter + toolbar) + Task 6.1 (RuleCard) |
| Selection mode | Task 9.1 (mode toggle, persist, exit clear) + Task 7.1 (bulk bar) + Task 6.1 (checkbox column) |
| Reversibility | Task 6.1 (per-row toggle handlers) + Task 9.1 (bulk Clear) |
| Dimension tag system | Task 3.1 (map) + Task 4.1 (chip) |
| Token additions | Task 2.1 + 2.2 |
| Button system A–E | Tasks 6.1 (A, B), 9.1 (C, E), 7.1 (D) |
| Footer (sticky) | Task 8.1 |
| Component boundaries | Phases 4–9 file structure |
| State & data flow | Task 9.1 (state lives in parent) |
| Testing strategy | Tasks 3.2, 4.1 Step 2, 6.2, 7.1 Step 2, 8.1 Step 2, 9.2 |
| Icon system (Lucide + retrofit) | Phase 0 (install) + Phase 1 (retrofit) + Phases 6–9 (new) |

**Pre-locked spec follow-ups** are all implemented:
1. `approveRules` wire shape unchanged — Task 9.1 builds the body with `rejected_rule_ids` via the existing helper.
2. `Approve all` hidden in selection mode — Task 9.1 wraps it in `!selectionMode` + Task 9.2 verifies.
3. `Clear N` clears decisions, keeps selection — Task 9.1 `bulkSet('pending')` doesn't touch `selectedIds`; Task 9.2 verifies.

**Type consistency** — `Decision` is `'approved' | 'denied' | 'pending'` everywhere. The wire-level `rejected_rule_ids` is derived only at submit time. `DimensionId` from `lib/dq/dimensions.ts` is used consistently for the filter union.

**No placeholders** — every step has the code, command, and expected output.

**Commit count** — 9 commits total across the plan (Phase 0 install, Phase 1 retrofit, Phase 2 tokens, Phase 3 dimensions lib, Phase 4 DimensionChip, Phase 5+6 editor + RuleCard combined, Phase 7 SelectionToolbar, Phase 8 DecisionFooter, Phase 9 parent rewrite). Maps to one commit per file group, consistent with Round 1's commit cadence.
