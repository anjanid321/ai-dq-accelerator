# Explore Stage Redesign — Design Spec

**Round / Stage:** Round 2 / Stage 5
**Date:** 2026-05-19
**Predecessors:**
- [`2026-05-14-figma-roundtrip-redesign-design.md`](2026-05-14-figma-roundtrip-redesign-design.md) (foundation)
- [`2026-05-17-rules-stage-redesign.md`](2026-05-17-rules-stage-redesign.md) (Stage 1)
- [`2026-05-18-sessions-list-redesign.md`](2026-05-18-sessions-list-redesign.md) (Stage 2)
- [`2026-05-18-load-stage-and-ai-panel-scroll.md`](2026-05-18-load-stage-and-ai-panel-scroll.md) (Stage 3)
- [`2026-05-19-profile-stage-redesign.md`](2026-05-19-profile-stage-redesign.md) (Stage 4)

**Figma:** `https://www.figma.com/design/gsnW43uSpvdLpwandZM8Zx` — page `02 — Foundation`
- `Explore / 1440x900 / Default` (`147:269`)

---

## Goal

Replace `ExplorationStage.tsx`'s pre-foundation chrome — legacy `text-text-*` tokens, hardcoded indigo for the primary CTA and spinners, `text-warning-light` / `text-danger-light` on tinted backgrounds, an amber-tinted Re-investigate button that competed visually with Approve — with token-driven layout that matches Stages 1–4. Two button-hierarchy changes ride along: Re-investigate becomes a **neutral outlined secondary** (so Approve is unambiguously the primary path), and Approve picks up the established primary-button shape with a lucide `ArrowRight` icon.

No behavior changes. The component still polls for `ExplorationState`, still gates on `notebook_ready`, still surfaces Open Questions and the Constrained Synthesis warning, still embeds the Jupyter notebook iframe with a download link, still exposes the feedback textarea + two actions, still shows a submitted state with a centered spinner.

---

## Out of scope

- Backend / API changes. We still call `getExplorationState`, `getNotebookHtmlUrl`, `getNotebookDownloadUrl`, `submitExplorationFeedback`.
- Polling cadence and notebook iframe behavior. The 3-second poll + iframe load pattern stays.
- The "Round N of 3" limit logic. Existing `(state?.investigation_round ?? 0) >= 2` gate stays.
- WCAG token cleanup. The `text-{warning,info,danger,accent-purple}-deep` tokens have borderline contrast on the 15%-alpha fills — that's a real issue but a single-token-level fix that propagates to every chip across Rules/Sessions/Profile/Explore/AI panel. We're addressing it in the next mini-stage (preview hub + a11y audit) so this stage doesn't muddle scope.
- Constraint warning card visual rework. It's an existing element with a different trigger (`synthesis_constrained`); we retokenize it but don't change its information density.

---

## Background

### Today's Explore stage (218 lines)

`frontend/components/stages/ExplorationStage.tsx` renders, top-to-bottom:

1. **Header** — `Exploration Review` heading + `Round N of 3` chip + descriptive subhead. Legacy `text-text-primary` / `text-text-muted`.
2. **Open Questions card** — `bg-warning/10 border-warning/30` with `text-warning` label + `text-warning-light` body. Numbered list of pending questions for the human.
3. **Constrained Synthesis warning** — `bg-danger/10 border-danger/30` with `text-danger-light` body. Surfaces when `synthesis_constrained === true`.
4. **Notebook iframe** — `border border-border rounded-xl` wrapper, header bar with `EXPLORATION NOTEBOOK` label + `Download .ipynb ↓` link (indigo), 520px-tall iframe.
5. **Loading states** — "Agent is re-investigating your data…" or "Generating exploration notebook…" with an indigo spinner.
6. **Feedback section** — small-caps label + textarea (`focus:border-indigo/50 text-text-primary`).
7. **Action row** — `Re-investigate →` (amber outlined: `border-warning/40 text-warning-light bg-warning/10 hover:bg-warning/20`) + `Approve & Continue →` (`bg-indigo text-white`).
8. **Submitted state** — replaces the whole page with a centered indigo spinner + "Re-investigating…" or "Moving to rule proposal…".
9. **Error banner** — `text-danger-light bg-danger/10 border-danger/30` when feedback submit fails.

Legacy tokens used throughout (`text-text-*`, `border-indigo`, `bg-indigo`, `text-indigo-light`, `*-light` semantic variants).

### Where it's mounted

- `frontend/app/sessions/[id]/page.tsx` — `case 'explore'` (live: AWAITING_INVESTIGATION_REVIEW / REINVESTIGATING / PROFILING_SYNTHESIS).
- `frontend/components/stages/SnapshotStageView.tsx` — historic snapshot view (calls `<ExplorationStage sessionId={sessionId} stage="COMPLETE" readOnly />`).

Signature stays: `function ExplorationStage({ sessionId, stage, readOnly })`.

---

## Design — page composition

The redesigned page renders sections top-to-bottom inside Main (vertical autolayout, padding 20, itemSpacing 16). Order:

```
Header block (title + Round chip + subhead)
Open Questions card             (warning tint, hidden when no open_questions)
Constrained Synthesis warning   (danger tint, hidden when !synthesis_constrained)
Notebook iframe wrapper         (or loading state)
Feedback section                (hidden when readOnly or maxRoundsReached)
Error banner                    (when error, before action row)
Action row                      (right-aligned, hidden when readOnly)
```

The Submitted state replaces the whole page with a centered spinner + status text — same behavior as today, just retokenized.

### Header block

```html
<div class="flex flex-col gap-0.5">
  <div class="flex items-center gap-3">
    <h1 class="text-base font-bold text-fg">Exploration Review</h1>
    <span class="flex-1" />
    <span class="inline-flex items-center px-2 py-0.5 rounded-md bg-elevated border border-border text-[11px] font-semibold text-fg-muted">
      Round {investigation_round + 1} of 3
    </span>
  </div>
  <p class="text-xs text-fg-muted">
    Review the AI's investigation findings before rules are proposed.
    {maxRoundsReached && ' Maximum re-investigation rounds reached — approve to continue.'}
  </p>
</div>
```

Round chip uses the established neutral-chip pattern (elevated bg + border + muted text). Distinguished by font-weight (semibold) and small caps not needed here — it's a count, not a label.

### Open Questions card

Hidden when `state?.open_questions.length === 0` or `state` is null.

```html
<div class="bg-warning/15 border border-warning/30 rounded-xl p-4 flex flex-col gap-2">
  <div class="text-xs font-semibold uppercase tracking-wider text-warning-deep">
    Open Questions — Requires Your Input
  </div>
  <ol class="list-decimal list-inside flex flex-col gap-1">
    {open_questions.map(q => <li class="text-xs text-warning-deep leading-relaxed">{q}</li>)}
  </ol>
</div>
```

Matches the alert chip semantic from Stage 4 (`bg-warning/15` + `text-warning-deep`). Section label follows the established `text-xs font-semibold uppercase tracking-wider` pattern.

### Constrained Synthesis warning

Hidden when `state?.synthesis_constrained !== true`.

```html
<div class="bg-danger/15 border border-danger/30 rounded-xl p-3 flex flex-col gap-1">
  <div class="text-xs font-semibold uppercase tracking-wider text-danger-deep">
    Constrained Synthesis
  </div>
  <p class="text-xs text-danger-deep">
    Rules were proposed despite unresolved uncertainty. The AI summary includes a warning.
  </p>
  {synthesis_constraint_reasons.length > 0 && (
    <ul class="list-disc list-inside flex flex-col gap-0.5">
      {synthesis_constraint_reasons.map(r => <li class="text-xs text-danger-deep">{r}</li>)}
    </ul>
  )}
</div>
```

Same shape as Open Questions but danger-tinted.

### Notebook iframe wrapper

Two states. **Loading** (notebook not ready, or REINVESTIGATING):

```html
<div class="bg-surface border border-border rounded-xl p-6 flex items-center gap-3">
  <div role="status" aria-label="Loading" class="w-4 h-4 border-2 border-brand-primary border-t-transparent rounded-full animate-spin shrink-0" />
  <span class="text-xs text-fg-muted">
    {isReinvestigating ? 'Agent is re-investigating your data…' : 'Generating exploration notebook…'}
  </span>
</div>
```

**Ready**:

```html
<div class="border border-border rounded-xl overflow-hidden h-[520px] flex flex-col">
  <div class="flex items-center bg-elevated px-3 py-2 border-b border-border">
    <span class="text-xs font-semibold uppercase tracking-wider text-fg-muted">Exploration Notebook</span>
    <span class="flex-1" />
    <a href={getNotebookDownloadUrl(sessionId)} download class="inline-flex items-center gap-1 text-[11px] font-medium text-fg-muted hover:text-fg transition-colors">
      <Download size={12} strokeWidth={2} />
      Download .ipynb
    </a>
  </div>
  <iframe
    src={getNotebookHtmlUrl(sessionId)}
    class="flex-1 bg-white"
    style={{ border: 'none' }}
    title="Exploration Notebook"
  />
</div>
```

Lucide `Download` icon (12px) replaces the literal `↓` character. iframe stays the same shape (white background, full width/height of the flex-1 area).

### Feedback section

Hidden when `readOnly === true` OR `notebook_ready !== true` OR `maxRoundsReached === true`. The maxRoundsReached case still renders the action row (Approve only) but skips the textarea — the user has no more chances to re-investigate.

```html
<div class="flex flex-col gap-1.5">
  <label class="text-xs font-semibold uppercase tracking-wider text-fg-muted">
    Request targeted re-investigation (optional)
  </label>
  <textarea
    class="w-full bg-surface border border-border rounded-lg p-2.5 text-xs text-fg resize-none focus:outline-none focus:border-brand-primary placeholder:text-fg-subtle"
    rows={3}
    placeholder={`e.g. "Dig deeper into the relationship between Status and Amount — the cross-column finding seems important"`}
    value={feedback}
    onChange={(e) => setFeedback(e.target.value)}
  />
</div>
```

Token swap throughout: `text-text-primary` → `text-fg`, `text-text-muted` → `text-fg-muted`, `focus:border-indigo/50` → `focus:border-brand-primary`, `placeholder:text-text-muted` → `placeholder:text-fg-subtle` (slightly lower-contrast placeholder feels right).

### Error banner

Hidden when `error === null`.

```html
<div class="bg-danger/15 border border-danger/30 rounded-lg px-3 py-2 text-xs text-danger-deep">
  {error}
</div>
```

Same chip semantic as Stage 4 alerts.

### Action row

Hidden when `readOnly === true` OR `notebook_ready !== true`.

```html
<div class="flex justify-end gap-2">
  {!maxRoundsReached && (
    <button
      type="button"
      onClick={handleRequestReinvestigation}
      disabled={!canRequestReinvestigation || submitting}
      class="inline-flex items-center gap-1.5 bg-surface border border-border text-fg-muted text-[13px] font-semibold px-4 py-2 rounded-md hover:bg-elevated hover:border-fg-muted hover:text-fg disabled:opacity-50 disabled:cursor-not-allowed transition-all"
    >
      <RefreshCw size={14} strokeWidth={2} />
      {submitting ? 'Sending…' : 'Re-investigate'}
    </button>
  )}
  <button
    type="button"
    onClick={handleApprove}
    disabled={submitting}
    class="inline-flex items-center gap-1.5 bg-brand-accent text-on-brand text-[13px] font-semibold px-4 py-2 rounded-md hover:bg-brand-accent/90 hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed transition-all"
  >
    {submitting ? 'Approving…' : 'Approve & Continue'}
    <ArrowRight size={14} strokeWidth={2} />
  </button>
</div>
```

- **Re-investigate** = neutral secondary (`bg-surface` + `border-border` + `text-fg-muted`, with hover that adds the `fg-muted` border + `fg` text + `elevated` bg). Lucide `RefreshCw` icon on the left. Disabled state honors `!feedback.trim()`.
- **Approve & Continue** = primary navy (the established primary-button class from Stages 2–4). Lucide `ArrowRight` icon on the right. Disabled while submitting.

When `maxRoundsReached`, only the Approve button renders (feedback section hidden in the markup above).

### Submitted state

Replaces the whole page when `submitted === true`. Centered, brand-primary spinner (matches Load + Profile loading patterns).

```html
<div class="p-5 flex flex-col items-center justify-center h-full gap-3">
  <div role="status" aria-label="Submitting" class="w-10 h-10 border-2 border-brand-primary border-t-transparent rounded-full animate-spin" />
  <p class="text-sm text-fg-muted">
    {isReinvestigating ? 'Re-investigating…' : 'Moving to rule proposal…'}
  </p>
</div>
```

The current `isReinvestigating` derivation stays: `stage === 'REINVESTIGATING' || stage === 'PROFILING_SYNTHESIS'`.

---

## What changes vs. today

| Surface | Before | After |
|---|---|---|
| Heading wrapper | `text-text-primary` | `text-fg` |
| Subhead | `text-text-muted` | `text-fg-muted` |
| Round chip | `text-[10px] text-text-muted bg-surface border border-border px-2 py-0.5 rounded` | `text-[11px] font-semibold text-fg-muted bg-elevated border border-border px-2 py-0.5 rounded-md` |
| Section labels | `text-[10px] uppercase tracking-widest text-{warning,text-muted}` | `text-xs font-semibold uppercase tracking-wider text-{warning-deep,fg-muted,danger-deep}` |
| Open Questions card | `bg-warning/10 border-warning/30 text-warning-light` | `bg-warning/15 border-warning/30 text-warning-deep` |
| Constraint warning | `bg-danger/10 border-danger/30 text-danger-light` | `bg-danger/15 border-danger/30 text-danger-deep` |
| Loading spinner | `border-indigo` | `border-brand-primary` |
| Notebook download link | indigo text + literal `↓` | muted-fg link + lucide `Download` icon |
| Textarea focus | `focus:border-indigo/50` | `focus:border-brand-primary` |
| Textarea text | `text-text-primary placeholder:text-text-muted` | `text-fg placeholder:text-fg-subtle` |
| Re-investigate button | amber outlined (`border-warning/40 text-warning-light bg-warning/10`) | neutral secondary (`bg-surface border-border text-fg-muted` + hover state) + lucide `RefreshCw` |
| Approve button | `bg-indigo text-white text-sm` + literal `→` | primary-button class (`bg-brand-accent text-on-brand …`) + lucide `ArrowRight` |
| Submitted spinner | `border-indigo` | `border-brand-primary` |
| Error banner | `text-danger-light bg-danger/10` | `text-danger-deep bg-danger/15` |

---

## Components / file map

```
frontend/
  components/
    stages/
      ExplorationStage.tsx           # MODIFY — full rewrite
  __tests__/
    stages/
      ExplorationStage.test.tsx      # NEW
```

No internal helpers extracted — the existing component has clear sub-blocks but each is small enough that splitting them out adds friction without payoff. If a future change makes one of them grow (e.g. the notebook wrapper gains preview thumbnails) we revisit.

Path alias `@/` resolves to `frontend/`. Tailwind content glob already covers `./components/**/*.tsx`.

---

## Behavior matrix

| Scenario | Open Q | Constraint | Notebook | Feedback | Re-invest btn | Approve btn |
|---|---|---|---|---|---|---|
| Live, no state yet | — | — | loading | hidden | hidden | hidden |
| Live, REINVESTIGATING | — | — | loading ("Agent is re-investigating…") | hidden | hidden | hidden |
| Live, notebook ready, open Q present, can re-investigate | visible | hidden | iframe | visible | visible (enabled when feedback non-empty) | visible |
| Live, notebook ready, no open Q | hidden | hidden | iframe | visible | visible (disabled when feedback empty) | visible |
| Live, notebook ready, max rounds reached | maybe | maybe | iframe | hidden | hidden | visible |
| Live, synthesis_constrained | maybe | visible | iframe | visible | visible | visible |
| Snapshot view (`readOnly`) | maybe | maybe | iframe | hidden | hidden | hidden |
| Submitted (post-Approve) | — | — | — | — | — | — (full-page spinner) |
| Submitted (post-Re-investigate) | — | — | — | — | — | — (full-page spinner) |
| Error after submit | per state | per state | per state | per state | per state + banner above row | per state |

---

## Testing strategy

### `ExplorationStage` (integration)

`useEffect` polling makes this trickier than Profile. Tests mock `@/lib/api` so `getExplorationState` is a `jest.fn().mockResolvedValue(...)`. Each `it` block sets the mock once and renders; we don't need to wait for the polling interval to elapse — the initial `load()` call is sufficient.

- Renders the loading notebook card with `border-brand-primary` spinner when `notebook_ready === false`.
- Renders the iframe wrapper with the Download link when `notebook_ready === true`.
- Renders the Open Questions card when `open_questions.length > 0`, hides it when 0.
- Renders the Constraint warning when `synthesis_constrained === true`, hides it when false.
- Renders the Round chip with the correct `Round N of 3` value (`investigation_round + 1`).
- When `maxRoundsReached` (`investigation_round >= 2`), the feedback section + Re-investigate button are hidden, Approve stays.
- When `readOnly`, the feedback section + both buttons are hidden.
- Re-investigate button is disabled when feedback is empty.
- Re-investigate button is enabled when feedback has trimmed content.
- Clicking Approve calls `submitExplorationFeedback(sessionId, true)`.
- Clicking Re-investigate with feedback calls `submitExplorationFeedback(sessionId, false, feedback.trim())`.
- After a successful submit, the page swaps to the submitted state (centered spinner + status copy).
- Error banner renders when `submitExplorationFeedback` rejects.
- Submitted state uses the `Re-investigating…` copy when `stage === 'REINVESTIGATING'`, `Moving to rule proposal…` otherwise.

### Full suite baseline

Going in: 139 passing / 1 failing (the documented `useAIStream` red).
Expected after Stage 5: ~150–155 passing / 1 failing. Tests added: ~14.

---

## Component boundaries

- **`<ExplorationStage sessionId, stage, readOnly />`** — owns polling, submit state, feedback state, and the section layout. No new sub-components introduced.

The component is ~150 lines after the rewrite (down from 218). The major savings come from dropping the inline indigo hex colors and the long warning-tinted button class strings.

---

## Open notes

- **`text-warning-deep` on `bg-warning/15` contrast** — borderline for WCAG AA 4.5:1 on small text. Deferred to the post-Stage-5 a11y mini-stage (see task #20 in TaskList). When that lands, the chips/cards in Profile, Sessions, Rules, and this Explore stage all inherit the fix via the token update.
- **Stale closure on `state?.notebook_ready` in the poll effect** — the existing component has a subtle bug where the polling interval doesn't always cancel cleanly. The rewrite preserves the existing behavior verbatim; fixing the closure is out of scope. If it becomes a real problem we open a separate task.
- **Constraint warning copy** — verbatim from today's component. If the agent's behavior changes the wording should match.
- **Notebook iframe height** — kept at 520px (the existing fixed height). On larger viewports the surrounding workspace pane scrolls naturally.

---

## Figma reference

- `147:269` — Explore / 1440x900 / Default — full populated state with Open Questions card, notebook mock, feedback textarea, both action buttons, and the AI panel "Awaiting your approval" banner. Stepper shows Load + Profile completed, Explore active.

Stacked at `(80, 5100)` on page `02 — Foundation`.
