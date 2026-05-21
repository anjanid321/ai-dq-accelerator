# Validate Stage Redesign — Design Spec

**Round / Stage:** Round 2 / Stage 6
**Date:** 2026-05-19
**Predecessors:**
- [`2026-05-14-figma-roundtrip-redesign-design.md`](2026-05-14-figma-roundtrip-redesign-design.md) (foundation)
- [`2026-05-17-rules-stage-redesign.md`](2026-05-17-rules-stage-redesign.md) (Stage 1)
- [`2026-05-18-sessions-list-redesign.md`](2026-05-18-sessions-list-redesign.md) (Stage 2)
- [`2026-05-18-load-stage-and-ai-panel-scroll.md`](2026-05-18-load-stage-and-ai-panel-scroll.md) (Stage 3)
- [`2026-05-19-profile-stage-redesign.md`](2026-05-19-profile-stage-redesign.md) (Stage 4)
- [`2026-05-19-explore-stage-redesign.md`](2026-05-19-explore-stage-redesign.md) (Stage 5)

**Figma:** mirror to a new frame on page `02 — Foundation` at slot (80, 6700) after the code lands — separate phase, same cadence as `upload-modal-v1`.

---

## Goal

Replace `ValidateStage.tsx`'s pre-foundation chrome — `text-text-*` tokens, `bg-surface-raised` (legacy of `bg-elevated`), hardcoded Tailwind hex colors on rule-card left borders (`border-l-amber-500` / `border-l-red-500`), inline `bg-{amber,red}-500/15 text-{amber,red}-400` result chips, and a hardcoded indigo loading spinner — with token-driven layout that matches Stages 1–5. Visual parity: same score-header → rule-list → AI-prose structure today, just retokenized and polished against established Round 2 patterns (dimension chips, brand-primary spinner, accent-purple AI summary cards).

No behavior changes. The component still reads from `session.validation_results.per_rule`, still sorts failures + errors first, still embeds sample-failing-rows tables under failed rules, still renders the two AI prose sections at the bottom. There's no human gate — Validate auto-transitions to Triage — so no action buttons in scope.

---

## Out of scope

- Backend / API changes. We still consume `session.validation_results` as-is.
- Layout reworks. No grouping by category, no filter chips, no collapsible sections. Flat sorted list of rule cards stays.
- Stats-grid replacing the 5xl mega-score. Keep the existing score-header visual treatment.
- Action chrome. The workflow auto-transitions VALIDATING → TRIAGING so there's no Approve / Continue button to add.
- WCAG token cleanup. `text-{success,warning,danger}-deep` on `*/15` fills is borderline AA on small text — that's a token-level fix that ripples across every chip in Rules / Sessions / Profile / Explore / Validate / Triage / AI panel. We're addressing it in the queued post-Round-2 mini-stage so this stage doesn't muddle scope.
- `/demo` wiring. A separate phase after the stage ships (same cadence as Stage 5).
- Figma frame. A separate phase after the stage ships (same cadence as `upload-modal-v1`).
- Adding tests for the existing `useAIStream` red. That predates Round 1 — out of scope.

---

## Background

### Today's Validate stage (173 lines)

`frontend/components/stages/ValidateStage.tsx` renders, top-to-bottom:

1. **Loading state** — when `per_rule` is empty: indigo spinner + "AI is running validation rules against your dataset..." + a muted hint about the AI panel.
2. **Score header card** — `bg-surface-raised border border-border rounded-xl p-5` with:
   - Left: `5xl font-bold text-text` score + `2xl text-text-muted` % sign. Baseline line in `text-text-muted/60` below.
   - Right: `Quality Score` label + counts row (`X passed · Y failed · Z errored of N rules`) using `text-success` / `text-red-400` / `text-amber-400`.
   - Below: category pills (`bg-surface-raised text-text-muted border-border`).
3. **Rule list** — flat list of `RuleCard`s, sorted by `(!passed || !!error) DESC, failure_count DESC`. Each card:
   - `bg-surface-raised border border-border p-3 border-l-2` with `border-l-amber-500` / `border-l-red-500` / `border-l-success` left accent.
   - Header row: column name + monospace check + rationale on the left; failure rate + result chip on the right.
   - Result chip: `bg-amber-500/15 text-amber-400` / `bg-red-500/15 text-red-400` / `bg-success/15 text-success`.
   - Eval-error block: `bg-amber-500/10 border-amber-500/30 text-amber-300 font-mono` when `rule.error`.
   - Sample failing rows: small table (3 cols max, target column first) when `failed && sample_failing_rows.length > 0`.
4. **Validation Analysis prose** — bordered card with title (`text-text-muted uppercase`) + body (`text-text-muted leading-relaxed`).
5. **Anomaly Analysis prose** — same shape.

Legacy tokens used throughout (`text-text-*`, `bg-surface-raised`, `border-l-amber-500`, `border-l-red-500`, hex-color result chips, hardcoded indigo spinner).

### Where it's mounted

- `frontend/app/sessions/[id]/page.tsx` — `case 'validate'` (live: VALIDATING).
- `frontend/components/stages/SnapshotStageView.tsx` — historic snapshot view (calls `<ValidateStage session={fakeSession} readOnly />`). Note: `readOnly` is currently accepted but unused — there are no actions to suppress. The prop stays in the signature for source-compatibility.

Signature stays: `function ValidateStage({ session, readOnly }: Props)`.

---

## Design — page composition

The redesigned page renders sections top-to-bottom inside Main (`p-6 flex flex-col gap-6 max-w-3xl mx-auto` — same outer wrapper as today). Order:

```
Loading state           (full-page early return when per_rule is empty)
Header block            (title + subhead)
Score header card       (mega-score + counts + category pills)
Rule list               (sorted, RuleCard per rule)
AI prose section ×2     (Validation Analysis, Anomaly Analysis — accent-purple cards)
```

### Loading state

When `session?.validation_results?.per_rule` is empty or undefined, return early with:

```html
<div class="bg-surface border border-border rounded-xl p-6 flex items-center gap-3 max-w-3xl mx-auto m-6">
  <div role="status" aria-label="Validating" class="w-4 h-4 border-2 border-brand-primary border-t-transparent rounded-full animate-spin shrink-0" />
  <span class="text-xs text-fg-muted">
    AI is running validation rules against your dataset…
  </span>
</div>
```

Brand-primary spinner ring (matches Load + Profile + Explore loading patterns). `role="status"` + `aria-label`. The hint about the AI panel is dropped — redundant since the panel is always visible.

### Header block

```html
<div class="flex flex-col gap-0.5">
  <h1 class="text-base font-bold text-fg">Validation Results</h1>
  <p class="text-xs text-fg-muted">
    How your dataset performs against the proposed rules.
  </p>
</div>
```

Title + subhead, same pattern as every other stage.

### Score header card

Keep the existing visual treatment — big score, counts row, category pills — fully retokenized.

```html
<div class="bg-surface border border-border rounded-xl p-5">
  <div class="flex items-center gap-6">
    <div>
      <div class="text-5xl font-bold text-fg">
        {Math.round(score * 100)}<span class="text-2xl text-fg-muted">%</span>
      </div>
      {score !== baseline && (
        <div class="text-xs text-fg-subtle mt-1">baseline: {Math.round(baseline * 100)}%</div>
      )}
    </div>
    <div>
      <div class="text-xs font-semibold uppercase tracking-wider text-fg-muted mb-1">Quality Score</div>
      <div class="text-sm text-fg-muted">
        <span class="text-success-deep font-semibold">{passed} passed</span>
        {' · '}
        <span class="text-danger-deep font-semibold">{failed} failed</span>
        {errored > 0 && <>{' · '}<span class="text-warning-deep font-semibold">{errored} errored</span></>}
        <span class="text-fg-subtle"> of {perRule.length} rules</span>
      </div>
    </div>
  </div>
  {Object.keys(categoryScores).length > 0 && (
    <div class="flex flex-wrap gap-2 mt-4">
      {Object.entries(categoryScores).map(([cat, s]) => (
        <CategoryPill key={cat} label={cat} score={s} />
      ))}
    </div>
  )}
</div>
```

### Category pill

```html
<span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-elevated text-[11px] text-fg-muted border border-border">
  <span class="capitalize">{label}</span>
  <span class="font-semibold text-fg">{Math.round(score * 100)}%</span>
</span>
```

Matches the neutral elevated-chip pattern from Stage 5's Round chip.

### Rule card

Three states keyed off `passed` + `error`. Left-border accent token differs per state.

```html
<div class={`bg-surface border border-border rounded-lg p-3 border-l-2 ${borderColor}`}>
  <div class="flex items-start justify-between gap-3">
    <div class="flex flex-col gap-0.5 min-w-0">
      <span class="text-sm font-medium text-fg truncate">
        {rule.column ?? 'table-level'}
      </span>
      <span class="text-xs text-fg-subtle font-mono">{rule.check}</span>
      {rule.rationale && (
        <span class="text-xs text-fg-muted leading-snug">{rule.rationale}</span>
      )}
    </div>
    <div class="flex items-center gap-2 shrink-0">
      {failed && (
        <span class="text-xs text-fg-muted">
          {(rule.failure_rate * 100).toFixed(1)}% of rows
        </span>
      )}
      <span class={`text-[11px] font-semibold px-2 py-0.5 rounded-md ${chipClasses}`}>
        {hasError ? 'EVAL ERROR' : failed ? `FAILED · ${rule.failure_count}` : 'PASSED'}
      </span>
    </div>
  </div>
  {hasError && (
    <div class="mt-2 rounded-md bg-warning/15 border border-warning/30 px-2 py-1.5 text-[11px] font-mono text-warning-deep break-all">
      {rule.error}
    </div>
  )}
  {!hasError && failed && rule.sample_failing_rows.length > 0 && (
    <SampleRows rows={rule.sample_failing_rows} targetColumn={rule.column ?? undefined} />
  )}
</div>
```

Where:

| State | `borderColor` | `chipClasses` |
|---|---|---|
| `hasError` | `border-l-warning-deep` | `bg-warning/15 text-warning-deep border border-warning/30` |
| `failed` (`!passed && !hasError`) | `border-l-danger-deep` | `bg-danger/15 text-danger-deep border border-danger/30` |
| passed | `border-l-success-deep` | `bg-success/15 text-success-deep border border-success/30` |

### Sample failing rows

Same shape as today, retokenized:

```html
<div class="mt-2 overflow-x-auto">
  <table class="w-full text-xs border-collapse">
    <thead>
      <tr>
        {keys.map(k => (
          <th class="text-left px-2 py-1 text-fg-muted font-medium border-b border-border">{k}</th>
        ))}
      </tr>
    </thead>
    <tbody>
      {rows.slice(0, 3).map((row, i) => (
        <tr class="border-b border-border last:border-0">
          {keys.map(k => (
            <td class="px-2 py-1 text-fg-muted font-mono truncate max-w-[160px]">
              {row[k] === null || row[k] === undefined
                ? <span class="italic text-fg-subtle">null</span>
                : String(row[k])}
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  </table>
</div>
```

Column-selection logic preserved verbatim (target column first, then up to 2 others; max 3 rows).

### AI prose sections (accent-purple cards)

Both `validation_summary` and `anomaly_summary` are AI-generated prose — semantically the same as Profile's AI Summary. Promote both to the accent-purple card pattern.

```html
<div class="bg-accent-purple/15 border border-accent-purple/30 rounded-xl p-4 flex flex-col gap-1.5">
  <div class="text-[10px] font-semibold uppercase tracking-widest text-accent-purple-deep">
    ✦ VALIDATION ANALYSIS
  </div>
  <p class="text-xs text-accent-purple-deep leading-relaxed whitespace-pre-wrap">
    {validation_summary}
  </p>
</div>
```

Same shape for `✦ ANOMALY ANALYSIS`. Each card is hidden when its prose is empty (existing behavior).

---

## What changes vs. today

| Surface | Before | After |
|---|---|---|
| Loading spinner | `border-indigo` | `border-brand-primary` + `role="status"` + `aria-label="Validating"` |
| Loading copy | `text-text-muted/60` second-line hint | dropped (AI panel always visible) |
| Heading | (no header block) | Title + subhead in the established pattern |
| Score wrapper | `bg-surface-raised` | `bg-surface` |
| Mega score text | `text-text` | `text-fg` |
| Score % sign | `text-text-muted` | `text-fg-muted` |
| Baseline subline | `text-text-muted/60` | `text-fg-subtle` |
| `Quality Score` label | `text-text-muted uppercase tracking-wider` (small caps) | `text-xs font-semibold uppercase tracking-wider text-fg-muted` |
| Counts row tokens | `text-success` / `text-red-400` / `text-amber-400` | `text-success-deep` / `text-danger-deep` / `text-warning-deep` |
| `of N rules` suffix | `text-text-muted/60` | `text-fg-subtle` |
| Category pill | `bg-surface-raised text-text-muted` | `bg-elevated text-fg-muted` + value in `text-fg`, padding `px-2 py-0.5 rounded-md` |
| Rule card wrapper | `bg-surface-raised border border-border` | `bg-surface border border-border` |
| Rule card left-border | `border-l-amber-500` / `border-l-red-500` / `border-l-success` | `border-l-warning-deep` / `border-l-danger-deep` / `border-l-success-deep` |
| Rule column name | `text-text` | `text-fg` |
| Rule check | `text-text-muted/70 font-mono` | `text-fg-subtle font-mono` |
| Rule rationale | `text-text-muted/60 leading-snug` | `text-fg-muted leading-snug` |
| Failure-rate label | `text-text-muted/70` | `text-fg-muted` |
| Result chip — PASSED | `bg-success/15 text-success` | `bg-success/15 text-success-deep border border-success/30 text-[11px] font-semibold px-2 py-0.5 rounded-md` |
| Result chip — FAILED · N | `bg-red-500/15 text-red-400` | `bg-danger/15 text-danger-deep border border-danger/30` |
| Result chip — EVAL ERROR | `bg-amber-500/15 text-amber-400` | `bg-warning/15 text-warning-deep border border-warning/30` |
| Eval-error block | `bg-amber-500/10 border-amber-500/30 text-amber-300 font-mono` | `bg-warning/15 border-warning/30 text-warning-deep font-mono` |
| Sample rows header | `text-text-muted/70 border-b border-border/50` | `text-fg-muted border-b border-border` |
| Sample rows body | `text-text-muted` | `text-fg-muted` |
| Sample rows null | `text-text-muted/50 italic` | `text-fg-subtle italic` |
| Validation/Anomaly prose | bordered surface card | accent-purple card (`bg-accent-purple/15 border-accent-purple/30 text-accent-purple-deep`) with `✦` prefix |

---

## Components / file map

```
frontend/
  components/
    stages/
      ValidateStage.tsx                # MODIFY — full rewrite (~180 lines)
  __tests__/
    stages/
      ValidateStage.test.tsx           # NEW — integration tests
```

No internal helpers extracted from the rewrite — `CategoryPill`, `SampleRows`, `RuleCard`, `ProseSection` stay as in-file helpers (same shape as today, retokenized). The file lands ~180 lines (up slightly from 173 because of the new header block and the extra dimension-chip border tokens).

Path alias `@/` resolves to `frontend/`. Tailwind content glob already covers `./components/**/*.tsx` and `./__tests__/**/*.tsx`.

---

## Behavior matrix

| Scenario | Loading | Header card | Rule list | AI prose |
|---|---|---|---|---|
| `per_rule` empty / undefined | visible | hidden | hidden | hidden |
| All passed, no errors | hidden | score / counts / pills | one card per rule | per body |
| Mixed pass + fail | hidden | score / counts / pills | failures first, then passed | per body |
| With eval errors | hidden | score / counts / pills (with `errored` count) | errored first (left-border + chip warning-deep), failures next | per body |
| `category_scores` present | hidden | pills below counts row | normal | normal |
| `category_scores` empty | hidden | pills row hidden | normal | normal |
| `validation_summary` only | hidden | normal | normal | only Validation card |
| `anomaly_summary` only | hidden | normal | normal | only Anomaly card |
| Both prose empty | hidden | normal | normal | both cards hidden |
| `readOnly` snapshot view | per state | per state | per state | per state (prop accepted but unused) |

---

## Testing strategy

Tests mock the session prop and assert on rendered tokens, ordering, and conditional visibility. No API mocks needed — the component is a pure consumer of `session`.

### Assertions (~14)

- Loading: empty `per_rule` renders the brand-primary spinner with `role="status"` and "AI is running validation rules" copy. Header card and rule list are hidden.
- Header: renders title "Validation Results" and the subhead.
- Score header: renders rounded score percentage and the baseline subline only when `current_score !== baseline_quality_score`.
- Counts row: renders correct `X passed · Y failed · Z errored of N rules` per a mixed-result fixture. `errored` span is hidden when zero.
- Category pills: render one per `category_scores` entry, hidden when the map is empty.
- Rule sort: failures + errors are rendered before passed rules (assert by DOM order on rule IDs).
- Failed rule: chip text reads `FAILED · {failure_count}`, classes include `bg-danger/15` and `text-danger-deep`, left-border is `border-l-danger-deep`.
- Errored rule: chip text reads `EVAL ERROR`, classes include `bg-warning/15` and `text-warning-deep`, left-border is `border-l-warning-deep`, error message rendered in the `bg-warning/15` block with `font-mono`.
- Passed rule: chip text reads `PASSED`, classes include `bg-success/15` and `text-success-deep`, left-border is `border-l-success-deep`.
- Sample failing rows: rendered for failed rules with `sample_failing_rows.length > 0`. Hidden for passed and errored rules.
- Sample-row column order: target column first when present.
- Validation Analysis card: renders when `validation_summary` is non-empty, hidden when empty. Class includes `bg-accent-purple/15` and `text-accent-purple-deep`. Label reads `✦ VALIDATION ANALYSIS`.
- Anomaly Analysis card: same shape, label `✦ ANOMALY ANALYSIS`.
- `readOnly` prop accepted without crashing — assert by rendering with `readOnly` true and confirming the rule list still renders.

### Full suite baseline

Going in: 175 passing / 1 failing (the documented `useAIStream` red plus the placeholder `useSessionList` suite).
Expected after Stage 6: ~189 passing / 1 failing (added ~14 ValidateStage assertions).

---

## Open notes

- **`text-{success,warning,danger}-deep` on `*/15` fills contrast** — borderline for WCAG AA 4.5:1 on small text. Deferred to the post-Round-2 a11y mini-stage. When that lands, the chips/cards in this stage all inherit the fix via the token update.
- **AI prose card scrolling** — long Validation Analysis bodies will grow the accent-purple card vertically. The outer page scrolls naturally (`p-6` wrapper + overflow on the workspace shell). Same behavior as Profile's AI summary card.
- **`readOnly` stays as a no-op** — the snapshot mount in `SnapshotStageView` passes it for source-compat; the component accepts it without branching on it. Future actions on this stage (if added) would respect it.
- **No Continue button** — the workflow auto-transitions VALIDATING → TRIAGING. If a future spec adds a human gate (e.g. "review validation results before triage"), the button would land here as a separate change.

---

## Figma reference

To be created in a follow-up phase (same cadence as `upload-modal-v1`):
- Slot: page `02 — Foundation`, position (80, 6700), name `Validate / 1440x900 / Default`.
- Bind colors to foundation variables: `bg-surface=6:3`, `bg-elevated=6:4`, `fg=6:5`, `fg-muted=6:6`, `fg-subtle=6:7`, `border=6:9`, `success=6:11`, `success-deep=21:2`, `warning=6:12`, `warning-deep=21:3`, `danger=6:13`, `danger-deep=21:4`, `accent-purple=29:2`, `accent-purple-deep=29:3`, `brand-primary=5:2`.
