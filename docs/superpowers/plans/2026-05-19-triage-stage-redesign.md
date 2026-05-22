# Triage Stage Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Round 2 / Stage 7 — a retokenized `TriageStage` that swaps every pre-foundation token (`text-text-*`, `bg-surface-raised`, `bg-indigo`, hex Tailwind colors) for foundation tokens, replaces the single-side `border-l-{tone}/60` rule-card accent with a decision-driven outline+ring (Accept → `border-success ring-1 ring-success/40`, Keep → `border-danger ring-1 ring-danger/40`, Pending → `border-border`), migrates classification badges to the `Chip` primitive with the `chip-system-v1` Title Case vocabulary, swaps the indigo filter tabs for `bg-brand-primary` active / neutral-elevated inactive buttons, and swaps the indigo submit button for the navy `bg-brand-accent` CTA with a lucide `ArrowRight`. No behavior changes. Wire into `/demo` so the walkthrough advances to Triage. Build the Figma frame BEFORE the code so the visual is locked in.

**Architecture:** Single-file rewrite. `TriageStage.tsx` keeps its Props (`session`, `readOnly`), its local-state decision tracking, its `approveTriage` payload shape, and its filter modes. The four classification → tone mappings and confidence-color mapping become inline maps. Internal helpers (`TriageCard`) stay inline. The `/demo` workspace's active stage advances from `'validate'` to `'triage'` so Validate becomes a clickable past stage and Triage is the new landing stage. A `DEMO_TRIAGE_SESSION` fixture provides a realistic mix of the four classifications.

**Tech Stack:** Next 16, React 19, TypeScript 5, Tailwind 3.4 (foundation tokens — `bg-surface`, `bg-elevated`, `border-border`, `text-fg`, `text-fg-muted`, `text-fg-subtle`, `text-success-deep`, `text-warning-deep`, `text-danger-deep`, `bg-success`, `bg-warning`, `bg-danger`, `ring-success/40`, `ring-danger/40`, `bg-brand-primary`, `bg-brand-accent`, `text-on-brand`), the `Chip` primitive from `chip-system-v1`, lucide-react icons (`Check`, `X`, `ArrowRight`), Jest 30 + ts-jest + jsdom + @testing-library/react + @testing-library/user-event.

**Spec:** `docs/superpowers/specs/2026-05-19-triage-stage-redesign.md`

**Figma reference:** New frame at slot (80, 7700) on page `02 — Foundation` named `Triage / 1440x900 / Default`. Built in Phase 0 BEFORE the code rewrite (Figma-first).

---

## File Structure

```
frontend/
  components/
    stages/
      TriageStage.tsx                  # MODIFY — full rewrite (~250 lines, down from 280)
  __tests__/
    stages/
      TriageStage.test.tsx             # NEW — integration tests
  app/
    demo/
      page.tsx                         # MODIFY — advance active to 'triage', mount real TriageStage
      _fixtures/
        mock-session.ts                # MODIFY — add DEMO_TRIAGE_SESSION fixture
```

Commit cadence — Figma frame (no commit, Figma-only) + two `feat` commits + verification phase + tag:

1. **Phase 0** — Figma frame built in the Figma file directly. No git commit.
2. **`feat(triage): rewrite TriageStage to token-driven chrome`** (Phase 1)
3. **`feat(demo): advance walkthrough to Triage stage`** (Phase 2)
4. **Phase 3** — Manual verification + final review + tag `triage-stage-v1`.

---

## Phase 0 — Build the Triage Figma frame

Build the frame BEFORE writing the code, so the visual decisions in the spec are locked into a mirrored Figma artifact and the implementer is rewriting against a confirmed visual. Same approach as Stage 5 (Explore); Validate frame mirroring was a separate session (`spawn_task`) — this one is in-plan because the user-locked preference is Figma-first.

### Task 0.1: Build the `Triage / 1440x900 / Default` frame

**Files:** none in this repo. Figma changes apply to the Figma file `gsnW43uSpvdLpwandZM8Zx`, page `02 — Foundation`.

**Tool:** `mcp__6fb33dc5-...__use_figma` (search the deferred tools for the exact MCP slug — that's the Figma MCP installed in this workspace).

- [ ] **Step 1: Find an existing frame to clone the chrome from**

Read the Figma file structure and locate the existing Validate frame:

- Page: `02 — Foundation`
- Frame: `Validate / 1440x900 / Default` at id `230:306`, position `(80, 6700)`, size `1440 × 900`.

The new Triage frame lives directly below it at position `(80, 7700)` (1000px below Validate's top — leaves room for an in-page header / no overlap). Name it exactly: `Triage / 1440x900 / Default`.

- [ ] **Step 2: Create the frame at (80, 7700) on page `02 — Foundation`**

Use `use_figma` to create a 1440 × 900 auto-layout frame. Settings to match Validate's wrapper:

- Auto-layout direction: VERTICAL
- Padding: 0 (the inner Main column handles padding)
- Background fill: foundation variable `bg-canvas` (`6:2`).
- `clipsContent: true`.

Inside the frame, replicate the workspace shell already present on the Validate frame:

1. **TopBar** (1440 × 56, anchored to top). Same fill, same border-bottom, same content layout as Validate's TopBar. Bind colors to `bg-elevated=6:4`, `border=6:9`. Copy the file/row-count/col-count area from Validate; the score chip on the right reads `82%` in the SCORE outline style (`border-success`, `text-success-deep`).
2. **Stepper** (240 × 844, anchored to left). Same as Validate's Stepper. Active stage is now `Triage` (orange dot, `brand-primary=5:2`); Load / Profile / Explore / Rules / Validate show the green check; Plan / Transform / Scorecard / Pipeline are locked (subtle bg + lock glyph).
3. **AIPanel** (320 × 844, anchored to right). Same chrome as Validate's AIPanel. Body text can be a placeholder ("AI activity feed").
4. **Main** (880 × 844, center column). Padding `24px` (top/bottom/left/right). Auto-layout VERTICAL, `itemSpacing: 24`. This is where the Triage page content goes.

**Figma quirks** (per the handoff caveats):

- `strokeOpacity` is NOT valid on FRAME nodes. Use opacity baked into the SolidPaint instead (`{ type: 'SOLID', color, opacity: 0.3 }`).
- `layoutSizingHorizontal: 'FILL'` can only be set AFTER appending the node to a parent auto-layout frame, not in the constructor.
- For Body containers with VERTICAL children of explicit width: set `primaryAxisSizingMode = 'FIXED'` + `counterAxisSizingMode = 'FIXED'` on the Body frame, then `layoutSizingHorizontal = 'FIXED'` + `layoutSizingVertical = 'FIXED'` + `resize(w, h)` on each child after appending.

- [ ] **Step 3: Inside Main, build the Triage page sections top-to-bottom**

Order (matches the spec's "page composition"):

1. **Header block** (auto-layout VERTICAL, `itemSpacing: 2`):
   - H1 text: `Triage Results` — 14px, font-weight 700, fill `fg=6:5`.
   - Subhead text: `Review the AI's classification of every failing rule and decide what to do with each.` — 12px, fill `fg-muted=6:6`.

2. **Summary card** (auto-layout VERTICAL, padding 16, `itemSpacing: 12`, corner radius 12, fill `bg-surface=6:3`, stroke `border=6:9` width 1):
   - Section label: `TRIAGE SUMMARY` — 12px, font-weight 600, uppercase, letter-spacing `0.05em`, fill `fg-muted=6:6`.
   - Row of count chips (auto-layout HORIZONTAL, `itemSpacing: 16`):
     - `● 2 Transform Fixable` — dot 8×8 round, fill `success=6:11`; text 14px, fill `fg-muted=6:6`.
     - `● 3 Threshold Too Strict` — dot fill `warning=6:12`; text fill `fg-muted=6:6`.
     - `● 2 Unfixable` — dot fill `danger=6:13`; text fill `fg-muted=6:6`.
     - `● 1 Eval Error` — dot fill `warning=6:12`; text fill `fg-muted=6:6`.

3. **Filter tabs row** (auto-layout HORIZONTAL, `itemSpacing: 6`):
   - Button `All` — active: fill `brand-primary=5:2`, text fill `on-brand=5:4` (`brand-on-primary`), 11px font-weight 600, padding 10×4, corner radius 6.
   - Button `Needs Decision` — inactive: fill `bg-surface=6:3`, stroke `border=6:9` width 1, text fill `fg-muted=6:6`, 11px font-weight 600, padding 10×4, corner radius 6.
   - Button `Fixable` — inactive (same as above).
   - Button `Unfixable / Error` — inactive (same as above).

4. **Triage cards** (auto-layout VERTICAL, `itemSpacing: 8`). Render 4 example cards covering each card state:
   - **Card A — Threshold Too Strict, ACCEPTED** (rule `r-001`, column `email`, check `regex(email)`):
     - Fill `bg-surface=6:3`, stroke `success=6:11` width 1, drop-shadow / inner-stroke for the ring effect (use a second 4px stroke at `success` opacity 0.4 outside — or just draw the soft ring as a 1px stroke + 4px outer-shadow effect for visual approximation). Corner radius 8, padding 16.
     - Top row HORIZONTAL `itemSpacing: 8` `crossAxisAlignment: CENTER`:
       - Chip `Threshold Too Strict` — fill `warning=6:12` opacity 0.15, text fill `warning-deep=21:3`, 11px font-weight 600, padding 8×2, corner radius 6.
       - Rule id `r-001` — 14px font-mono font-weight 600, fill `fg=6:5`.
       - `· regex(email)` — 12px font-mono, fill `fg-subtle=6:7`.
       - `· email` — 12px font-mono, fill `fg-subtle=6:7`.
       - Spacer (push confidence to right).
       - Confidence text `confidence: high` — 12px, fill `success-deep=21:2`.
     - Reason paragraph: `6 email addresses fail strict regex but match a relaxed RFC 5322 pattern. Raising the threshold from 95% to 97% would let these slip through without dropping data quality.` — 14px, fill `fg-muted=6:6`.
     - Proposed line: `Proposed: raise threshold to ` + bold span `97.00%` (fill `warning-deep=21:3`) — 12px, fill `fg-muted=6:6`.
     - Buttons row HORIZONTAL `itemSpacing: 8`:
       - **Active Accept button** — fill `success-deep=21:2`, stroke `success-deep=21:2` width 1, text fill `on-brand=5:4`, 13px font-weight 600, padding 12×6, corner radius 6, icon `Check` (use Figma's iconic check shape — 14×14, stroke `on-brand=5:4` width 2). Label: `Accept Change`.
       - **Inactive Keep button** — fill `bg-surface=6:3`, stroke `danger=6:13` width 1, text fill `danger-deep=21:4`, 13px font-weight 600, padding 12×6, corner radius 6, icon `X` (14×14, stroke `danger-deep=21:4` width 2). Label: `Keep Original`.

   - **Card B — Unfixable, KEEP** (rule `r-002`, column `co_signer_phone`, check `not_null`):
     - Fill `bg-surface=6:3`, stroke `danger=6:13` width 1, outer ring at `danger` opacity 0.4.
     - Chip `Unfixable` — fill `danger=6:13` opacity 0.15, text fill `danger-deep=21:4`.
     - Confidence text `confidence: medium` — fill `warning-deep=21:3`.
     - Reason: `co_signer_phone is null in 87% of rows because most loans don't have co-signers. This isn't a quality issue — the column is correctly missing.`
     - Proposed line: `Proposed: ` + bold `remove rule` (fill `danger-deep=21:4`) — 12px.
     - Buttons:
       - Inactive Accept (Accept Removal): bg `bg-surface`, stroke `success`, text `success-deep`.
       - Active Keep (Keep Rule): bg `danger-deep`, stroke `danger-deep`, text `on-brand`.

   - **Card C — Transform Fixable, no decision** (rule `r-003`, column `phone`, check `format((XXX) XXX-XXXX)`):
     - Fill `bg-surface=6:3`, stroke `border=6:9` width 1 (no ring).
     - Chip `Transform Fixable` — fill `success=6:11` opacity 0.15, text fill `success-deep=21:2`.
     - Confidence `confidence: high` — fill `success-deep=21:2`.
     - Reason: `152 phone numbers fail the strict format check, but each row matches one of 5 alternate formats that a normalization transform can fix automatically.`
     - No "Proposed" line.
     - Footer: italic text `(no decision required)` — 12px, fill `fg-subtle=6:7`.

   - **Card D — Pending decision** (rule `r-004`, column `application_date`, check `max_date(today)`):
     - Fill `bg-surface=6:3`, stroke `border=6:9` width 1 (no ring — pending baseline).
     - Chip `Threshold Too Strict` — fill `warning=6:12` opacity 0.15, text fill `warning-deep=21:3`.
     - Confidence `confidence: low` — fill `fg-muted=6:6`.
     - Reason: `3 application dates are in the future, likely typos. A 99% threshold would accept these as outliers.`
     - Proposed line: `Proposed: raise threshold to 99.00%`.
     - Buttons: both INACTIVE (Accept inactive + Keep inactive).

5. **Sticky submit bar** (auto-layout HORIZONTAL, padding 16, corner radius 12, fill `bg-elevated=6:4`, stroke `border=6:9` width 1, drop-shadow per Figma's standard shadow tokens for `shadow-lg`):
   - Left: `3 rules need a decision.` — 14px, fill `fg-muted=6:6`. The `3` is inline 14px font-weight 600 fill `warning-deep=21:3`.
   - Right: button `Apply Triage Decisions` + `→` icon — fill `brand-accent=5:3`, text fill `on-brand=5:4`, 13px font-weight 600, padding 16×8, corner radius 6, icon `ArrowRight` 14×14, stroke `on-brand=5:4` width 2.

- [ ] **Step 4: Bind every color to the foundation variable**

Per the handoff caveats, use these exact variable IDs (these were verified during Stage 4):

| Token | Variable id |
|---|---|
| `bg-canvas` | `6:2` |
| `bg-surface` | `6:3` |
| `bg-elevated` | `6:4` |
| `fg` | `6:5` |
| `fg-muted` | `6:6` |
| `fg-subtle` | `6:7` |
| `border` | `6:9` |
| `border-strong` | `6:10` |
| `success` | `6:11` |
| `success-deep` | `21:2` |
| `warning` | `6:12` |
| `warning-deep` | `21:3` |
| `danger` | `6:13` |
| `danger-deep` | `21:4` |
| `info` | `6:14` |
| `info-deep` | `21:5` |
| `brand-primary` | `5:2` |
| `brand-accent` | `5:3` |
| `on-brand` (`brand-on-primary`) | `5:4` |
| `accent-purple` | `29:2` |
| `accent-purple-deep` | `29:3` |

Do NOT use raw hex anywhere in the frame.

- [ ] **Step 5: Verify the frame renders correctly**

Use the Figma MCP's screenshot tool (or its equivalent "get_screenshot" call) on the new frame's node id. Confirm:
- The frame sits at exactly `(80, 7700)` on page `02 — Foundation`.
- All 4 example cards render with the correct outline + ring states.
- The active filter tab (`All`) is the orange brand-primary fill; the other 3 are neutral elevated.
- The submit button is navy (`brand-accent`), NOT orange (`brand-primary`).
- The summary card dots are at full alpha — solid, not translucent.

If anything renders wrong, fix it in Figma before moving to Phase 1.

Phase 0 produces NO git commit. The Figma file is the artifact.

---

## Phase 1 — `TriageStage` rewrite

Full replacement of the 280-line file with a ~250-line token-driven rewrite that uses the `Chip` primitive, the Rules approved/denied card chrome pattern, lucide icons on decision buttons, and the navy brand-accent submit CTA. TDD: write all test assertions before the rewrite.

### Task 1.1: Write the failing integration test

**Files:**
- Create: `frontend/__tests__/stages/TriageStage.test.tsx`

- [ ] **Step 1: Write the test file**

```tsx
// frontend/__tests__/stages/TriageStage.test.tsx
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TriageStage } from '@/components/stages/TriageStage'
import type { SessionState, TriageClassification, TriageResult } from '@/lib/types'
import { approveTriage } from '@/lib/api'

jest.mock('@/lib/api', () => ({
  approveTriage: jest.fn(),
}))

const approveTriageMock = approveTriage as jest.MockedFunction<typeof approveTriage>

function makeClassification(overrides: Partial<TriageClassification>): TriageClassification {
  return {
    rule_id: 'r-default',
    check: 'not_null',
    column: 'col',
    classification: 'threshold_too_strict',
    proposed_threshold: 0.97,
    proposed_remove: false,
    reason: 'reason placeholder',
    confidence: 'high',
    ...overrides,
  }
}

function makeTriageResult(
  classifications: TriageClassification[],
): TriageResult {
  const summary = {
    transform_fixable: classifications.filter(c => c.classification === 'transform_fixable').length,
    threshold_too_strict: classifications.filter(c => c.classification === 'threshold_too_strict').length,
    unfixable: classifications.filter(c => c.classification === 'unfixable').length,
    eval_error: classifications.filter(c => c.classification === 'eval_error').length,
  }
  return { classifications, summary }
}

function makeSession(
  overrides: Partial<SessionState> & { triage_result?: TriageResult } = {},
): SessionState {
  return {
    session_id: 'demo',
    stage: 'AWAITING_TRIAGE_APPROVAL',
    profile: {},
    ai_summary: '',
    suggested_rules: [],
    baseline_quality_score: 0,
    current_score: 0,
    validation_summary: '',
    anomaly_summary: '',
    transformation_log: [],
    scorecard: {},
    narrative: '',
    output_dir: '',
    zip_path: '',
    ...overrides,
  } as SessionState
}

describe('TriageStage', () => {
  beforeEach(() => {
    approveTriageMock.mockReset()
  })

  it('renders the brand-primary loading state when stage=TRIAGING', () => {
    render(<TriageStage session={makeSession({ stage: 'TRIAGING' })} />)
    const spinner = screen.getByRole('status', { name: /triaging/i })
    expect(spinner.classList.contains('border-brand-primary')).toBe(true)
    expect(screen.getByText(/investigating failing rules/i)).toBeInTheDocument()
    expect(screen.queryByText('Triage Results')).toBeNull()
  })

  it('renders the loading state when triage_result is missing (even if stage advanced)', () => {
    render(<TriageStage session={makeSession({ stage: 'AWAITING_TRIAGE_APPROVAL' })} />)
    expect(screen.getByRole('status', { name: /triaging/i })).toBeInTheDocument()
  })

  it('renders the header block when triage_result is present', () => {
    render(
      <TriageStage
        session={makeSession({
          triage_result: makeTriageResult([
            makeClassification({ rule_id: 'r1' }),
          ]),
        })}
      />,
    )
    expect(screen.getByRole('heading', { name: 'Triage Results' })).toBeInTheDocument()
    expect(screen.getByText(/AI's classification of every failing rule/i)).toBeInTheDocument()
  })

  it('renders only non-zero summary categories with Title Case labels and full-alpha dots', () => {
    const { container } = render(
      <TriageStage
        session={makeSession({
          triage_result: makeTriageResult([
            makeClassification({ rule_id: 'tf-1', classification: 'transform_fixable', proposed_remove: false }),
            makeClassification({ rule_id: 'tt-1', classification: 'threshold_too_strict' }),
            makeClassification({ rule_id: 'tt-2', classification: 'threshold_too_strict' }),
            makeClassification({ rule_id: 'un-1', classification: 'unfixable', proposed_remove: true }),
          ]),
        })}
      />,
    )
    expect(screen.getByText('1 Transform Fixable')).toBeInTheDocument()
    expect(screen.getByText('2 Threshold Too Strict')).toBeInTheDocument()
    expect(screen.getByText('1 Unfixable')).toBeInTheDocument()
    expect(screen.queryByText(/Eval Error/)).toBeNull()
    // Full-alpha foundation tokens, no /60 alpha suffix
    expect(container.querySelector('.bg-success.shrink-0')).not.toBeNull()
    expect(container.querySelector('.bg-warning.shrink-0')).not.toBeNull()
    expect(container.querySelector('.bg-danger.shrink-0')).not.toBeNull()
    expect(container.querySelector('.bg-success\\/60')).toBeNull()
    expect(container.querySelector('.bg-red-500\\/60')).toBeNull()
    expect(container.querySelector('.bg-amber-500\\/60')).toBeNull()
  })

  it('renders classification chips with the Chip primitive Title Case labels per tone', () => {
    render(
      <TriageStage
        session={makeSession({
          triage_result: makeTriageResult([
            makeClassification({ rule_id: 'tf', classification: 'transform_fixable', proposed_remove: false }),
            makeClassification({ rule_id: 'tts', classification: 'threshold_too_strict' }),
            makeClassification({ rule_id: 'un', classification: 'unfixable', proposed_remove: true }),
            makeClassification({ rule_id: 'ee', classification: 'eval_error', proposed_remove: true }),
          ]),
        })}
      />,
    )
    const tf = screen.getByText('Transform Fixable', { selector: 'span' })
    expect(tf.className).toContain('bg-success/15')
    expect(tf.className).toContain('text-success-deep')

    const tts = screen.getByText('Threshold Too Strict', { selector: 'span' })
    expect(tts.className).toContain('bg-warning/15')
    expect(tts.className).toContain('text-warning-deep')

    const un = screen.getByText('Unfixable', { selector: 'span' })
    expect(un.className).toContain('bg-danger/15')
    expect(un.className).toContain('text-danger-deep')

    const ee = screen.getByText('Eval Error', { selector: 'span' })
    expect(ee.className).toContain('bg-warning/15')
    expect(ee.className).toContain('text-warning-deep')
  })

  it('renders confidence color tokens per level', () => {
    render(
      <TriageStage
        session={makeSession({
          triage_result: makeTriageResult([
            makeClassification({ rule_id: 'h', confidence: 'high' }),
            makeClassification({ rule_id: 'm', confidence: 'medium' }),
            makeClassification({ rule_id: 'l', confidence: 'low' }),
          ]),
        })}
      />,
    )
    const high = screen.getByText('confidence: high')
    expect(high.className).toContain('text-success-deep')
    const medium = screen.getByText('confidence: medium')
    expect(medium.className).toContain('text-warning-deep')
    const low = screen.getByText('confidence: low')
    expect(low.className).toContain('text-fg-muted')
  })

  it('TriageCard for transform_fixable renders "(no decision required)" and no Accept/Keep buttons', () => {
    render(
      <TriageStage
        session={makeSession({
          triage_result: makeTriageResult([
            makeClassification({
              rule_id: 'tf1',
              classification: 'transform_fixable',
              proposed_remove: false,
              proposed_threshold: undefined,
              reason: 'A transform can fix this automatically.',
            }),
          ]),
        })}
      />,
    )
    expect(screen.getByText('(no decision required)')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Accept/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Keep/ })).toBeNull()
  })

  it('renders the threshold Proposed line with text-warning-deep on threshold_too_strict cards', () => {
    render(
      <TriageStage
        session={makeSession({
          triage_result: makeTriageResult([
            makeClassification({
              rule_id: 'tts1',
              classification: 'threshold_too_strict',
              proposed_threshold: 0.97,
              proposed_remove: false,
            }),
          ]),
        })}
      />,
    )
    const proposedValue = screen.getByText('97.00%')
    expect(proposedValue.className).toContain('text-warning-deep')
    expect(proposedValue.className).toContain('font-semibold')
  })

  it('renders the "remove rule" Proposed line with text-danger-deep on unfixable cards', () => {
    render(
      <TriageStage
        session={makeSession({
          triage_result: makeTriageResult([
            makeClassification({
              rule_id: 'un1',
              classification: 'unfixable',
              proposed_remove: true,
              proposed_threshold: undefined,
            }),
          ]),
        })}
      />,
    )
    const removeText = screen.getByText('remove rule')
    expect(removeText.className).toContain('text-danger-deep')
    expect(removeText.className).toContain('font-semibold')
  })

  it('starts every actionable card in the pending chrome (border-border, no ring)', () => {
    const { container } = render(
      <TriageStage
        session={makeSession({
          triage_result: makeTriageResult([
            makeClassification({
              rule_id: 'tts1',
              classification: 'threshold_too_strict',
              proposed_threshold: 0.97,
              proposed_remove: false,
            }),
          ]),
        })}
      />,
    )
    const card = container.querySelector('[data-triage-card="tts1"]')
    expect(card).not.toBeNull()
    expect(card!.className).toContain('border-border')
    expect(card!.className).not.toContain('ring-1')
    expect(card!.className).not.toContain('border-success')
    expect(card!.className).not.toContain('border-danger')
  })

  it('clicking Accept toggles the card to border-success ring-1 ring-success/40 and the Accept button to active deep-fill', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <TriageStage
        session={makeSession({
          triage_result: makeTriageResult([
            makeClassification({
              rule_id: 'tts1',
              classification: 'threshold_too_strict',
              proposed_threshold: 0.97,
              proposed_remove: false,
            }),
          ]),
        })}
      />,
    )
    const acceptBtn = screen.getByRole('button', { name: /Accept Change/i })
    await user.click(acceptBtn)
    const card = container.querySelector('[data-triage-card="tts1"]')!
    expect(card.className).toContain('border-success')
    expect(card.className).toContain('ring-1')
    expect(card.className).toContain('ring-success/40')
    // Active Accept button: deep fill
    expect(acceptBtn.className).toContain('bg-success-deep')
    expect(acceptBtn.className).toContain('text-on-brand')
  })

  it('clicking Keep toggles the card to border-danger ring-1 ring-danger/40 and the Keep button to active deep-fill', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <TriageStage
        session={makeSession({
          triage_result: makeTriageResult([
            makeClassification({
              rule_id: 'un1',
              classification: 'unfixable',
              proposed_remove: true,
              proposed_threshold: undefined,
            }),
          ]),
        })}
      />,
    )
    const keepBtn = screen.getByRole('button', { name: /Keep Rule/i })
    await user.click(keepBtn)
    const card = container.querySelector('[data-triage-card="un1"]')!
    expect(card.className).toContain('border-danger')
    expect(card.className).toContain('ring-1')
    expect(card.className).toContain('ring-danger/40')
    expect(keepBtn.className).toContain('bg-danger-deep')
    expect(keepBtn.className).toContain('text-on-brand')
  })

  it('clicking an active Accept again returns the card to pending', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <TriageStage
        session={makeSession({
          triage_result: makeTriageResult([
            makeClassification({
              rule_id: 'tts1',
              classification: 'threshold_too_strict',
              proposed_threshold: 0.97,
              proposed_remove: false,
            }),
          ]),
        })}
      />,
    )
    const acceptBtn = screen.getByRole('button', { name: /Accept Change/i })
    await user.click(acceptBtn)
    await user.click(acceptBtn)
    const card = container.querySelector('[data-triage-card="tts1"]')!
    expect(card.className).toContain('border-border')
    expect(card.className).not.toContain('border-success')
    expect(card.className).not.toContain('ring-1')
  })

  it('filter tabs: clicking Needs Decision hides transform_fixable cards; All restores them', async () => {
    const user = userEvent.setup()
    render(
      <TriageStage
        session={makeSession({
          triage_result: makeTriageResult([
            makeClassification({
              rule_id: 'tf1', classification: 'transform_fixable',
              proposed_remove: false, proposed_threshold: undefined,
            }),
            makeClassification({
              rule_id: 'tts1', classification: 'threshold_too_strict',
              proposed_threshold: 0.97, proposed_remove: false,
            }),
          ]),
        })}
      />,
    )
    expect(screen.getByText('tf1')).toBeInTheDocument()
    expect(screen.getByText('tts1')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^Needs Decision$/ }))
    expect(screen.queryByText('tf1')).toBeNull()
    expect(screen.getByText('tts1')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^All$/ }))
    expect(screen.getByText('tf1')).toBeInTheDocument()
    expect(screen.getByText('tts1')).toBeInTheDocument()
  })

  it('the active filter tab uses bg-brand-primary + text-on-brand; inactive uses bg-surface + border-border', () => {
    render(
      <TriageStage
        session={makeSession({
          triage_result: makeTriageResult([makeClassification({ rule_id: 'r1' })]),
        })}
      />,
    )
    const allBtn = screen.getByRole('button', { name: /^All$/ })
    expect(allBtn.className).toContain('bg-brand-primary')
    expect(allBtn.className).toContain('text-on-brand')
    const fixableBtn = screen.getByRole('button', { name: /^Fixable$/ })
    expect(fixableBtn.className).toContain('bg-surface')
    expect(fixableBtn.className).toContain('border-border')
    expect(fixableBtn.className).toContain('text-fg-muted')
  })

  it('submit bar shows "N rules need a decision" with N in text-warning-deep when pending; disables submit', () => {
    render(
      <TriageStage
        session={makeSession({
          triage_result: makeTriageResult([
            makeClassification({
              rule_id: 'tts1', classification: 'threshold_too_strict',
              proposed_threshold: 0.97, proposed_remove: false,
            }),
            makeClassification({
              rule_id: 'tts2', classification: 'threshold_too_strict',
              proposed_threshold: 0.99, proposed_remove: false,
            }),
          ]),
        })}
      />,
    )
    expect(screen.getByText(/rules need a decision/)).toBeInTheDocument()
    const count = screen.getByText('2', { selector: 'span' })
    expect(count.className).toContain('text-warning-deep')
    expect(count.className).toContain('font-semibold')
    const submit = screen.getByRole('button', { name: /Apply Triage Decisions/i })
    expect(submit).toBeDisabled()
  })

  it('submit bar shows "All decisions made — ready to proceed." and enables submit when every actionable card is decided', async () => {
    const user = userEvent.setup()
    render(
      <TriageStage
        session={makeSession({
          triage_result: makeTriageResult([
            makeClassification({
              rule_id: 'tts1', classification: 'threshold_too_strict',
              proposed_threshold: 0.97, proposed_remove: false,
            }),
          ]),
        })}
      />,
    )
    await user.click(screen.getByRole('button', { name: /Accept Change/i }))
    expect(screen.getByText(/All decisions made — ready to proceed\./)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Apply Triage Decisions/i })).not.toBeDisabled()
  })

  it('submit button uses bg-brand-accent + text-on-brand (navy CTA, not orange)', () => {
    render(
      <TriageStage
        session={makeSession({
          triage_result: makeTriageResult([
            makeClassification({
              rule_id: 'tts1', classification: 'threshold_too_strict',
              proposed_threshold: 0.97, proposed_remove: false,
            }),
          ]),
        })}
      />,
    )
    const submit = screen.getByRole('button', { name: /Apply Triage Decisions/i })
    expect(submit.className).toContain('bg-brand-accent')
    expect(submit.className).toContain('text-on-brand')
    expect(submit.className).not.toContain('bg-indigo')
  })

  it('clicking submit calls approveTriage with the expected payload shape', async () => {
    approveTriageMock.mockResolvedValue(undefined as never)
    const user = userEvent.setup()
    render(
      <TriageStage
        session={makeSession({
          session_id: 'sess-1',
          triage_result: makeTriageResult([
            makeClassification({
              rule_id: 'tts1', classification: 'threshold_too_strict',
              proposed_threshold: 0.97, proposed_remove: false,
            }),
            makeClassification({
              rule_id: 'un1', classification: 'unfixable',
              proposed_remove: true, proposed_threshold: undefined,
            }),
            makeClassification({
              rule_id: 'tts2', classification: 'threshold_too_strict',
              proposed_threshold: 0.99, proposed_remove: false,
            }),
          ]),
        })}
      />,
    )
    await user.click(screen.getAllByRole('button', { name: /Accept Change/i })[0])  // tts1 accepted
    await user.click(screen.getByRole('button', { name: /Accept Removal/i }))       // un1 accepted (remove)
    await user.click(screen.getAllByRole('button', { name: /Keep Original/i })[0])  // tts2 kept
    await user.click(screen.getByRole('button', { name: /Apply Triage Decisions/i }))
    expect(approveTriageMock).toHaveBeenCalledWith(
      'sess-1',
      [{ rule_id: 'tts1', new_threshold: 0.97 }],
      ['un1'],
    )
  })

  it('renders the error banner with bg-danger/15 + border-danger/30 + text-danger-deep when approveTriage rejects', async () => {
    approveTriageMock.mockRejectedValue(new Error('boom — server down'))
    const user = userEvent.setup()
    render(
      <TriageStage
        session={makeSession({
          triage_result: makeTriageResult([
            makeClassification({
              rule_id: 'tts1', classification: 'threshold_too_strict',
              proposed_threshold: 0.97, proposed_remove: false,
            }),
          ]),
        })}
      />,
    )
    await user.click(screen.getByRole('button', { name: /Accept Change/i }))
    await user.click(screen.getByRole('button', { name: /Apply Triage Decisions/i }))
    const banner = await screen.findByText(/boom — server down/)
    expect(banner.className).toContain('bg-danger/15')
    expect(banner.className).toContain('border-danger/30')
    expect(banner.className).toContain('text-danger-deep')
  })

  it('readOnly hides decision buttons, the "(no decision required)" note, and the submit bar', () => {
    render(
      <TriageStage
        readOnly
        session={makeSession({
          triage_result: makeTriageResult([
            makeClassification({
              rule_id: 'tts1', classification: 'threshold_too_strict',
              proposed_threshold: 0.97, proposed_remove: false,
            }),
            makeClassification({
              rule_id: 'tf1', classification: 'transform_fixable',
              proposed_remove: false, proposed_threshold: undefined,
            }),
          ]),
        })}
      />,
    )
    expect(screen.queryByRole('button', { name: /Accept/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Keep/ })).toBeNull()
    expect(screen.queryByText('(no decision required)')).toBeNull()
    expect(screen.queryByRole('button', { name: /Apply Triage Decisions/i })).toBeNull()
    // But cards still render — rule_ids visible
    expect(screen.getByText('tts1')).toBeInTheDocument()
    expect(screen.getByText('tf1')).toBeInTheDocument()
  })

  it('hides the submit bar when there are no actionable cards (transform_fixable-only result)', () => {
    render(
      <TriageStage
        session={makeSession({
          triage_result: makeTriageResult([
            makeClassification({
              rule_id: 'tf1', classification: 'transform_fixable',
              proposed_remove: false, proposed_threshold: undefined,
            }),
            makeClassification({
              rule_id: 'tf2', classification: 'transform_fixable',
              proposed_remove: false, proposed_threshold: undefined,
            }),
          ]),
        })}
      />,
    )
    expect(screen.queryByRole('button', { name: /Apply Triage Decisions/i })).toBeNull()
    expect(screen.queryByText(/rules need a decision/)).toBeNull()
    expect(screen.queryByText(/All decisions made/)).toBeNull()
  })
})
```

- [ ] **Step 2: Run, verify it fails**

```bash
cd frontend && npx jest __tests__/stages/TriageStage.test.tsx
```

Expected: FAIL — the current `TriageStage` uses pre-foundation tokens (`text-text-*`, `bg-surface-raised`, `border-indigo`, `border-l-{tone}/60`, hex amber/red), has no `role="status"` on the spinner, has no `aria-label="Triaging"`, has no `data-triage-card` attribute, doesn't use the `Chip` primitive (so the chip element has `font-mono rounded-full` instead of the primitive's `bg-{tone}/15 text-{tone}-deep`), uses literal `✓ / ✗` instead of lucide icons, and uses `bg-indigo` (not `bg-brand-accent`) on the submit button. Most class-name assertions should fail; structural assertions (decision buttons exist, submit bar exists) may pass against the current shape.

### Task 1.2: Rewrite `TriageStage.tsx`

**Files:**
- Modify: `frontend/components/stages/TriageStage.tsx` (full rewrite)

- [ ] **Step 1: Replace the file's contents**

```tsx
// frontend/components/stages/TriageStage.tsx
'use client'
import { useState } from 'react'
import { ArrowRight, Check, X } from 'lucide-react'
import type { SessionState, TriageClassification } from '@/lib/types'
import { approveTriage } from '@/lib/api'
import { Chip, type StatusTone } from '@/components/ui/Chip'

interface Props {
  session: SessionState
  readOnly?: boolean
}

type CardDecision = 'accept' | 'keep' | 'pending'
type FilterMode = 'all' | 'needs_decision' | 'fixable' | 'unfixable'

const CLASSIFICATION_TONE: Record<TriageClassification['classification'], StatusTone> = {
  transform_fixable: 'success',
  threshold_too_strict: 'warning',
  unfixable: 'danger',
  eval_error: 'warning',
}

const CLASSIFICATION_LABEL: Record<TriageClassification['classification'], string> = {
  transform_fixable: 'Transform Fixable',
  threshold_too_strict: 'Threshold Too Strict',
  unfixable: 'Unfixable',
  eval_error: 'Eval Error',
}

const CONFIDENCE_COLOR: Record<TriageClassification['confidence'], string> = {
  high: 'text-success-deep',
  medium: 'text-warning-deep',
  low: 'text-fg-muted',
}

const FILTER_LABEL: Record<FilterMode, string> = {
  all: 'All',
  needs_decision: 'Needs Decision',
  fixable: 'Fixable',
  unfixable: 'Unfixable / Error',
}

interface CardProps {
  item: TriageClassification
  decision: CardDecision
  onDecide: (ruleId: string, decision: CardDecision) => void
  readOnly?: boolean
}

function TriageCard({ item, decision, onDecide, readOnly }: CardProps) {
  const needsDecision = item.classification !== 'transform_fixable'

  const chrome =
    !needsDecision || decision === 'pending'
      ? 'border-border'
      : decision === 'accept'
        ? 'border-success ring-1 ring-success/40'
        : 'border-danger ring-1 ring-danger/40'

  const isThreshold = item.classification === 'threshold_too_strict'
  const acceptLabel = isThreshold ? 'Accept Change' : 'Accept Removal'
  const keepLabel = isThreshold ? 'Keep Original' : 'Keep Rule'

  return (
    <div
      data-triage-card={item.rule_id}
      className={`bg-surface border rounded-lg p-4 ${chrome}`}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex flex-wrap items-center gap-2">
          <Chip variant="status" tone={CLASSIFICATION_TONE[item.classification]}>
            {CLASSIFICATION_LABEL[item.classification]}
          </Chip>
          <span className="text-sm font-semibold text-fg font-mono">{item.rule_id}</span>
          {item.check && (
            <span className="text-xs text-fg-subtle font-mono">· {item.check}</span>
          )}
          {item.column && (
            <span className="text-xs text-fg-subtle font-mono">· {item.column}</span>
          )}
        </div>
        <span className={`text-xs ${CONFIDENCE_COLOR[item.confidence]}`}>
          confidence: {item.confidence}
        </span>
      </div>

      <p className="text-sm text-fg-muted leading-relaxed mb-3">{item.reason}</p>

      {needsDecision && (
        <>
          {item.classification === 'threshold_too_strict' && item.proposed_threshold !== undefined && (
            <div className="text-xs text-fg-muted mb-2">
              Proposed: raise threshold to{' '}
              <span className="font-semibold text-warning-deep">
                {(item.proposed_threshold * 100).toFixed(2)}%
              </span>
            </div>
          )}
          {(item.classification === 'unfixable' || item.classification === 'eval_error') && item.proposed_remove && (
            <div className="text-xs text-fg-muted mb-2">
              Proposed: <span className="font-semibold text-danger-deep">remove rule</span>
            </div>
          )}
        </>
      )}

      {needsDecision && !readOnly && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onDecide(item.rule_id, decision === 'accept' ? 'pending' : 'accept')}
            className={
              decision === 'accept'
                ? 'inline-flex items-center gap-1.5 bg-success-deep border border-success-deep text-on-brand text-[13px] font-semibold px-3 py-1.5 rounded-md transition-colors'
                : 'inline-flex items-center gap-1.5 bg-surface border border-success text-success-deep text-[13px] font-semibold px-3 py-1.5 rounded-md hover:bg-success/10 transition-colors'
            }
          >
            <Check size={14} strokeWidth={2} aria-hidden />
            {acceptLabel}
          </button>
          <button
            type="button"
            onClick={() => onDecide(item.rule_id, decision === 'keep' ? 'pending' : 'keep')}
            className={
              decision === 'keep'
                ? 'inline-flex items-center gap-1.5 bg-danger-deep border border-danger-deep text-on-brand text-[13px] font-semibold px-3 py-1.5 rounded-md transition-colors'
                : 'inline-flex items-center gap-1.5 bg-surface border border-danger text-danger-deep text-[13px] font-semibold px-3 py-1.5 rounded-md hover:bg-danger/10 transition-colors'
            }
          >
            <X size={14} strokeWidth={2} aria-hidden />
            {keepLabel}
          </button>
        </div>
      )}

      {!needsDecision && !readOnly && (
        <div className="text-xs text-fg-subtle italic">(no decision required)</div>
      )}
    </div>
  )
}

export function TriageStage({ session, readOnly }: Props) {
  const { stage, triage_result } = session

  const [decisions, setDecisions] = useState<Record<string, CardDecision>>(() => {
    const classifications = triage_result?.classifications ?? []
    return Object.fromEntries(
      classifications
        .filter(c => c.classification !== 'transform_fixable')
        .map(c => [c.rule_id, 'pending' as CardDecision]),
    )
  })
  const [filter, setFilter] = useState<FilterMode>('all')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (stage === 'TRIAGING' || !triage_result) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="bg-surface border border-border rounded-xl p-6 flex items-center gap-3">
          <div
            role="status"
            aria-label="Triaging"
            className="w-4 h-4 border-2 border-brand-primary border-t-transparent rounded-full animate-spin shrink-0"
          />
          <span className="text-xs text-fg-muted">
            AI is investigating failing rules…
          </span>
        </div>
      </div>
    )
  }

  const { classifications, summary } = triage_result

  const setDecision = (ruleId: string, decision: CardDecision) => {
    setDecisions(prev => ({ ...prev, [ruleId]: decision }))
  }

  const needsDecision = classifications.filter(c => c.classification !== 'transform_fixable')
  const canSubmit = needsDecision.every(c => decisions[c.rule_id] !== 'pending')
  const pendingCount = needsDecision.filter(c => decisions[c.rule_id] === 'pending').length

  const filteredClassifications = classifications.filter(c => {
    if (filter === 'all') return true
    if (filter === 'needs_decision') return c.classification !== 'transform_fixable'
    if (filter === 'fixable') return c.classification === 'transform_fixable'
    if (filter === 'unfixable') return c.classification === 'unfixable' || c.classification === 'eval_error'
    return true
  })

  async function handleSubmit() {
    setSubmitting(true)
    setError(null)
    try {
      const acceptedThresholdChanges = classifications
        .filter(c => c.classification === 'threshold_too_strict' && decisions[c.rule_id] === 'accept')
        .map(c => ({ rule_id: c.rule_id, new_threshold: c.proposed_threshold! }))

      const rejectedRuleIds = classifications
        .filter(c => (c.classification === 'unfixable' || c.classification === 'eval_error') && decisions[c.rule_id] === 'accept')
        .map(c => c.rule_id)

      await approveTriage(session.session_id, acceptedThresholdChanges, rejectedRuleIds)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Submission failed')
      setSubmitting(false)
    }
  }

  return (
    <div className="p-6 flex flex-col gap-6 max-w-3xl mx-auto">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-base font-bold text-fg">Triage Results</h1>
        <p className="text-xs text-fg-muted">
          Review the AI's classification of every failing rule and decide what to do with each.
        </p>
      </div>

      <div className="bg-surface border border-border rounded-xl p-4 flex flex-col gap-3">
        <div className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
          Triage Summary
        </div>
        <div className="flex flex-wrap gap-4">
          {summary.transform_fixable > 0 && (
            <span className="flex items-center gap-1.5 text-sm">
              <span className="w-2 h-2 rounded-full bg-success shrink-0" />
              <span className="text-fg-muted">{summary.transform_fixable} Transform Fixable</span>
            </span>
          )}
          {summary.threshold_too_strict > 0 && (
            <span className="flex items-center gap-1.5 text-sm">
              <span className="w-2 h-2 rounded-full bg-warning shrink-0" />
              <span className="text-fg-muted">{summary.threshold_too_strict} Threshold Too Strict</span>
            </span>
          )}
          {summary.unfixable > 0 && (
            <span className="flex items-center gap-1.5 text-sm">
              <span className="w-2 h-2 rounded-full bg-danger shrink-0" />
              <span className="text-fg-muted">{summary.unfixable} Unfixable</span>
            </span>
          )}
          {summary.eval_error > 0 && (
            <span className="flex items-center gap-1.5 text-sm">
              <span className="w-2 h-2 rounded-full bg-warning shrink-0" />
              <span className="text-fg-muted">{summary.eval_error} Eval Error</span>
            </span>
          )}
        </div>
      </div>

      <div className="flex gap-1.5">
        {(['all', 'needs_decision', 'fixable', 'unfixable'] as FilterMode[]).map(f => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={
              filter === f
                ? 'inline-flex items-center bg-brand-primary text-on-brand text-[11px] font-semibold px-2.5 py-1 rounded-md transition-colors'
                : 'inline-flex items-center bg-surface border border-border text-fg-muted text-[11px] font-semibold px-2.5 py-1 rounded-md hover:bg-elevated hover:border-fg-muted hover:text-fg transition-colors'
            }
          >
            {FILTER_LABEL[f]}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        {filteredClassifications.map(item => (
          <TriageCard
            key={item.rule_id}
            item={item}
            decision={decisions[item.rule_id] ?? 'pending'}
            onDecide={setDecision}
            readOnly={readOnly}
          />
        ))}
      </div>

      {needsDecision.length > 0 && !readOnly && (
        <div className="sticky bottom-4">
          <div className="bg-elevated border border-border rounded-xl p-4 flex items-center justify-between gap-4 shadow-lg">
            <div className="text-sm text-fg-muted">
              {canSubmit ? (
                'All decisions made — ready to proceed.'
              ) : (
                <>
                  <span className="text-warning-deep font-semibold">{pendingCount}</span>{' '}
                  {pendingCount === 1 ? 'rule needs' : 'rules need'} a decision.
                </>
              )}
            </div>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit || submitting}
              className="inline-flex items-center gap-1.5 bg-brand-accent text-on-brand text-[13px] font-semibold px-4 py-2 rounded-md hover:bg-brand-accent/90 hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {submitting ? 'Submitting…' : 'Apply Triage Decisions'}
              {!submitting && <ArrowRight size={14} strokeWidth={2} aria-hidden />}
            </button>
          </div>
          {error && (
            <div className="mt-2 bg-danger/15 border border-danger/30 rounded-lg px-3 py-2 text-xs text-danger-deep">
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify TriageStage tests pass**

```bash
cd frontend && npx jest __tests__/stages/TriageStage.test.tsx
```

Expected: every assertion passes. Test count will land around 19 (the count above) — within ±1 of the spec's "~16" target.

- [ ] **Step 3: Full suite + type-check + build**

```bash
cd frontend && npx tsc --noEmit && npx jest && npm run build
```

Expected:
- `tsc --noEmit`: clean on new / modified files. The pre-existing `.next/types/validator.ts` warning is a stale Next.js artifact — ignore; `npm run build` regenerates it clean.
- `jest`: pre-existing `__tests__/hooks/useAIStream.test.ts` failure remains the only red. Going-in baseline at start of Stage 7: 206 passing / 1 failing. After Stage 7 Phase 1: ~225 passing / 1 failing (+19 new TriageStage assertions, plus the test file's structural counts — exact total within ±1).
- `npm run build`: succeeds.

- [ ] **Step 4: Commit Phase 1**

```bash
git add frontend/components/stages/TriageStage.tsx \
        frontend/__tests__/stages/TriageStage.test.tsx
git commit -m "$(cat <<'EOF'
feat(triage): rewrite TriageStage to token-driven chrome

Replaces the pre-foundation-v1 implementation:
- Heading + subhead added with the established Round 2 pattern
  (text-base font-bold text-fg + text-xs text-fg-muted).
- Loading state spinner ring is brand-primary with role="status" +
  aria-label="Triaging" (matches Load + Profile + Explore + Validate).
  Drops the redundant "AI panel shows live progress" hint copy.
- Summary card retokenized: bg-surface-raised → bg-surface, dot
  alpha /60 → full token (bg-success / bg-warning / bg-danger), hex
  bg-red-500 / bg-amber-500 dots replaced by foundation tokens, count
  labels switched to Title Case ("Transform Fixable", "Threshold Too
  Strict", "Unfixable", "Eval Error"). text-text-muted → text-fg-muted.
- Filter tabs swap bg-indigo/20 + text-indigo-300 + border-indigo/40
  for the chip-system-v1 vocabulary: bg-brand-primary + text-on-brand
  active, bg-surface + border-border + text-fg-muted inactive with
  hover:bg-elevated. Title Cased "Unfixable / Error" label.
- Classification badges migrated from inline rounded-full font-mono
  pills to the Chip primitive (variant=status). Tone mapping:
  transform_fixable → success, threshold_too_strict → warning,
  unfixable → danger, eval_error → warning (split from danger because
  eval_error is a technical issue, not a quality verdict on the data).
- Card chrome swaps single-side border-l-{tone}/60 accent for the
  Rules approved/denied pattern: Accept → border-success ring-1
  ring-success/40, Keep → border-danger ring-1 ring-danger/40,
  pending / no-decision-required → border-border (no ring). The chip
  on the top-left carries the classification signal; the chrome
  carries the decision signal.
- Decision buttons use the Rules pattern: active Accept = bg-success-
  deep + text-on-brand, inactive Accept = bg-surface + border-success
  + text-success-deep + hover:bg-success/10. Same shape on Keep with
  danger tokens. Literal ✓ / ✗ glyphs replaced with lucide Check + X.
- Proposed line values retokenized: threshold % → text-warning-deep,
  "remove rule" → text-danger-deep (destructive action keeps danger
  even though the chip is warning).
- Confidence text retokenized: text-success-light → text-success-deep,
  text-warning → text-warning-deep, text-text-muted → text-fg-muted.
  Stays inline (not promoted to a chip).
- Submit bar: pending-count number text-warning → text-warning-deep
  font-semibold. CTA bg-indigo → bg-brand-accent + text-on-brand with
  lucide ArrowRight icon, drops the literal → glyph.
- Error banner retokenized: bg-red-500/10 border-red-500/30 text-
  red-400 → bg-danger/15 border-danger/30 text-danger-deep.

Behavior preserved verbatim: same Props ({session, readOnly}), same
filter modes (all / needs_decision / fixable / unfixable), same
local-state decision tracking, same canSubmit gate (every actionable
card decided), same approveTriage payload shape (accepted threshold
changes + rejected rule IDs from unfixable + eval_error). readOnly
hides decision buttons + "(no decision required)" note + the entire
submit bar (Triage has a real human gate — readOnly is honored here).

19 new integration tests cover loading state (TRIAGING + missing
triage_result), header rendering, summary card non-zero filtering +
Title Case labels + full-alpha dots, classification chip tones and
labels, confidence color mapping, transform_fixable card's "(no
decision required)" path, threshold and remove-rule Proposed lines,
pending → accept → pending toggling on Accept + Keep, card chrome
state per decision, filter-tab active class + filtering behavior,
submit-bar pending count + ready-to-proceed states, approveTriage
payload shape, navy brand-accent CTA, error-banner danger tokens,
readOnly hiding all human-action surfaces, and the no-actionable-
cards-hides-submit edge case. Pre-existing useAIStream red unchanged.
EOF
)"
```

---

## Phase 2 — Wire into `/demo`

The walkthrough's active stage advances from `'validate'` to `'triage'`. Validate becomes a clickable past stage. The new `DEMO_TRIAGE_SESSION` fixture provides a realistic mix of all four classifications (2 transform_fixable, 3 threshold_too_strict, 2 unfixable, 1 eval_error) so the user can exercise every card state in the demo.

### Task 2.1: Add the `DEMO_TRIAGE_SESSION` fixture

**Files:**
- Modify: `frontend/app/demo/_fixtures/mock-session.ts`

- [ ] **Step 1: Update the top-of-file type import**

Find the existing top-of-file import block:

```ts
import type { SessionState, Rule, SessionListEntry, PerRuleResult, ValidationResults } from '@/lib/types'
```

Replace with (adding `TriageResult` and `TriageClassification`):

```ts
import type {
  SessionState,
  Rule,
  SessionListEntry,
  PerRuleResult,
  ValidationResults,
  TriageResult,
  TriageClassification,
} from '@/lib/types'
```

- [ ] **Step 2: Append the new fixture below `DEMO_VALIDATE_SESSION`**

Find the closing brace of `export const DEMO_VALIDATE_SESSION: SessionState = { ... }` (around line 320). After it, before the next export, add:

```ts
// Triage fixture exercises all four classifications + a mix of confidences.
// Mirrors the failing rules from DEMO_VALIDATE_SESSION (phone-format,
// email-regex, future application_date, the sandboxed custom rule, plus
// two synthetic threshold_too_strict / unfixable entries to round out
// the four-classification coverage).
const DEMO_TRIAGE_CLASSIFICATIONS: TriageClassification[] = [
  {
    rule_id: 'r6',
    check: 'regex(email)',
    column: 'email',
    classification: 'threshold_too_strict',
    proposed_threshold: 0.97,
    proposed_remove: false,
    reason:
      '6 of 200 emails fail strict RFC 5322 regex but match a relaxed pattern. Raising the threshold from 95% to 97% would let these pass without dropping data quality.',
    confidence: 'high',
  },
  {
    rule_id: 'r5',
    check: 'max_date(today)',
    column: 'application_date',
    classification: 'threshold_too_strict',
    proposed_threshold: 0.99,
    proposed_remove: false,
    reason:
      '3 application dates are in the future, likely typos. The AI suggests accepting these as outliers via a 99% threshold rather than blocking the pipeline.',
    confidence: 'medium',
  },
  {
    rule_id: 'r7',
    check: 'format((XXX) XXX-XXXX)',
    column: 'phone',
    classification: 'transform_fixable',
    proposed_threshold: undefined,
    proposed_remove: false,
    reason:
      '152 phone numbers fail the strict format check, but each row matches one of 5 alternate formats. A normalization transform can fix every row automatically — no rule change needed.',
    confidence: 'high',
  },
  {
    rule_id: 'r9-eval',
    check: 'custom_code(format_check)',
    column: 'co_signer_ssn',
    classification: 'eval_error',
    proposed_threshold: undefined,
    proposed_remove: true,
    reason:
      'Custom SSN-format check failed to compile against the sandboxed environment (NameError on `re` import). The rule cannot be evaluated and must be rewritten or removed.',
    confidence: 'medium',
  },
  {
    rule_id: 'r10-synth',
    check: 'not_null',
    column: 'co_signer_phone',
    classification: 'unfixable',
    proposed_threshold: undefined,
    proposed_remove: true,
    reason:
      'co_signer_phone is null in 87% of rows because most loans don\'t have co-signers. The column is correctly missing — this is not a data quality issue.',
    confidence: 'high',
  },
  {
    rule_id: 'r11-synth',
    check: 'unique',
    column: 'middle_initial',
    classification: 'unfixable',
    proposed_threshold: undefined,
    proposed_remove: true,
    reason:
      'middle_initial is intentionally non-unique (1-letter values repeat naturally). The uniqueness rule was inferred incorrectly during profiling.',
    confidence: 'high',
  },
  {
    rule_id: 'r12-synth',
    check: 'range(300, 850)',
    column: 'credit_score',
    classification: 'threshold_too_strict',
    proposed_threshold: 0.995,
    proposed_remove: false,
    reason:
      '1 legacy row has credit_score=0 from a pre-FICO import. Accepting at 99.5% tolerance keeps the rule strict for new data while letting the historical row through.',
    confidence: 'low',
  },
  {
    rule_id: 'r13-synth',
    check: 'custom_code(domain_check)',
    column: 'employer_domain',
    classification: 'transform_fixable',
    proposed_threshold: undefined,
    proposed_remove: false,
    reason:
      'employer_domain values include both bare hostnames ("ibm.com") and protocol-prefixed URLs ("https://ibm.com"). A normalization step can canonicalize them automatically.',
    confidence: 'high',
  },
]

const DEMO_TRIAGE_RESULT: TriageResult = {
  classifications: DEMO_TRIAGE_CLASSIFICATIONS,
  summary: {
    transform_fixable: 2,
    threshold_too_strict: 3,
    unfixable: 2,
    eval_error: 1,
  },
}

export const DEMO_TRIAGE_SESSION: SessionState = {
  ...baseSession('AWAITING_TRIAGE_APPROVAL'),
  ai_summary: DEMO_AI_SUMMARY,
  suggested_rules: DEMO_RULES,
  baseline_quality_score: 0.78,
  current_score: 0.82,
  validation_summary: DEMO_VALIDATE_SESSION.validation_summary,
  anomaly_summary: DEMO_VALIDATE_SESSION.anomaly_summary,
  validation_results: DEMO_VALIDATION_RESULTS,
  triage_result: DEMO_TRIAGE_RESULT,
}
```

- [ ] **Step 3: Verify the fixture compiles**

```bash
cd frontend && npx tsc --noEmit
```

Expected: clean. If TS complains about a missing `TriageClassification` field, cross-check `frontend/lib/types.ts:90` — `proposed_remove` is required (`boolean`, not optional), `confidence` is required (`'high' | 'medium' | 'low'`). All other fields are optional.

### Task 2.2: Advance `/demo` workspace to the Triage stage

**Files:**
- Modify: `frontend/app/demo/page.tsx`

- [ ] **Step 1: Import the new fixture and the TriageStage component**

Find the existing imports block at the top of `frontend/app/demo/page.tsx`. Add the new component import alongside the others:

```ts
import { TriageStage } from '@/components/stages/TriageStage'
```

Then update the fixture-import block to include `DEMO_TRIAGE_SESSION`. The current import is:

```ts
import {
  DEMO_AI_EVENTS,
  DEMO_EXPLORE_STATE,
  DEMO_FILENAME,
  DEMO_PROFILE_SESSION,
  DEMO_PROFILE_TABLE,
  DEMO_RULES_SESSION,
  DEMO_VALIDATE_SESSION,
  DEMO_SESSIONS_LIST,
} from './_fixtures/mock-session'
```

Replace with:

```ts
import {
  DEMO_AI_EVENTS,
  DEMO_EXPLORE_STATE,
  DEMO_FILENAME,
  DEMO_PROFILE_SESSION,
  DEMO_PROFILE_TABLE,
  DEMO_RULES_SESSION,
  DEMO_VALIDATE_SESSION,
  DEMO_TRIAGE_SESSION,
  DEMO_SESSIONS_LIST,
} from './_fixtures/mock-session'
```

- [ ] **Step 2: Add `'triage'` to the demo's in-scope stage list**

Find:

```ts
const DEMO_STAGES: StageId[] = ['load', 'profile', 'explore', 'rules', 'validate']
```

Replace with:

```ts
const DEMO_STAGES: StageId[] = ['load', 'profile', 'explore', 'rules', 'validate', 'triage']
```

- [ ] **Step 3: Update the WAITING_MESSAGES map**

Find:

```ts
const WAITING_MESSAGES: Record<StageId, string | undefined> = {
  load: 'Loading dataset…',
  profile: 'Profiling complete',
  explore: 'Awaiting exploration review',
  rules: 'Awaiting rule decisions',
  validate: 'Running validation rules…',
  triage: undefined,
  plan: undefined,
  transform: undefined,
  scorecard: undefined,
  pipeline: undefined,
}
```

Change `triage: undefined` to `triage: 'Awaiting triage decisions'`:

```ts
const WAITING_MESSAGES: Record<StageId, string | undefined> = {
  load: 'Loading dataset…',
  profile: 'Profiling complete',
  explore: 'Awaiting exploration review',
  rules: 'Awaiting rule decisions',
  validate: 'Running validation rules…',
  triage: 'Awaiting triage decisions',
  plan: undefined,
  transform: undefined,
  scorecard: undefined,
  pipeline: undefined,
}
```

- [ ] **Step 4: Advance ACTIVE_STAGE to 'triage'**

Find:

```ts
const ACTIVE_STAGE: StageId = 'validate'
```

Replace with:

```ts
const ACTIVE_STAGE: StageId = 'triage'
```

(The `COMPLETED_STAGES` line below uses `STAGE_ORDER.slice(0, STAGE_ORDER.indexOf(ACTIVE_STAGE))` so it'll automatically expand to include `'validate'` as a completed/clickable past stage. No other change needed there.)

- [ ] **Step 5: Update the TopBar score binding**

Find:

```tsx
currentScore={DEMO_VALIDATE_SESSION.current_score}
```

Replace with:

```tsx
currentScore={DEMO_TRIAGE_SESSION.current_score}
```

(`DEMO_TRIAGE_SESSION.current_score` is also `0.82`, so the score chip doesn't visibly change — but the binding tracks the new "live workflow position" correctly.)

- [ ] **Step 6: Add the `'triage'` case to `renderStage()`**

Find the `switch (viewingStage) {` block. After the `case 'validate':` block (which returns `<ValidateStage session={DEMO_VALIDATE_SESSION} />`), add a new case:

```tsx
      case 'triage':
        return <TriageStage session={DEMO_TRIAGE_SESSION} />
```

The `default:` case below it continues to render `<OutOfScopePlaceholder stage={viewingStage} />` for plan / transform / scorecard / pipeline — no change.

- [ ] **Step 7: Update the OutOfScopePlaceholder copy**

Find:

```tsx
The /demo route covers the Round 2 redesigns shipped so far — Sessions, Load, Profile, Explore, Rules, and Validate. Later stages will land here as they're retokenized.
```

Replace with:

```tsx
The /demo route covers the Round 2 redesigns shipped so far — Sessions, Load, Profile, Explore, Rules, Validate, and Triage. Later stages will land here as they're retokenized.
```

- [ ] **Step 8: Verify the build**

```bash
cd frontend && npx tsc --noEmit && npm run build
```

Expected: tsc clean on the modified files, build succeeds, `/demo` route still emits.

- [ ] **Step 9: Spot-check the full test suite**

```bash
cd frontend && npx jest
```

Expected: same ~225 passing / 1 failing as after Phase 1 — no new tests, but make sure the demo-page change didn't regress the existing suite.

- [ ] **Step 10: Commit Phase 2**

```bash
git add frontend/app/demo/page.tsx frontend/app/demo/_fixtures/mock-session.ts
git commit -m "$(cat <<'EOF'
feat(demo): advance walkthrough to Triage stage

The demo's live workflow position moves from Validate to Triage.
Validate becomes a clickable past stage in the stepper; Triage is
the new default landing stage. Adds DEMO_TRIAGE_SESSION fixture
with 8 TriageClassification entries covering all four classifications
(2 transform_fixable — phone-format normalization + employer_domain
canonicalization; 3 threshold_too_strict — email-regex tolerance,
future-date acceptance, credit_score legacy outlier; 2 unfixable —
co_signer_phone correctly nullable + middle_initial uniqueness
mis-inferred; 1 eval_error — sandboxed custom_code(format_check)
NameError). Confidence levels span high / medium / low so the
confidence-color mapping is exercised end-to-end in the demo.

TopBar currentScore binding moves to DEMO_TRIAGE_SESSION (still
0.82; tracks the live workflow position). Stepper substatus on
Triage reads "Awaiting triage decisions". OutOfScopePlaceholder
copy updated to mention Triage as in-scope.
EOF
)"
```

---

## Phase 3 — Verification + final review + tag

No code changes. Walk through the demo, run the cross-stage code review, then tag `triage-stage-v1`.

### Task 3.1: Manual smoke test

- [ ] **Step 1: Pull the branch into the primary checkout and start the dev server**

```bash
cd ~/Downloads/GitHub/ai-dq-accelerator
git pull /Users/anjani.dabkara/ai-dq-accelerator claude/strange-leakey-efbec6 --ff-only
npm --prefix frontend run dev
```

Open `http://localhost:3000/demo` → click any session card → land on the Triage stage by default.

- [ ] **Step 2: Walk through the Triage stage scenarios**

1. **Default view (Triage active)** — Header reads "Triage Results" + the subhead. Summary card shows `● 2 Transform Fixable · ● 3 Threshold Too Strict · ● 2 Unfixable · ● 1 Eval Error` with the dots in full alpha (no translucency).
2. **Filter tabs** — `All` is the active orange (`bg-brand-primary`) button; the other three are neutral elevated (bg-surface + border). Click `Needs Decision` → both transform_fixable cards (`r7` and `r13-synth`) disappear from the list. Click `Fixable` → only those two appear. Click `Unfixable / Error` → `r9-eval`, `r10-synth`, `r11-synth` appear. Click back to `All`.
3. **Pending card** — every actionable card (everything except the two `transform_fixable` rows) starts with the plain `border-border` outline (no ring). The chip on the top-left carries the classification signal in the right tone (warning amber for `threshold_too_strict` and `eval_error`, danger red for `unfixable`, success green for `transform_fixable`).
4. **Accept toggle** — Click "Accept Change" on `r6` (the email threshold card). Card outline switches to `border-success` with the soft ring glow (`ring-1 ring-success/40`). Accept button fills in deep success green with white text + lucide Check icon. Click it again → returns to pending state.
5. **Keep toggle** — Click "Keep Rule" on `r10-synth` (co_signer_phone unfixable). Card outline switches to `border-danger` with `ring-1 ring-danger/40`. Keep button fills in deep danger red with white text + lucide X icon.
6. **Transform fixable card** — `r7` (phone-format) shows the "(no decision required)" italic footer in `text-fg-subtle`, NO Accept/Keep buttons, NO Proposed line.
7. **Proposed line on threshold cards** — `r6` shows "Proposed: raise threshold to **97.00%**" with the percentage in `text-warning-deep font-semibold`. `r12-synth` shows "99.50%".
8. **Proposed line on unfixable cards** — `r10-synth` shows "Proposed: **remove rule**" with "remove rule" in `text-danger-deep font-semibold`.
9. **Confidence colors** — `r6` ("confidence: high") in `text-success-deep`. `r9-eval` ("confidence: medium") in `text-warning-deep`. `r12-synth` ("confidence: low") in `text-fg-muted`.
10. **Submit bar — pending state** — Before any decisions: "**6** rules need a decision." with `6` in `text-warning-deep font-semibold`. Submit button is the navy `bg-brand-accent` CTA with lucide ArrowRight, label "Apply Triage Decisions", disabled state has reduced opacity.
11. **Submit bar — ready state** — After deciding all 6 actionable cards: "All decisions made — ready to proceed." Submit button enabled.
12. **Stepper** — load / profile / explore / rules / validate all show the green check; triage is active (orange dot); plan / transform / scorecard / pipeline are locked.
13. **Click back to Validate** — Validate is now clickable in the stepper; clicking jumps to the past view with the existing warning banner ("Viewing past stage — triage is the active stage"). Click "Return →" to come back.

If any of these don't render correctly, fix in-branch before tagging.

- [ ] **Step 3: Cross-stage smoke (regressions on past stages)**

Click each clickable stepper stage (`load`, `profile`, `explore`, `rules`, `validate`) and confirm each still renders without console errors. The warning banner ("Viewing past stage — triage is the active stage") should appear on each.

### Task 3.2: Final cross-stage code review

- [ ] **Step 1: Dispatch the `superpowers:code-reviewer` agent**

Run the final review per the user-locked pattern (no per-task reviews; one final review at end). The reviewer should check:

- **Spec compliance** against `docs/superpowers/specs/2026-05-19-triage-stage-redesign.md` — every row of the "What changes vs. today" table is implemented and every behavior in the behavior matrix is honored.
- **All ~19 new TriageStage test cases pass.**
- **Token usage clean** — zero references to `text-text-*`, `bg-surface-raised`, `bg-indigo`, `border-indigo`, `text-indigo-*`, `border-l-success/60`, `border-l-warning/60`, `border-l-red-500*`, `border-l-amber-500*`, `bg-red-500*`, `bg-amber-500*`, `text-red-400`, `text-amber-400`, or any hex Tailwind color in `TriageStage.tsx`. Quick grep:
  ```bash
  grep -nE 'text-text-|bg-surface-raised|bg-indigo|border-indigo|text-indigo|red-500|amber-500|red-400|amber-400' frontend/components/stages/TriageStage.tsx
  ```
  Expected: zero matches.
- **Chip primitive usage** — classification badges go through `<Chip variant="status" tone={...}>`, not inline class strings.
- **Behavior preserved** — same Props, same filter modes, same decision-state local-state shape, same `approveTriage` payload (`acceptedThresholdChanges` from `threshold_too_strict` with decision === 'accept'; `rejectedRuleIds` from `unfixable` + `eval_error` with decision === 'accept').
- **`readOnly` IS honored** here (Triage has a human gate). Decision buttons + "(no decision required)" note + submit bar all hidden when `readOnly` is true; the card list still renders.
- **`tsc --noEmit` clean**, full suite at baseline (~225/226 — the pre-existing useAIStream red is the only failure).
- **`npm run build` succeeds**.
- **Figma frame at `(80, 7700)`** exists, named `Triage / 1440x900 / Default`, and matches the spec's visual decisions (verified in Phase 0).

If APPROVED, proceed to tag. If CHANGES_REQUESTED, fix and re-review.

### Task 3.3: Tag `triage-stage-v1`

- [ ] **Step 1: Create the annotated tag**

```bash
git tag -a triage-stage-v1 -m "$(cat <<'EOF'
Round 2 Stage 7 — Triage stage redesign

Retokenized TriageStage with:
- Heading + subhead added in the established Round 2 pattern.
- Brand-primary spinner ring on the loading state with role=status +
  aria-label=Triaging (matches Load + Profile + Explore + Validate).
  Redundant "AI panel shows live progress" hint dropped.
- Summary card retokenized: bg-surface-raised → bg-surface, dot
  alpha /60 → full token color, snake_case labels → Title Case
  ("Transform Fixable", "Threshold Too Strict", "Unfixable",
  "Eval Error"), hex bg-red-500 / bg-amber-500 dots → bg-danger /
  bg-warning foundation tokens.
- Filter tabs swap bg-indigo/20 + text-indigo-300 + border-indigo/40
  active for bg-brand-primary + text-on-brand; inactive uses
  bg-surface + border-border + text-fg-muted with hover:bg-elevated.
- Classification badges migrated to the Chip primitive (variant=status)
  with the chip-system-v1 tone mapping: transform_fixable=success,
  threshold_too_strict=warning, unfixable=danger, eval_error=warning
  (split off from danger — technical issue, not quality verdict).
- Card chrome swaps single-side border-l-{tone}/60 accent for the
  Rules approved/denied pattern: Accept → border-success ring-1
  ring-success/40, Keep → border-danger ring-1 ring-danger/40,
  pending → border-border. The chip carries classification; the
  chrome carries decision.
- Decision buttons use the Rules pattern: active Accept/Keep =
  bg-{tone}-deep + text-on-brand; inactive = bg-surface + border-
  {tone} + text-{tone}-deep + hover:bg-{tone}/10. Literal ✓ / ✗
  glyphs replaced with lucide Check / X icons.
- Proposed-line values retokenized: threshold % → text-warning-deep,
  "remove rule" → text-danger-deep (destructive action keeps danger
  even when the chip is warning).
- Confidence text retokenized to {-deep} variants, stays inline (not
  promoted to a chip).
- Submit bar: pending-count → text-warning-deep font-semibold. CTA
  bg-indigo → bg-brand-accent + text-on-brand with lucide ArrowRight.
- Error banner retokenized to bg-danger/15 + border-danger/30 +
  text-danger-deep (dimension-chip danger pattern).

Behavior preserved verbatim: same Props ({session, readOnly}), same
filter modes, same canSubmit gate, same approveTriage payload
shape. readOnly hides decision buttons + "(no decision required)"
note + submit bar — Triage has a real human gate.

The /demo workspace now lands on Triage by default (active stage
advances from Validate to Triage; Validate becomes a clickable past
stage). DEMO_TRIAGE_SESSION fixture covers all four classifications
across 8 cards with high/medium/low confidence levels so every card
state is exercised in the demo.

Figma frame mirrored at slot (80, 7700) on page 02 — Foundation
named "Triage / 1440x900 / Default" (built BEFORE the code under
the Figma-first preference).

19 new integration tests; full suite ~225/226 passing (the pre-
existing useAIStream red predates Round 1).
EOF
)" && git tag --list 'triage-stage-v1'
```

- [ ] **Step 2: Confirm the tag**

```bash
git show triage-stage-v1 --no-patch --format="%H %s"
```

Expected: prints the SHA of the most recent commit (the Phase 2 demo wiring) and its title.

---

## Self-review notes

**Spec coverage check:**

| Spec section | Implemented in |
|---|---|
| Loading state — brand-primary spinner + role=status + aria-label="Triaging" + dropped hint | Task 1.2 (loading branch) + Task 1.1 (spinner-class + role + copy assertions) |
| Header block — title + subhead | Task 1.2 (`<div className="flex flex-col gap-0.5">` block) + Task 1.1 (heading + subhead assertion) |
| Summary card retokenize + full-alpha dots + Title Case labels | Task 1.2 (summary block) + Task 1.1 (non-zero filter + Title Case + full-alpha assertions) |
| Filter tabs — active brand-primary + inactive neutral elevated | Task 1.2 (filter buttons) + Task 1.1 (active class + filter-behavior tests) |
| Classification → tone + label mapping (incl. eval_error → warning) | Task 1.2 (`CLASSIFICATION_TONE` + `CLASSIFICATION_LABEL` maps) + Task 1.1 (per-tone chip assertions) |
| Card chrome — decision-driven outline + ring (Rules pattern) | Task 1.2 (`chrome` ternary) + Task 1.1 (pending + accept + keep state assertions) |
| Decision buttons — Rules approved/denied vocabulary + lucide icons | Task 1.2 (Accept/Keep button class strings + `<Check />` / `<X />`) + Task 1.1 (active deep-fill + payload + icon presence assertions) |
| Proposed line — threshold (warning-deep) + remove rule (danger-deep) | Task 1.2 (Proposed branches) + Task 1.1 (threshold + remove-rule assertions) |
| Confidence text — deep tokens, stays inline | Task 1.2 (`CONFIDENCE_COLOR` map) + Task 1.1 (per-level color assertion) |
| Submit bar — pending count warning-deep + ready copy + brand-accent CTA | Task 1.2 (sticky submit block) + Task 1.1 (pending + ready + brand-accent + disabled assertions) |
| approveTriage payload preserved | Task 1.2 (`handleSubmit`) + Task 1.1 (payload-shape assertion) |
| Error banner — bg-danger/15 + border-danger/30 + text-danger-deep | Task 1.2 (error branch) + Task 1.1 (error-tokens assertion) |
| `readOnly` honored — hides buttons + note + submit bar | Task 1.2 (`!readOnly` guards on buttons + "(no decision required)" + submit) + Task 1.1 (readOnly assertion) |
| transform_fixable-only — submit bar hidden | Task 1.2 (`needsDecision.length > 0` guard) + Task 1.1 (no-actionable-cards assertion) |
| Filter tabs — Title Case "Unfixable / Error" | Task 1.2 (`FILTER_LABEL` map) + Task 1.1 (filter-label assertions in filter-behavior test) |
| `/demo` advances to Triage | Phase 2 (ACTIVE_STAGE update + render case + fixture + OutOfScopePlaceholder copy) |
| Figma frame at `(80, 7700)` | Phase 0 (Triage / 1440x900 / Default) |

**Placeholder scan:** Every step contains complete code or an exact command with expected output. No TBDs, no "similar to Task N", no `// add error handling here` stubs. Phase 0's Figma steps describe sections + exact tokens + dimensions; the implementer doing the Figma build uses `use_figma` calls to create the nodes (the API surface is too rich to fully script in this plan, but the spec for what to draw is complete).

**Type consistency:**
- `TriageClassification` and `TriageResult` types come from `frontend/lib/types.ts:90–104` — single source of truth. The plan's fixture uses every required field (`proposed_remove: boolean`, `confidence: 'high' | 'medium' | 'low'`); `proposed_threshold` is optional and omitted on non-threshold classifications via `undefined`.
- `CLASSIFICATION_TONE: Record<TriageClassification['classification'], StatusTone>` — TS will catch any drift between the type union and the map keys.
- `StatusTone` imported from `@/components/ui/Chip` matches the `chip-system-v1` primitive's public type — using the existing primitive is mandatory per the chip-system locked decisions.
- `WAITING_MESSAGES['triage']` updates from `undefined` to a string — no type changes (the value type is already `string | undefined`).

**Commit count:** Two `feat` commits (Phase 1 rewrite + Phase 2 demo wiring) + one annotated tag. Phase 0 produces no commit (Figma-only). Matches the Validate cadence.

**Out-of-scope reminders for the implementer:**
- Do **not** introduce a stats grid for the summary, a chip-row replacement of the filter tabs, or a collapsible section per classification. Vertical flow stays as today.
- Do **not** promote the confidence text to a chip. Inline text stays per the spec.
- Do **not** change the `approveTriage` payload shape. `acceptedThresholdChanges` and `rejectedRuleIds` array shapes are preserved verbatim.
- Do **not** change the WCAG contrast tokens (`text-success-deep` = `#166534`, `text-warning-deep` = `#92400E`). These were corrected in `chip-system-v1` — re-confirm via grep but don't re-touch.
- Do **not** add backend / API changes. The Triage signal handlers in the FastAPI / Temporal layer are out of scope.
- Do **not** swap the Score chip on the TopBar to something else. The chip-system-v1 score-variant exception stays.
- Do **not** delete or rename any of the Rules / Validate / Explore tokens or classes the implementer encounters. This stage's changes are localized to `TriageStage.tsx`, the new test file, the demo page, and the mock-session fixture.
