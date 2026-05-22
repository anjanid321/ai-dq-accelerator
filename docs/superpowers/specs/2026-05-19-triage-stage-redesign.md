# Triage Stage Redesign — Design Spec

**Round / Stage:** Round 2 / Stage 7
**Date:** 2026-05-19
**Predecessors:**
- [`2026-05-14-figma-roundtrip-redesign-design.md`](2026-05-14-figma-roundtrip-redesign-design.md) (foundation)
- [`2026-05-17-rules-stage-redesign.md`](2026-05-17-rules-stage-redesign.md) (Stage 1)
- [`2026-05-18-sessions-list-redesign.md`](2026-05-18-sessions-list-redesign.md) (Stage 2)
- [`2026-05-18-load-stage-and-ai-panel-scroll.md`](2026-05-18-load-stage-and-ai-panel-scroll.md) (Stage 3)
- [`2026-05-19-profile-stage-redesign.md`](2026-05-19-profile-stage-redesign.md) (Stage 4)
- [`2026-05-19-explore-stage-redesign.md`](2026-05-19-explore-stage-redesign.md) (Stage 5)
- [`2026-05-19-validate-stage-redesign.md`](2026-05-19-validate-stage-redesign.md) (Stage 6)
- [`2026-05-19-chip-system-design.md`](2026-05-19-chip-system-design.md) (chip system)

**Figma:** mirror to a new frame on page `02 — Foundation` at slot (80, 7700) after the code lands — separate phase, same cadence as Validate / Upload Modal.

---

## Goal

Replace `TriageStage.tsx`'s pre-foundation chrome — `text-text-*` tokens, `bg-surface-raised`, `bg-indigo` filter tabs, hex Tailwind colors (`bg-red-500/*`, `bg-amber-500/*`, `text-red-400`, `text-amber-400`), `border-l-{class}/60` single-side card accents, and the legacy submit button — with token-driven layout that matches Stages 1–6 and the `chip-system-v1` vocabulary. Upgrade the rule-card chrome to match the Rules-stage approved/denied pattern: full border + soft ring keyed to the decision state (Accept → success outline+ring, Keep → danger outline+ring, Pending → neutral border-border).

No behavior changes. The component still reads from `session.triage_result`, still tracks per-card decisions in local state, still gates the submit on every actionable card being decided, still calls `approveTriage` on submit with the same payload shape, still filters by All / Needs Decision / Fixable / Unfixable.

---

## Out of scope

- Backend / API changes. The `approveTriage` signature stays the same.
- Layout reworks. No stats grid for the summary, no chip-row replacement of the filter tabs (the tabs stay as buttons in the existing horizontal row), no collapsible sections. Same vertical flow as today: summary → tabs → cards → sticky submit.
- Removing the confidence text. It stays as inline text (`text-success-deep` / `text-warning-deep` / `text-fg-muted`) — not promoted to a chip.
- WCAG token cleanup. Already landed in `chip-system-v1`.
- `/demo` wiring. Separate phase after the stage ships.
- Figma frame. Separate phase after the stage ships (same cadence as Validate / Upload Modal).

---

## Background

### Today's Triage stage (280 lines)

`frontend/components/stages/TriageStage.tsx` renders, top-to-bottom:

1. **Loading state** — when `stage === 'TRIAGING'` or `triage_result` is missing: indigo spinner + "AI is investigating failing rules…" + a muted hint about the AI panel.
2. **Summary card** — `bg-surface-raised border border-border rounded-xl p-4` with "Triage Summary" small-caps label and a colored-dot row (transform_fixable / threshold_too_strict / unfixable / eval_error), dots at 60% alpha.
3. **Filter tabs** — All / Needs Decision / Fixable / Unfixable. Active uses `bg-indigo/20 text-indigo-300 border-indigo/40`; inactive uses `bg-surface border-border text-text-muted hover:border-indigo/30`.
4. **Triage cards** — one `TriageCard` per `classification`, each with:
   - Left-side accent (`border-l-2 border-l-{class}/60`) keyed to the classification (success / warning / red-500 / amber-500).
   - `ClassificationBadge` — `rounded-full font-mono` pill with the classification literal (`transform_fixable` / etc.) on a `bg-{class}/20 text-{class}-light` background.
   - rule_id + check + column in `font-mono text-text-muted/70`.
   - `ConfidenceBadge` — inline "confidence: high/medium/low" text in `text-success-light` / `text-warning` / `text-text-muted`.
   - Reason paragraph in `text-text-muted leading-relaxed`.
   - Proposed action line (only when actionable): "Proposed: raise threshold to X%" with the number in `text-warning`, or "Proposed: remove rule" in `text-red-400`.
   - Decision buttons (Accept + Keep) using `bg-{tone}/20 + text-{tone} + border-{tone}/40` for active, plain hover for inactive.
   - For `transform_fixable`: "(no decision required)" italic note instead of buttons.
5. **Sticky submit bar** — `bg-elevated border border-border rounded-xl p-4 shadow-lg` at sticky bottom-4. Status text on the left ("N rules need a decision" with N in `text-warning font-semibold`, or "All decisions made"); "Apply Triage Decisions →" button on the right in `bg-indigo text-white`.
6. **Error banner** — below the submit bar: `bg-red-500/10 border-red-500/30 text-red-400`.

Legacy tokens used throughout (`text-text-*`, `bg-surface-raised`, hex Tailwind colors, indigo accent on filter tabs and submit button).

### Where it's mounted

- `frontend/app/sessions/[id]/page.tsx` — `case 'triage'` (live: TRIAGING / AWAITING_TRIAGE_APPROVAL).
- `frontend/components/stages/SnapshotStageView.tsx` — historic snapshot view (calls `<TriageStage session={fakeSession} readOnly />`).

Signature stays: `function TriageStage({ session, readOnly }: Props)`.

---

## Design — page composition

The redesigned page renders sections top-to-bottom inside Main (`p-6 flex flex-col gap-6 max-w-3xl mx-auto`). Order:

```
Loading state           (full-page early return when stage=TRIAGING or no triage_result)
Header block            (title + subhead)
Summary card            (colored-dot counts row)
Filter tabs             (4 buttons: All / Needs Decision / Fixable / Unfixable)
Triage cards            (one per classification, sorted needs-decision first)
Error banner            (when submit fails)
Sticky submit bar       (when actionable cards exist and not readOnly)
```

### Loading state

```html
<div class="p-6 max-w-3xl mx-auto">
  <div class="bg-surface border border-border rounded-xl p-6 flex items-center gap-3">
    <div role="status" aria-label="Triaging"
         class="w-4 h-4 border-2 border-brand-primary border-t-transparent rounded-full animate-spin shrink-0" />
    <span class="text-xs text-fg-muted">
      AI is investigating failing rules…
    </span>
  </div>
</div>
```

Brand-primary spinner ring with `role="status"` + `aria-label="Triaging"`. Matches Load / Profile / Explore / Validate loading patterns. The redundant "AI panel shows live progress" hint is dropped.

### Header block

```html
<div class="flex flex-col gap-0.5">
  <h1 class="text-base font-bold text-fg">Triage Results</h1>
  <p class="text-xs text-fg-muted">
    Review the AI's classification of every failing rule and decide what to do with each.
  </p>
</div>
```

### Summary card

Keep the existing visual treatment — colored-dot list — fully retokenized. Title Case the counts.

```html
<div class="bg-surface border border-border rounded-xl p-4 flex flex-col gap-3">
  <div class="text-xs font-semibold uppercase tracking-wider text-fg-muted">Triage Summary</div>
  <div class="flex flex-wrap gap-4">
    {summary.transform_fixable > 0 && (
      <span class="flex items-center gap-1.5 text-sm">
        <span class="w-2 h-2 rounded-full bg-success shrink-0" />
        <span class="text-fg-muted">{summary.transform_fixable} Transform Fixable</span>
      </span>
    )}
    {summary.threshold_too_strict > 0 && (
      <span class="flex items-center gap-1.5 text-sm">
        <span class="w-2 h-2 rounded-full bg-warning shrink-0" />
        <span class="text-fg-muted">{summary.threshold_too_strict} Threshold Too Strict</span>
      </span>
    )}
    {summary.unfixable > 0 && (
      <span class="flex items-center gap-1.5 text-sm">
        <span class="w-2 h-2 rounded-full bg-danger shrink-0" />
        <span class="text-fg-muted">{summary.unfixable} Unfixable</span>
      </span>
    )}
    {summary.eval_error > 0 && (
      <span class="flex items-center gap-1.5 text-sm">
        <span class="w-2 h-2 rounded-full bg-warning shrink-0" />
        <span class="text-fg-muted">{summary.eval_error} Eval Error</span>
      </span>
    )}
  </div>
</div>
```

Dots move from 60% alpha to full token color for visibility. Each category entry hides when count is zero.

### Filter tabs

Compact secondary buttons in a horizontal row. Active uses the brand-primary fill; inactive uses neutral elevated chrome.

```html
<div class="flex gap-1.5">
  {(['all', 'needs_decision', 'fixable', 'unfixable'] as FilterMode[]).map(f => (
    <button
      key={f}
      onClick={() => setFilter(f)}
      class={
        filter === f
          ? 'inline-flex items-center bg-brand-primary text-on-brand text-[11px] font-semibold px-2.5 py-1 rounded-md transition-colors'
          : 'inline-flex items-center bg-surface border border-border text-fg-muted text-[11px] font-semibold px-2.5 py-1 rounded-md hover:bg-elevated hover:border-fg-muted hover:text-fg transition-colors'
      }
    >
      {f === 'all' ? 'All' : f === 'needs_decision' ? 'Needs Decision' : f === 'fixable' ? 'Fixable' : 'Unfixable / Error'}
    </button>
  ))}
</div>
```

Title Cased labels. "Unfixable/Error" gets the space added for consistency with the rest of the chip system Title Case convention.

### Triage card

Decision-driven card chrome (Rules-stage pattern). Per-decision class strings:

| Decision | Card chrome |
|---|---|
| `pending` (or `transform_fixable` no-decision-required) | `border-border` (no ring) |
| `accept` | `border-success ring-1 ring-success/40` |
| `keep` | `border-danger ring-1 ring-danger/40` |

Drop the left-side colored accent. The chip on the top-left of the card still carries the classification signal; the chrome carries the decision signal.

```html
<div class={`bg-surface border rounded-lg p-4 ${cardChrome}`}>
  {/* Top row */}
  <div class="flex items-start justify-between gap-3 mb-2">
    <div class="flex flex-wrap items-center gap-2">
      <Chip variant="status" tone={classificationTone}>
        {classificationLabel}
      </Chip>
      <span class="text-sm font-semibold text-fg font-mono">{item.rule_id}</span>
      {item.check && <span class="text-xs text-fg-subtle font-mono">· {item.check}</span>}
      {item.column && <span class="text-xs text-fg-subtle font-mono">· {item.column}</span>}
    </div>
    <span class={`text-xs ${confidenceColor}`}>confidence: {item.confidence}</span>
  </div>

  {/* Reason */}
  <p class="text-sm text-fg-muted leading-relaxed mb-3">{item.reason}</p>

  {/* Proposed action — only on actionable classifications */}
  {needsDecision && (
    <>
      {item.classification === 'threshold_too_strict' && item.proposed_threshold !== undefined && (
        <div class="text-xs text-fg-muted mb-2">
          Proposed: raise threshold to{' '}
          <span class="font-semibold text-warning-deep">
            {(item.proposed_threshold * 100).toFixed(2)}%
          </span>
        </div>
      )}
      {(item.classification === 'unfixable' || item.classification === 'eval_error') && item.proposed_remove && (
        <div class="text-xs text-fg-muted mb-2">
          Proposed: <span class="font-semibold text-danger-deep">remove rule</span>
        </div>
      )}
    </>
  )}

  {/* Decision buttons */}
  {needsDecision && !readOnly && (
    <div class="flex gap-2">
      <button
        onClick={() => onDecide(item.rule_id, decision === 'accept' ? 'pending' : 'accept')}
        class={
          decision === 'accept'
            ? 'inline-flex items-center gap-1.5 bg-success-deep border border-success-deep text-on-brand text-[13px] font-semibold px-3 py-1.5 rounded-md transition-colors'
            : 'inline-flex items-center gap-1.5 bg-surface border border-success text-success-deep text-[13px] font-semibold px-3 py-1.5 rounded-md hover:bg-success/10 transition-colors'
        }
      >
        <Check size={14} strokeWidth={2} />
        {item.classification === 'threshold_too_strict' ? 'Accept Change' : 'Accept Removal'}
      </button>
      <button
        onClick={() => onDecide(item.rule_id, decision === 'keep' ? 'pending' : 'keep')}
        class={
          decision === 'keep'
            ? 'inline-flex items-center gap-1.5 bg-danger-deep border border-danger-deep text-on-brand text-[13px] font-semibold px-3 py-1.5 rounded-md transition-colors'
            : 'inline-flex items-center gap-1.5 bg-surface border border-danger text-danger-deep text-[13px] font-semibold px-3 py-1.5 rounded-md hover:bg-danger/10 transition-colors'
        }
      >
        <X size={14} strokeWidth={2} />
        {item.classification === 'threshold_too_strict' ? 'Keep Original' : 'Keep Rule'}
      </button>
    </div>
  )}

  {/* No-decision-required note */}
  {!needsDecision && (
    <div class="text-xs text-fg-subtle italic">(no decision required)</div>
  )}
</div>
```

**Classification → Chip tone + label mapping:**

| `classification` | Chip tone | Title Case label |
|---|---|---|
| `transform_fixable` | `success` | Transform Fixable |
| `threshold_too_strict` | `warning` | Threshold Too Strict |
| `unfixable` | `danger` | Unfixable |
| `eval_error` | `warning` | Eval Error |

**Confidence → color mapping:**

| `confidence` | Color |
|---|---|
| `high` | `text-success-deep` |
| `medium` | `text-warning-deep` |
| `low` | `text-fg-muted` |

Lucide icons (`Check` + `X`) replace the literal `✓` and `✗` glyphs on decision buttons. Matches Rules-stage decision button vocabulary.

### Error banner

Hidden when no error. Standard dimension-chip danger pattern.

```html
<div class="bg-danger/15 border border-danger/30 rounded-lg px-3 py-2 text-xs text-danger-deep">
  {error}
</div>
```

### Sticky submit bar

Shown only when there are cards that need a decision and not in readOnly mode.

```html
<div class="sticky bottom-4">
  <div class="bg-elevated border border-border rounded-xl p-4 flex items-center justify-between gap-4 shadow-lg">
    <div class="text-sm text-fg-muted">
      {canSubmit
        ? 'All decisions made — ready to proceed.'
        : (
            <>
              <span class="text-warning-deep font-semibold">{pendingCount}</span>{' '}
              {pendingCount === 1 ? 'rule needs' : 'rules need'} a decision.
            </>
          )}
    </div>
    <button
      onClick={handleSubmit}
      disabled={!canSubmit || submitting}
      class="inline-flex items-center gap-1.5 bg-brand-accent text-on-brand text-[13px] font-semibold px-4 py-2 rounded-md hover:bg-brand-accent/90 hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed transition-all"
    >
      {submitting ? 'Submitting…' : 'Apply Triage Decisions'}
      {!submitting && <ArrowRight size={14} strokeWidth={2} />}
    </button>
  </div>
  {error && <ErrorBanner />}
</div>
```

Primary navy button matches the established `bg-brand-accent + text-on-brand` shape with lucide `ArrowRight`. Pending count highlights in `text-warning-deep font-semibold`.

---

## What changes vs. today

| Surface | Before | After |
|---|---|---|
| Loading spinner | `border-indigo` | `border-brand-primary` + `role="status"` + `aria-label="Triaging"` |
| Loading copy | `text-text-muted/60` second-line hint | dropped |
| Heading | (no header block) | Title + subhead in the established pattern |
| Summary wrapper | `bg-surface-raised` | `bg-surface` |
| Summary section label | `text-xs text-text-muted uppercase tracking-wider` | `text-xs font-semibold uppercase tracking-wider text-fg-muted` |
| Summary count text | `text-text-muted`, lower-snake-case ("transform-fixable") | `text-fg-muted`, Title Case ("Transform Fixable") |
| Summary dots | `bg-{tone}/60` | `bg-{tone}` (full alpha for visibility) |
| Eval error dot | `bg-amber-500/60` | `bg-warning` (single-token, no hex) |
| Unfixable dot | `bg-red-500/60` | `bg-danger` |
| Filter tab — active | `bg-indigo/20 text-indigo-300 border border-indigo/40` | `bg-brand-primary text-on-brand` (no border) |
| Filter tab — inactive | `bg-surface border border-border text-text-muted hover:border-indigo/30` | `bg-surface border border-border text-fg-muted hover:bg-elevated hover:border-fg-muted hover:text-fg` |
| Card wrapper | `bg-surface-raised border border-border + border-l-2 border-l-{class}/60` | `bg-surface border + decision-driven outline (border-{tone} ring-1 ring-{tone}/40 when decided, border-border when pending)` |
| Classification badge | `rounded-full font-mono bg-{class}/20 text-{class}-light` (or hex for unfixable/eval-error) | `<Chip variant="status" tone={...}>` with Title Case label |
| Rule id | `text-text font-mono` | `text-fg font-mono` |
| Check + column | `text-text-muted/70 font-mono` | `text-fg-subtle font-mono` |
| Confidence text | `text-success-light` / `text-warning` / `text-text-muted` | `text-success-deep` / `text-warning-deep` / `text-fg-muted` |
| Reason | `text-text-muted` | `text-fg-muted` |
| Proposed action — threshold value | `text-warning` | `text-warning-deep` |
| Proposed action — "remove rule" | `text-red-400` | `text-danger-deep` |
| Decision button — Accept active | `bg-success/20 text-success border-success/40` | `bg-success-deep border-success-deep text-on-brand` (Rules pattern) |
| Decision button — Accept inactive | `bg-surface border-border hover:border-success/40` | `bg-surface border-success text-success-deep hover:bg-success/10` |
| Decision button — Keep active | `bg-red-500/20 text-red-400 border-red-500/40` | `bg-danger-deep border-danger-deep text-on-brand` |
| Decision button — Keep inactive | `bg-surface border-border hover:border-red-500/40` | `bg-surface border-danger text-danger-deep hover:bg-danger/10` |
| Decision icons | literal `✓` / `✗` | lucide `Check` / `X` |
| No-decision-required note | `text-text-muted/50 italic` | `text-fg-subtle italic` |
| Submit wrapper | `bg-elevated border border-border rounded-xl shadow-lg` | unchanged (already token-clean) |
| Submit status text — pending count | `text-warning font-semibold` | `text-warning-deep font-semibold` |
| Submit button | `bg-indigo text-white` + literal `→` | primary navy button class + lucide `ArrowRight` |
| Error banner | `bg-red-500/10 border-red-500/30 text-red-400` | `bg-danger/15 border-danger/30 text-danger-deep` |

---

## Components / file map

```
frontend/
  components/
    stages/
      TriageStage.tsx                  # MODIFY — full rewrite (~250 lines)
  __tests__/
    stages/
      TriageStage.test.tsx             # NEW — integration tests
```

No internal helpers extracted from the rewrite — `ClassificationBadge`, `ConfidenceBadge`, `TriageCard` stay as in-file helpers (same call as Validate / Explore). File lands ~250 lines (down from 280 because of the chip primitive consolidation).

Path alias `@/` resolves to `frontend/`. Tailwind content glob already covers `./components/**/*.tsx` and `./__tests__/**/*.tsx`.

---

## Behavior matrix

| Scenario | Loading | Summary | Tabs | Cards | Submit |
|---|---|---|---|---|---|
| `stage === 'TRIAGING'` | visible | hidden | hidden | hidden | hidden |
| `triage_result === undefined` | visible | hidden | hidden | hidden | hidden |
| Awaiting decisions, all classifications present | hidden | counts shown | all 4 visible | sorted: needs-decision first | "N rules need a decision" |
| Some categories empty | hidden | only non-zero rows | per state | per state | per state |
| All actionable cards decided | hidden | normal | normal | each card shows decision chrome (success/danger outline+ring) | "All decisions made" + button enabled |
| Submit success | (the stage transitions to PLANNING, parent unmounts) | — | — | — | — |
| Submit error | hidden | normal | normal | normal | error banner under submit bar |
| `readOnly` (snapshot view) | per state | per state | per state | card buttons hidden, "(no decision required)" note hidden | submit bar hidden |
| `transform_fixable`-only result | hidden | only "Transform Fixable" entry | all 4 visible | one card with "(no decision required)" note | submit bar hidden (no actionable cards) |
| `filter === 'fixable'` | hidden | normal | active state on Fixable button | only `transform_fixable` cards | submit bar still shows if non-fixable cards exist anywhere |

---

## Testing strategy

Tests assert on rendered tokens, ordering, conditional visibility, and decision-state interactions. No API mocks needed for render tests; `approveTriage` is mocked for the submit-path test.

### Assertions (~16)

- Loading state: `stage='TRIAGING'` renders the brand-primary spinner with `role="status"` and "investigating failing rules" copy. Summary card and cards hidden.
- Loading state: `triage_result` undefined renders the loading state too.
- Header: renders title "Triage Results" and the subhead.
- Summary card: renders only categories with count > 0. Hides zero-count categories.
- Summary card: dots use full-alpha foundation tokens (`bg-success` / `bg-warning` / `bg-danger`).
- Filter tabs: clicking `Needs Decision` filters out `transform_fixable` cards. Clicking back to `All` restores them.
- Filter tabs: active button uses `bg-brand-primary text-on-brand` classes.
- Classification chip: `transform_fixable` renders with success tone + Title Case label "Transform Fixable".
- Classification chip: `unfixable` renders with danger tone + label "Unfixable".
- Classification chip: `eval_error` renders with warning tone + label "Eval Error".
- TriageCard for `transform_fixable` renders "(no decision required)" italic note, NO Accept/Keep buttons.
- TriageCard for `threshold_too_strict` renders the Proposed line with threshold % in `text-warning-deep`.
- TriageCard for `unfixable` renders the Proposed line with "remove rule" in `text-danger-deep`.
- Clicking Accept toggles the card outline to `border-success ring-1 ring-success/40` and the Accept button to its active deep-fill state.
- Clicking Keep toggles to `border-danger ring-1 ring-danger/40` and the Keep button to active.
- Clicking active Accept again returns the card to pending (no ring, no border-tone).
- Submit bar shows "N rules need a decision" with N in `text-warning-deep font-semibold` when pending.
- Submit bar shows "All decisions made — ready to proceed." when all decided.
- Submit button disabled when not all decided; enabled when all decided.
- Clicking submit calls `approveTriage` with the expected payload (accepted threshold changes + rejected rule IDs).
- `readOnly` hides the decision buttons and the submit bar.
- Error banner renders with dimension-chip danger tokens when `approveTriage` rejects.

### Full suite baseline

Going in: 206 passing / 1 failing (the documented `useAIStream` red).
Expected after Stage 7: ~222 passing / 1 failing (added ~16 TriageStage assertions).

---

## Open notes

- **`text-{success,warning,danger}-deep` contrast** — already fixed in `chip-system-v1`. No further work.
- **Decision buttons use solid Rules-pattern fill (`bg-{tone}-deep`) when active.** That's a clear visual signal — a darker bar of color. Comparable to the Rules approved/denied buttons.
- **`eval_error` tone choice** — split off from danger to warning. Rationale: an eval_error is a technical issue ("we couldn't run this rule"), not a quality verdict on the data. Warning (amber) reads as "needs attention" without implying the rule is bad. The proposed action ("remove rule") still gets `text-danger-deep` because removal IS a destructive action.
- **Filter tab active state uses brand-primary (orange)** rather than brand-accent (navy) to differentiate from the primary CTA. Same pattern Rules stage uses for category filter tabs.
- **No Continue button on the page** — submit IS the continue gate. After submit, the workflow auto-transitions PLANNING → AWAITING_PLAN_APPROVAL and the parent unmounts this stage.

---

## Figma reference

To be created in a follow-up phase (same cadence as Validate / Upload Modal):
- Slot: page `02 — Foundation`, position (80, 7700), name `Triage / 1440x900 / Default`.
- Bind colors to foundation variables: `bg-surface=6:3`, `bg-elevated=6:4`, `fg=6:5`, `fg-muted=6:6`, `fg-subtle=6:7`, `border=6:9`, `success=6:11`, `success-deep=21:2`, `warning=6:12`, `warning-deep=21:3`, `danger=6:13`, `danger-deep=21:4`, `brand-primary=5:2`, `brand-accent=5:3`, `on-brand=5:4`.
