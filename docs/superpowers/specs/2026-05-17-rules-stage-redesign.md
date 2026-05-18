# Rules Stage Redesign — Design Spec (Round 2, Stage 1)

**Date:** 2026-05-17 · **Status:** Draft for user review · **Stage:** Rules (`/sessions/<id>` with `stage = rules`)

## Purpose

Bring the Rules stage in line with the design system established in Round 1 (foundation-v1) and fix six usability issues raised during round-2 brainstorm:

1. Dimension tags (Validity, Completeness, etc.) should be accessible and consistent with the new token system; today they use old `cyan`, `indigo`, `purple` aliases with poor contrast.
2. Users want to multi-select rules and apply Approve / Deny to the selection.
3. Edit must be visually and spatially separate from the decision buttons — it modifies the rule, it doesn't decide on it.
4. All buttons in the stage use word + icon (today the decision buttons are icon-only when undecided).
5. The "Submit Decisions" CTA must follow the new primary button style (`brand-accent` fill, `on-brand` text).
6. Decisions must be reversible — clicking the active button again returns the rule to undecided.

## Non-goals

- Restructuring the underlying rule data shape or the `approveRules` API contract. The redesign is purely presentation + interaction.
- Adding new dimension types beyond what the system already emits (validity, completeness, uniqueness, consistency).
- Changing the inline rule editor's input fields. The editor's chrome is retokenized but its structure (Min/Max/Pattern/Values/SodaCL) is unchanged.
- Round 2 work for any other stage. Each stage gets its own spec when we reach it.

## Two interaction modes

The stage has two top-level interaction modes.

### Default mode (per-row)

Layout from top to bottom:

- **Header**: "Rule Approval" (text-base font-bold), subtitle ("Approve, deny, or edit each AI-proposed rule.") in `text-fg-muted` 12px.
- **Filter pills** — one per dimension plus "All". Active filter uses the new chip pattern (`bg-surface` + `border-brand-primary` + `text-fg` semibold); inactive uses `border-border-strong` + `text-fg-muted`. Counts are inline: "Validity (8)".
- **Toolbar actions** (right-aligned on the same row as filters when space allows; wraps below on narrow widths): `Select` button (neutral pill, ⌧ icon), `Approve all` button (success pill).
- **Rule cards** stacked vertically with 8px gap.
- **Sticky footer** at the bottom with the running tally and `Submit decisions` CTA.

Each rule card is a `bg-surface` panel, `rounded-lg`, `border border-border-subtle`, 16px padding. Its visual state reflects the per-rule decision:

- **Undecided**: default chrome, no extra emphasis.
- **Approved**: `border-success` + 1px `ring-success/40` ring; otherwise unchanged.
- **Denied**: `border-danger` + 1px `ring-danger/40` ring; card content reduces to `opacity-70`.
- **Editing**: `border-fg-default` + ring; card body expands to include the inline editor.

Card content layout:

```
[Dimension chip]  rule.check                    [✓ Approve] [✗ Deny]
column: customer_email · check: regex
Rationale text (11px, fg-muted, italic, leading-relaxed)

                                                              [✎ Edit]
```

The `Approve` and `Deny` buttons sit at the top-right of the card on the same row as the dimension chip and `check`. The `Edit` button sits at the card's bottom-right, on its own row. Clicking Edit expands the inline editor between the meta line and the Edit button; the Edit button label changes to "Editing" and its style flips per the spec in Section 4 below.

### Selection mode

Triggered by the toolbar's `Select` button. The toolbar action toggles label to `Done selecting`. While in selection mode:

- Each rule card gains a checkbox in a 24px-wide column at its left edge.
- The per-row `Approve` / `Deny` buttons are hidden. The Edit button stays — editing a single rule mid-bulk is still useful.
- A sticky **bulk action bar** appears immediately below the filter row:
  - Header checkbox + label "Select all visible · N selected" (N updates live).
  - Bulk buttons: `Approve N`, `Deny N`, `Clear N` — disabled when selection is empty.
- The footer's running tally and `Submit decisions` CTA remain visible and live-update as bulk actions land.

Behavior rules:

- The header "Select all visible" checkbox respects the active dimension filter — it only checks the rules currently rendered.
- Selection persists across filter changes. Switching from "Validity" to "All" preserves which rules are checked; only the rendered list changes.
- Bulk actions do not auto-exit selection mode. Users can do multiple bulk operations in one trip.
- Exiting selection mode (via `Done selecting`) clears the current selection.
- Re-applying a bulk action to rules that already match the target state is a no-op (no error, no state change).

## Reversibility

All decisions are reversible:

- **Per-row**: clicking the active Approve button on an approved rule reverts it to undecided. Same for Deny.
- **Bulk**: the `Clear N` button in selection mode is the only path to bulk-revert.

The reversal is implicit in the same button toggle for per-row interactions — no separate "Undo" UI. Bulk gets an explicit `Clear N` because re-clicking the bulk Approve when some rules are approved and some aren't is ambiguous.

## Dimension tag system

Tags use a **soft tinted fill, no border, `-deep` text** pattern. The fill is 8% opacity of the tag's accent color. The four dimensions currently emitted by the backend map to:

| Dimension     | Token           | Fill (8% of hex) | Text (deep hex) |
|---------------|-----------------|------------------|------------------|
| Completeness  | `category-teal` | `#0D9488 @ 8%`   | `#115E59`        |
| Validity      | `category-rose` | `#DB2777 @ 8%`   | `#9D174D`        |
| Uniqueness    | `category-amber`| `#92400E @ 8%`   | `#451A03`        |
| Consistency   | `category-slate`| `#475569 @ 8%`   | `#334155`        |

Color choices deliberately avoid the existing semantic (success/warning/danger/info), AI accent (purple/indigo), and brand (primary/accent) colors so dimension chips never read as a status signal.

Dimensions outside the four above (e.g., timeliness, accuracy if introduced later) render with the `category-slate` token as a safe neutral default. The mapping lives in a single TS module (`frontend/lib/dq/dimensions.ts`) and the registry is exhaustive over the union of known dimension ids.

Tag chrome:

- 4px vertical padding, 8px horizontal, `rounded-md`
- 12px text, font-medium, `tracking-tight`
- Capitalized label (first letter only — "Validity", not "VALIDITY")

## Token additions

Four new System-collection token pairs added in this round, mirrored across Figma + globals.css + Tailwind:

```
--color-category-teal       #0D9488   --color-category-teal-deep    #115E59
--color-category-rose       #DB2777   --color-category-rose-deep    #9D174D
--color-category-amber      #92400E   --color-category-amber-deep   #451A03
--color-category-slate      #475569   --color-category-slate-deep   #334155
```

These are System (mode-less), not Brand — dimension colors should not vary by client. They land in `:root` of globals.css and in `tailwind.config.ts` as `category-teal`, `category-teal-deep`, etc., extending the existing accent / semantic / `-deep` family.

## Button system

Five distinct button shapes appear in the redesigned stage. All use word + icon, never icon-only.

### A — Per-row decision buttons (Approve, Deny)

Pill shape, 28px tall, 12px horizontal padding, 6px gap between icon and label, `rounded-md`, 13px font-medium.

| State                    | Border               | Fill                | Text                |
|--------------------------|----------------------|---------------------|---------------------|
| Approve, undecided       | `border-success`     | `bg-surface`        | `text-success-deep` |
| Approve, **active**      | `border-success-deep`| `bg-success-deep`   | `text-on-brand`     |
| Deny, undecided          | `border-danger`      | `bg-surface`        | `text-danger-deep`  |
| Deny, **active**         | `border-danger-deep` | `bg-danger-deep`    | `text-on-brand`     |

Re-clicking the active button reverts to undecided.

### B — Edit button (per-row, bottom-right)

Pill shape, same dimensions as A.

| State                       | Border                | Fill          | Text             | Label    |
|-----------------------------|-----------------------|---------------|------------------|----------|
| Idle                        | `border-border-strong`| `bg-surface`  | `text-fg-muted`  | "Edit"   |
| Editor open                 | `border-fg-default`   | `bg-elevated` | `text-fg-default`| "Editing"|

Icon: ✎ (pencil) — kept consistent with Stepper's done-state SVG style.

### C — Toolbar actions (Select / Done selecting, Approve all)

Same pill chrome and dimensions as B.

- **Select / Done selecting** — neutral idle state by default. While selection mode is active and the label reads "Done selecting", the button uses the "Editor open" treatment (border-fg-default, bg-elevated).
- **Approve all** — uses the Approve-undecided treatment from A.

### D — Bulk action buttons (Approve N, Deny N, Clear N)

Approve / Deny variants use the same treatments as A (idle = undecided treatment, since you can't have a "bulk active" state). `Clear N` uses the neutral Edit treatment from B.

Disabled state for all bulk buttons: `opacity-50 cursor-not-allowed`, no hover effect. The `N` count renders inline in the label.

### E — Primary CTA (Submit decisions)

The new primary button shape established in Round 1.

| Property          | Value                                                   |
|-------------------|---------------------------------------------------------|
| Fill              | `bg-brand-accent`                                       |
| Text              | `text-on-brand`                                         |
| Height            | 36px                                                    |
| Horizontal padding| 16px                                                    |
| Radius            | `rounded-md`                                            |
| Disabled state    | `opacity-50 cursor-not-allowed`, no hover               |
| Hover             | `filter: brightness(110%)` — works for both brand modes |

The button is enabled when `undecided === 0` and `submitting === false`.

## Footer (sticky)

```
[ 8 approved · 2 denied · 14 undecided ]                     [ Submit decisions → ]
```

- Background `bg-surface` (NOT `bg-elevated`), `border-t border-border-subtle`.
- Counts use the `-deep` variants for readability on white: approved = `text-success-deep`, denied = `text-danger-deep`, undecided = `text-fg-muted`. Each count is prefixed by the matching colored dot (semantic, not deep) at 8px.
- The CTA is right-aligned. Loading state changes its label to "Submitting…" and disables the button.

## Icon system

The project adopts **Lucide** (lucide-react) as the canonical icon library across both rounds. Lucide is the icon set shadcn pairs with, MIT-licensed, ~1,400 icons, every glyph drawn on a 24×24 viewBox with 2px stroke. Adopted because:

- Round 1 shipped with a mix of custom polylines and Unicode glyphs that don't visually match each other (the Stepper done-check and the Round 2 Approve `✓` are different shapes).
- Adopting a single library now means future stages don't reinvent icon shapes per component.

### Round 2 icon mapping (new in this spec)

| Where                          | Lucide icon       | Size  | Stroke width |
|--------------------------------|-------------------|-------|--------------|
| Approve button (idle + active) | `Check`           | 14px  | 2            |
| Deny button (idle + active)    | `X`               | 14px  | 2            |
| Edit button (idle + editing)   | `Pencil`          | 14px  | 2            |
| Select toolbar button (idle)   | `SquareCheckBig`  | 14px  | 2            |
| Done selecting (toolbar active)| `SquareCheckBig`  | 14px  | 2            |
| Clear N (bulk)                 | `RotateCcw`       | 14px  | 2            |
| Submit decisions CTA           | `ArrowRight`      | 14px  | 2            |
| Selection-mode card checkbox   | `Check` (in fill) | 10px  | 2.5          |

### Round 1 retrofit (out-of-spec for this stage, but part of this change)

- **Stepper, done state**: replace custom polyline with `Check` (10px, 2.5 stroke, `text-fg-inverse`). Tightens proportions and matches every other check in the app.
- **AIPanel, WaitingBanner pause icon**: replace the two hand-drawn rectangles with `Pause` (14px, 2 stroke, `text-fg-muted`).
- **TopBar, overflow indicator**: replace the three hand-drawn circles with `Ellipsis` (16px, 2 stroke, `text-fg-muted`).

Stroke colors bind to existing tokens via `currentColor`; no new tokens needed.

### Implementation notes for code translation

- Install `lucide-react` (single dependency). Icons are tree-shakeable — each import is just its SVG path.
- In components, import per-icon: `import { Check, X, Pencil } from 'lucide-react'`.
- Pass `size`, `strokeWidth`, and `className` (for color via `currentColor` inherited from parent text color).
- No wrapper component needed — Lucide icons are already lean React components.

## Component boundaries

To avoid a single 200-line `RulesStage.tsx` doing too much, the redesigned component decomposes into:

- `RulesStage.tsx` — top-level container, owns `decisions`, `edits`, `editingId`, `filter`, `selectionMode`, `selectedIds`, `submitting` state. Renders filter row, toolbar, bulk action bar (conditional), rule list, footer.
- `RuleCard.tsx` — single rule view. Receives `rule`, `decision`, `isEditing`, `isSelectionMode`, `isSelected`, callbacks. Renders the dimension chip, body, decision buttons (default mode), checkbox (selection mode), Edit button, inline editor.
- `RuleInlineEditor.tsx` — the existing editor logic extracted. Same form fields, retokenized chrome.
- `DimensionChip.tsx` — single component reading the dimension→token map.
- `SelectionToolbar.tsx` — the bulk action bar shown in selection mode. Pure presentation; callbacks come from the parent.
- `DecisionFooter.tsx` — the sticky footer with tally + Submit CTA.

`lib/dq/dimensions.ts` exports the dimension→token map and a `DimensionId` type union.

## State and data flow

State lives entirely in `RulesStage.tsx`:

- `decisions: Record<RuleId, 'approved' | 'denied' | 'pending'>` — initialized to `'pending'` for every rule. (Note: we rename the existing `'rejected'` decision value to `'denied'` to match the new UI vocabulary; the API call still sends `rejectedIds` so the rename is purely UI-internal.)
- `edits: Record<RuleId, Partial<Rule>>` — unchanged from today.
- `editingId: RuleId | null` — only one rule's editor is open at a time.
- `filter: DimensionId | 'all'`
- `selectionMode: boolean`
- `selectedIds: Set<RuleId>`
- `submitting: boolean`

All mutations flow through callbacks defined in `RulesStage.tsx` and passed down. Children are pure; the only side effect (API call) lives in the parent's `handleSubmit`.

`handleSubmit` is unchanged in shape: it filters `decisions` by `'approved'`, applies `edits` to those, derives `rejectedIds` from `decisions === 'denied'`, and calls `approveRules(session.session_id, approvedRules, rejectedIds)`. Field names on the wire stay `rejectedIds` for API compatibility.

## Testing strategy

Unit tests (Jest + Testing Library) for the high-judgment pieces only — visual regressions are caught in Figma + manual eyeball:

- `RulesStage.test.tsx` — toggle behavior (approve → approve reverts), bulk actions (approve 3 with mixed prior states), filter + selection interaction (selecting in "Validity" view, switching to "All" preserves selection), `Submit decisions` disabled until all decided.
- `DimensionChip.test.tsx` — unknown dimension falls back to slate; mapped dimensions render their colored chip.
- No new test for `RuleInlineEditor`; the field-set logic is unchanged from today and already integration-covered.

## Out of scope / deferred

- Keyboard shortcuts (e.g., `a` to approve focused row). Useful later, not in Round 2 Stage 1.
- Drag-to-select for ranges in selection mode.
- Persisting selection state to URL / session storage across page reloads.
- Dark mode for the new chrome — same Round 1 deferral.

## Open follow-ups for the planning phase

1. Confirm that the existing `lib/api.ts` `approveRules` call accepts the same payload shape — verify against the function before the implementation plan locks in the wire format.
2. Decide whether the toolbar's "Approve all" button is preserved in selection mode (it would compete with the bulk action bar's `Approve N`). Recommendation: hide it in selection mode; redundancy without information.
3. Decide whether `Clear N` clears the **selection** or clears the **decisions** of selected rules. Spec assumes the latter (clears decisions, keeps selection so the user can re-decide). Confirm during planning.
