# Profile Stage Redesign — Design Spec

**Round / Stage:** Round 2 / Stage 4
**Date:** 2026-05-19
**Predecessors:**
- [`2026-05-14-figma-roundtrip-redesign-design.md`](2026-05-14-figma-roundtrip-redesign-design.md) (foundation)
- [`2026-05-17-rules-stage-redesign.md`](2026-05-17-rules-stage-redesign.md) (Stage 1)
- [`2026-05-18-sessions-list-redesign.md`](2026-05-18-sessions-list-redesign.md) (Stage 2)
- [`2026-05-18-load-stage-and-ai-panel-scroll.md`](2026-05-18-load-stage-and-ai-panel-scroll.md) (Stage 3)

**Figma:** `https://www.figma.com/design/gsnW43uSpvdLpwandZM8Zx` — page `02 — Foundation`
- `Profile / 1440x900 / Default` (`131:239`)

---

## Goal

Replace `ProfileStage.tsx`'s pre-foundation chrome — legacy `text-text-*` tokens, hardcoded indigo, inline hex colors in style props, low-contrast warning/danger families — with a token-driven layout that matches the rest of Round 2. Add a small high-value feature: a **per-alert list** surfaced directly under the stats grid so the user can see *what* the AI flagged without scrolling into the next stage. Drop the existing column breakdown table — its job is duplicated by the AI summary + the alerts list, and rendering 47 rows of mostly-clean inventory bloats the page.

---

## Out of scope

- Column breakdown table — removed for now. If a future use case demands a full per-column inventory, it gets its own design pass with sorting, virtualization, and filter UX considered up front.
- Backend / data shape changes. We read the existing `profile.alerts` payload (`{column?, type?, description?}[]`) as-is.
- The AI summary text itself. We render whatever the agent writes; copy choices live in `backend/agents/graphs/profile_analyzer.py`.
- Snapshot view changes. `SnapshotStageView` continues to mount `ProfileStage` with `readOnly` — the redesigned component honors that flag the same way the current one does.
- A11y beyond what the spec calls for explicitly (no new aria-live regions, no new keyboard shortcuts).

---

## Background

### Today's Profile stage (95 lines)

`frontend/components/stages/ProfileStage.tsx` renders, top-to-bottom:

1. **Heading + subhead** ("Data Profile" + AI analysis subline) — legacy `text-text-primary` / `text-text-muted`.
2. **AI Summary card** in `bg-indigo/10 border-indigo/30` with a `✦ AI Summary` label. When `ai_summary` isn't populated yet, it swaps to a "AI is analyzing your dataset…" loader with an indigo spinner.
3. **Stats grid** (4 tiles, 2-column flex grid): Completeness, Rows, Columns, Alerts.
   - Completeness has a progress bar with **inline hex** fills (`#22c55e` / `#f59e0b`).
   - Alerts tile colors itself danger-light when `alerts.length > 0`.
4. **Column breakdown table** — sortable in source order, no header sorting, soft danger tint on rows with `p_missing > 5%`. Uses inline hex for the bar fills (`#22c55e` / `#ef4444`).
5. **Continue button** — `bg-indigo text-white` (hardcoded), only renders when `session.ai_summary` is populated and `!readOnly`.

### Tokens / patterns it ignores

- The foundation-v1 token system (`text-fg`, `text-fg-muted`, `bg-surface`, `border-border`, `bg-brand-accent`, `text-on-brand`, `text-{success,warning,danger,info}-deep`).
- The Stages 1–3 primary-button shape (`bg-brand-accent text-on-brand text-[13px] font-semibold px-4 py-2 rounded-md hover:bg-brand-accent/90 hover:shadow-md transition-all`).
- The Stage 2 section-label pattern (`text-xs font-semibold uppercase tracking-wider text-fg-muted`).
- The AI panel's semantic color reservation: indigo is "TOOL CALL", purple is "THINKING". AI summary text should match the THINKING semantic, not TOOL CALL.

### Where it's mounted

- `app/sessions/[id]/page.tsx` (`case 'profile'`) — live profile data.
- `components/stages/SnapshotStageView.tsx` (`case 'profile'`) — historic profile data, `readOnly`.

Signature stays: `function ProfileStage({ session, onContinue, readOnly })`.

---

## Design — page composition

The redesigned page renders the following sections, top-to-bottom inside the existing Main pane (no Page-level layout changes). All section gaps are 16px.

```
Heading block
AI Summary card                  (purple tint, hidden when no ai_summary)
AI loading state                 (shown instead of AI Summary while pending)
Stats grid (2×2)                 (4 tiles)
ALERTS (N) label + AlertsList    (hidden when alerts.length === 0)
Continue to Rules CTA            (right-aligned, hidden when readOnly OR !ai_summary)
```

### Heading block

```html
<h1 class="text-base font-bold text-fg">Data Profile</h1>
<p class="text-xs text-fg-muted">AI analysis of your dataset structure and quality characteristics</p>
```

### AI Summary card

Two states:

**Populated** — `ai_summary` is truthy:

```html
<div class="bg-accent-purple/15 border border-accent-purple/30 rounded-xl p-4 flex flex-col gap-1.5">
  <div class="text-[10px] font-semibold uppercase tracking-widest text-accent-purple-deep">✦ AI SUMMARY</div>
  <p class="text-xs text-accent-purple-deep leading-relaxed">{session.ai_summary}</p>
</div>
```

The purple-deep on a purple-tinted background reads as a "the AI is thinking aloud" callout — matches the THINKING card in the AI panel.

**Pending** — `ai_summary` is falsy:

```html
<div class="bg-surface border border-border rounded-xl p-4 flex items-center gap-3">
  <div role="status" aria-label="Analyzing" class="w-4 h-4 border-2 border-brand-primary border-t-transparent rounded-full animate-spin shrink-0" />
  <span class="text-xs text-fg-muted">AI is analyzing your dataset…</span>
</div>
```

Same spinner ring color as the Load stage (`border-brand-primary`) for consistency. Real-ellipsis `…` character.

### Stats grid (4 tiles)

2-column grid, gap 12. Each tile is `bg-surface border border-border rounded-xl p-4 flex flex-col gap-1.5`. Inside:

```html
<div class="text-xs font-semibold uppercase tracking-wider text-fg-muted">Completeness</div>
<div class="text-2xl font-bold {colorClass}">93%</div>
{progressBar?}
```

Per-tile content:

| Tile | Label | Value | Color | Progress bar? |
|---|---|---|---|---|
| Completeness | `Completeness` | `{pct}%` or `—` | `text-success-deep` if `pct >= 90`, else `text-warning-deep`. Same for the bar fill. | Yes — track `bg-border` / `h-1 rounded`, fill colored to match the value. |
| Rows | `Rows` | `n_rows.toLocaleString()` | `text-fg` | No |
| Columns | `Columns` | `n_columns` | `text-fg` | No |
| Alerts | `Alerts` | `alerts.length` | `text-warning-deep` if `> 0`, else `text-fg`. | No |

**No inline hex.** All colors come from token classes.

### Alerts list (NEW)

Hidden when `alerts.length === 0`. Renders:

```html
<div class="text-xs font-semibold uppercase tracking-wider text-fg-muted">Alerts ({alerts.length})</div>
<ul class="flex flex-col gap-4 mt-2">
  {alerts.map(a => <AlertRow alert={a} />)}
</ul>
```

Each row:

```html
<li class="bg-surface border border-border rounded-lg p-3 flex flex-col gap-1.5">
  <div class="flex items-center gap-2.5">
    <span class="text-[13px] font-semibold text-fg">{column || 'Table-level'}</span>
    <span class="{chipClasses(type)} text-[11px] font-semibold px-2 py-0.5 rounded-md">{type}</span>
  </div>
  <p class="text-xs text-fg-muted leading-relaxed">{description}</p>
</li>
```

The chip color is keyed off the alert `type` string. Three buckets:

```ts
function chipClasses(type: string): string {
  const t = (type ?? '').toLowerCase()
  if (t.includes('missing') || t.includes('constant'))
    return 'bg-warning/15 text-warning-deep'
  if (t.includes('cardinality') || t.includes('duplicate') || t.includes('skew'))
    return 'bg-info/15 text-info-deep'
  return 'bg-danger/15 text-danger-deep'  // anything else: still worth a look
}
```

Three buckets keep us aligned with the dimension-chip pattern from Stage 1 and don't require us to enumerate every ydata-profiling alert string. New alert types fall through to the danger bucket — a safe default ("something I don't know, show it").

When `alerts.length > 5` we show all of them. No truncation. The Main pane already has `overflow-y-auto`; a longer list just scrolls. Truncation can be added later if real-world counts get unwieldy — for now we'd rather over-show than risk hiding a relevant alert.

If an alert has no `column` (table-level alert), we display `Table-level` as the column-name slot so the row still reads correctly.

### Continue to Rules CTA

```html
<div class="flex justify-end mt-2">
  <button onClick={onContinue} class="inline-flex items-center gap-1.5 bg-brand-accent text-on-brand text-[13px] font-semibold px-4 py-2 rounded-md hover:bg-brand-accent/90 hover:shadow-md transition-all">
    Continue to Rules
    <ArrowRight size={14} strokeWidth={2} />
  </button>
</div>
```

Same shape as the Sessions/Load primary CTAs. Lucide `ArrowRight` icon on the right, not the literal `→` character.

Hidden when `readOnly === true` OR `ai_summary` is falsy (same conditions as today).

---

## What's removed

- The entire Column Breakdown table block (`text-[10px] uppercase tracking-widest text-text-muted` label + table + rows).
- The `inline-style` hex colors on the completeness bar and the column-table null-rate bars.
- The `bg-indigo/10 border-indigo/30 text-indigo text-indigo-light` chrome.

---

## What changes vs. today

| Surface | Before | After |
|---|---|---|
| Heading wrapper | `text-text-primary` | `text-fg` |
| Subhead | `text-text-muted` | `text-fg-muted` |
| AI Summary card | `bg-indigo/10 border-indigo/30`, `text-indigo`, `text-indigo-light/90` | `bg-accent-purple/15 border-accent-purple/30`, `text-accent-purple-deep` body + label |
| AI loading spinner | `border-indigo` | `border-brand-primary` |
| AI loading copy | `Uploading and loading…` style language is fine; tightened to `AI is analyzing your dataset…` with real `…` |
| Section labels | `text-[10px] uppercase tracking-widest text-text-muted` | `text-xs font-semibold uppercase tracking-wider text-fg-muted` (matches Stage 2) |
| Stat tile labels | same one-off | same as section labels |
| Stat tile values | `text-text-primary`, `text-success-light`, `text-warning`, `text-danger-light` | `text-fg`, `text-success-deep`, `text-warning-deep`, `text-danger-deep` |
| Completeness bar | inline hex `#22c55e` / `#f59e0b` | `bg-success-deep` / `bg-warning-deep` (matches value color) |
| Continue button | `bg-indigo text-white text-sm` (one-off) | The Stage 2 primary-button class. Lucide `ArrowRight` icon. |
| Column breakdown | rendered with hex-tinted bars | gone |
| Alerts list | not rendered (alerts surfaced only as a count) | full list rendered when `alerts.length > 0` |

---

## Components / file map

```
frontend/
  components/
    stages/
      ProfileStage.tsx                 # MODIFY — full rewrite (still ~90 lines after change)
      _profile/
        AlertRow.tsx                   # NEW — single alert row
        chip-classes.ts                # NEW — chipClasses(type) helper (the 3-bucket fn)
  __tests__/
    stages/
      ProfileStage.test.tsx            # NEW
      _profile/
        AlertRow.test.tsx              # NEW
        chip-classes.test.ts           # NEW
```

The `_profile/` underscore prefix follows the convention I've seen used for "files only consumed by this stage" (single-import internals). No tests reach for these internals through `@/components/stages/_profile/...` — they're tested at the unit level and through the parent ProfileStage integration test.

Path alias `@/` resolves to `frontend/`. Tailwind content glob already includes `./components/**/*.tsx`.

---

## Behavior matrix

| Scenario | AI Summary | Stats grid | Alerts list | Continue button |
|---|---|---|---|---|
| Live, `ai_summary` empty, `alerts.length === 0` | Loading spinner card | Visible (Completeness shows `—` if `p_cells_missing` null) | Hidden | Hidden |
| Live, `ai_summary` empty, alerts populated | Loading spinner card | Visible | Visible | Hidden (waits for summary) |
| Live, `ai_summary` populated, alerts empty | Purple summary | Visible (Alerts tile = 0, color `text-fg`) | Hidden | Visible |
| Live, `ai_summary` populated, alerts populated | Purple summary | Visible (Alerts tile colored amber) | Visible | Visible |
| Snapshot view (`readOnly`), summary + alerts populated | Purple summary | Visible | Visible | Hidden |
| Snapshot view, no summary in payload | Loading spinner card | Visible with `—` placeholders | Visible/hidden per payload | Hidden |

The Continue button's gate is `ai_summary && !readOnly` — same as today.

---

## Testing strategy

### `chip-classes.ts`

Unit-test the three buckets directly:

```ts
expect(chipClasses('Missing')).toContain('text-warning-deep')
expect(chipClasses('Constant')).toContain('text-warning-deep')
expect(chipClasses('High Cardinality')).toContain('text-info-deep')
expect(chipClasses('Duplicates')).toContain('text-info-deep')
expect(chipClasses('Skewness')).toContain('text-info-deep')
expect(chipClasses('Some Future Alert')).toContain('text-danger-deep')
expect(chipClasses('')).toContain('text-danger-deep')
```

Plus case-insensitivity (`MISSING` should match `missing`) and a `null`/`undefined` safety check.

### `AlertRow.tsx`

- Renders column name, chip with type label, description in three slots.
- When the alert has no `column`, shows `Table-level`.
- Chip class matches the bucket the alert type falls into.

### `ProfileStage.tsx` (integration)

- Renders the AI summary card with purple classes when `ai_summary` is set.
- Renders the loading card with `border-brand-primary` when `ai_summary` is empty.
- Renders all 4 stat tiles with the right value formatting (`18,432` → comma-grouped).
- Completeness tile: `bg-success-deep` when `pct >= 90`, `bg-warning-deep` below.
- Alerts list is hidden when `profile.alerts` is empty.
- Alerts list renders one row per alert with `column`, `type`, `description` visible.
- Continue button hidden when `readOnly`.
- Continue button hidden when `ai_summary` empty (live).
- Continue button calls `onContinue` when clicked.

### Full suite baseline

Going in: 104 passing / 1 failing (the pre-existing `useAIStream` failure).
Expected after Stage 4: ~118–120 passing / 1 failing. Tests added: ~14 (4 chip-classes + 3 AlertRow + 7 ProfileStage). The pre-existing failure stays untouched.

---

## Component boundaries (recap)

- **`chipClasses(type)`** — pure string mapping. No DOM. No knowledge of alerts beyond the type string.
- **`<AlertRow alert={...} />`** — presentational. Reads `column`, `type`, `description` from its prop. Calls `chipClasses`. No state.
- **`<ProfileStage session, onContinue, readOnly />`** — same shape as today. Owns the section layout, the loading-state branching, the Continue button. Delegates to `<AlertRow>` for each alert.

---

## Open notes

- **AI summary copy in the mock vs. real:** the mock text references the column breakdown ("Three columns flagged for follow-up below"). In production, the agent writes the actual paragraph and may not reference the breakdown — that's fine. The component renders `session.ai_summary` verbatim.
- **The dropped column breakdown:** if a real customer asks "where do I see every column at once?" we can revisit. Easy enough to add as a collapsible block later without touching the rest of the layout.
- **Accent-purple token availability:** the foundation already defines `accent-purple`, `accent-purple-deep`, `accent-purple/15`, `accent-purple/30` (used in the AI panel's THINKING card). No new tokens needed.
- **Continue button icon:** swapped from the literal `→` character to lucide-react `ArrowRight` for consistency with the rest of the round-2 buttons. lucide v1 exports forwardRef objects — same caveat from Stage 2.

---

## Figma reference

- `131:239` — Profile / 1440x900 / Default — full populated state with purple AI summary, 4 stat tiles, 5 alert rows (Missing / Missing / High Cardinality / Constant / Skewness), and the Continue CTA.

All edits land within page `02 — Foundation` of `gsnW43uSpvdLpwandZM8Zx`. The frame stacks at `(80, 4100)` directly below the Stage 3 Load frame.
