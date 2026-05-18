# Sessions List Redesign — Design Spec (Round 2, Stage 2)

**Date:** 2026-05-18 · **Status:** Draft for user review · **Page:** `/` (home / sessions list)

## Purpose

Bring the sessions-list home page (`frontend/app/page.tsx`) and its session-card component (`frontend/components/sessions/SessionCard.tsx`) in line with the design system established in Round 1 (foundation-v1) and Round 2 / Stage 1 (rules-stage-v1). The current implementation predates both rounds and uses old aliases (`text-text-primary`, `bg-indigo`, `border-indigo/40`, `text-success-light`) plus an inline-SVG gradient hexagon for branding. This is visual parity work — behavior is unchanged.

## Non-goals

- New features (search, filter, sort, archive, sample sessions).
- Changes to the upload flow or `UploadModal` component (separate scope).
- Backend / API changes. Wire shapes for `useSessionsList`, `deleteSession`, `getPipelineDownloadUrl` stay as today.
- Replacing the modal upload pattern with a dedicated upload route.

## Page structure

The redesigned page has two top-level states: populated (≥1 session) and empty.

### Shared chrome — simplified TopBar

A header that reuses the workspace TopBar's visual language, stripped of session-specific elements (breadcrumb, filename, row/col metadata, score chip, overflow dots).

```
┌─ h-14, bg-surface, border-b border-border, px-4 ───────────────────────────┐
│  [Logo]  DQ Accelerator                              [↑ New session]       │
└────────────────────────────────────────────────────────────────────────────┘
```

- 56px tall.
- Left cluster: theme-aware `<Logo />` (the one that already exists from Round 1 — pulls from active theme), followed by "DQ Accelerator" at 14px font-semibold `text-fg`.
- Right cluster: primary CTA — `bg-brand-accent` fill, `text-on-brand`, `rounded-md`, ~28px tall with 12px horizontal padding. Icon: Lucide `Upload` (or `ArrowUp`) at 14px stroke 2. Label: "New session".
- No vertical separator after the title, no breadcrumb, no row/col metadata. The right side of the bar belongs to the CTA only.
- The same primary CTA shape used for `Submit decisions` in the Rules stage.

### Populated state (≥1 session)

Below the TopBar:

```
┌─ p-6 bg-canvas min-h-[calc(100vh-56px)] ───────────────────────────────────┐
│                                                                            │
│  RECENT SESSIONS                                                           │
│                                                                            │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐       │
│  │ SessionCard  │ │ SessionCard  │ │ SessionCard  │ │ SessionCard  │       │
│  └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘       │
└────────────────────────────────────────────────────────────────────────────┘
```

- Section label: `RECENT SESSIONS` at 10px uppercase tracking-widest, `text-fg-muted`, 12px bottom margin. Same label currently exists.
- Grid: `grid gap-4` with `grid-template-columns: repeat(auto-fill, minmax(280px, 1fr))`. Unchanged from today.
- The inline dashed "Upload a dataset" tile is **removed**. The header CTA is the single creation affordance in the populated state.

### Empty state (zero sessions)

Centered vertically + horizontally inside the content area:

```
┌─ flex items-center justify-center min-h-[calc(100vh-56px)] bg-canvas ──────┐
│                                                                            │
│             ┌─ max-w-md, bg-surface, border border-border,                 │
│             │  rounded-lg, p-8, flex flex-col items-center gap-4 ─┐       │
│             │                                                      │       │
│             │           ┌─ UploadCloud icon (48px stroke 2)        │       │
│             │           │  in a w-16 h-16 rounded-full bg-elevated │       │
│             │           │  flex centered, text-fg-muted ─┐         │       │
│             │           └─────────────────────────────────┘         │       │
│             │                                                      │       │
│             │   Start your first data quality session              │       │
│             │   (text-base font-semibold text-fg)                  │       │
│             │                                                      │       │
│             │   Upload a CSV, Parquet, or JSON file. AI will       │       │
│             │   profile it, suggest rules, and walk you through    │       │
│             │   cleanup.                                           │       │
│             │   (text-sm text-fg-muted leading-relaxed text-center)│       │
│             │                                                      │       │
│             │              [↑ Upload a dataset]                    │       │
│             │              (same primary CTA as header)            │       │
│             └──────────────────────────────────────────────────────┘       │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

- The empty card has a `max-w-md` (~28rem) so it doesn't stretch on wide viewports.
- Headline at 16px font-semibold; body at 13px `text-fg-muted` with `text-center` and a comfortable max-prose width inside the card.
- Headline + body describe what the app *does*, not which button to click — better first-time orientation than imperative microcopy.
- The header CTA stays visible in the empty state so power users have a consistent target. Both routes open the same `UploadModal`.

## Session card

A retokenized version of `SessionCard.tsx`. Same data, same hover-X-confirm delete, same conditional download button. New chrome.

```
┌── 280px min · bg-surface · border-border · rounded-lg · p-4 ──────────────┐
│                                                                            │
│  loans-fy2025.csv                                  [ Awaiting Rules ]      │
│  Apr 28, 2026                                                              │
│                                                                            │
│  Quality Score                                                  87%        │
│  ▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▱▱▱▱▱▱                                              │
│                                                                            │
│  [ ↓ Download ]                                                            │ ← COMPLETE only
└────────────────────────────────────────────────────────────────────────────┘
```

### Header row (filename + stage chip)

- Filename: 14px font-semibold `text-fg`, single line with `truncate` on overflow.
- Date below filename: 12px `text-fg-muted`, `Apr 28, 2026` format (`toLocaleDateString()` unchanged).
- Stage chip top-right: same chrome as the workspace TopBar score chip — `bg-surface` + 1px border + `rounded-full px-2 py-0.5 text-[11px] font-semibold`. Palette varies by stage category (below).

### Stage category palette

Three categories map every backend `WorkflowStage` to one of three visual palettes:

| Category | Backend stages | Border | Text |
|---|---|---|---|
| **Awaiting user** | `AWAITING_INVESTIGATION_REVIEW`, `AWAITING_RULE_APPROVAL`, `RULE_REVIEW`, `AWAITING_TRIAGE_APPROVAL`, `AWAITING_PLAN_APPROVAL`, `AWAITING_HUMAN_INPUT`, `AWAITING_PIPELINE_CONFIRMATION`, `PROFILING_SYNTHESIS` | `border-warning` | `text-warning-deep` |
| **AI in progress** | `LOADING`, `PROFILING`, `REINVESTIGATING`, `VALIDATING`, `TRIAGING`, `PLANNING`, `TRANSFORMATION_LOOP`, `GENERATING` | `border-info` | `text-info-deep` |
| **Complete** | `COMPLETE` | `border-success` | `text-success-deep` |

A small `categoryFor(stage)` helper in `lib/stages.ts` returns one of `'awaiting' | 'progress' | 'complete'`. The card reads from this to pick the chip variant. Unknown stages fall back to the AI-in-progress palette (safer than awaiting, since awaiting visually shouts for action).

### Quality score block

- Label row: `Quality Score` (12px `text-fg-muted`) on the left, percentage (12px font-semibold, variant-deep color) on the right.
- For COMPLETE sessions, the percentage shows a delta callout inline: `87% +15%` where `+15%` is `text-success-deep` at 10px font-medium.
- Bar below the label row: 6px tall (`h-1.5`), `rounded-full`, `bg-{variant}/20` track (~20% tint), `bg-{variant}-deep` fill at `width: score%`.

Score variant follows the same thresholds as the workspace TopBar score chip:

| Score | Variant | Token suffix |
|---|---|---|
| `>= 0.90` | success | `success-deep` text + `success/20` track + `success-deep` fill |
| `>= 0.70` | warning | `warning-deep` text + `warning/20` track + `warning-deep` fill |
| `< 0.70`  | danger  | `danger-deep` text + `danger/20` track + `danger-deep` fill |

The percentage text, bar track, and bar fill all share the variant so a low-score card reads danger-throughout rather than mixing semantic-colors. The stage chip and the score variant are independent — a `COMPLETE` low-score session reads `[Complete]` (green chip) with a red score bar; that's intentional and accurate (work done, quality still poor).

### Delete affordance

Hover-X with two-click confirm, retokenized. Same UX as today.

- Absolutely positioned top-right (`top-2 right-2`), `opacity-0 group-hover:opacity-100`.
- Idle: `text-fg-muted text-xs px-2 py-1 rounded-md`, label `×`.
- Confirming: label flips to `Confirm?`, same chrome.
- Deleting: label flips to `…`.
- Hover color: `hover:text-danger-deep` (was `hover:text-danger`).
- Cancels on `onMouseLeave` (existing behavior).

### Download button (COMPLETE only)

`<a download>` styled as a neutral full-width pill:

- `block w-full text-center text-[11px] border border-border-strong text-fg-muted px-2 py-1.5 rounded-md hover:bg-elevated`
- Lucide `Download` icon (14px stroke 2) inline-left of "Download".

### Hover state on the card itself

- Default: `border-border`.
- Hover: `border-fg-muted` (darkens the outline so the card lifts visually).
- No background-color change on hover (the card itself is already `bg-surface`); the delete `×` reveal is the main affordance signal.

## Component boundaries

Three files modified, one new utility module:

- `frontend/app/page.tsx` — replaces today's 72-line implementation. Renders the simplified TopBar, switches between populated and empty states, owns the `showUpload` modal state. No new state ownership beyond what exists today.
- `frontend/components/sessions/SessionCard.tsx` — retokenized rewrite.
- `frontend/components/sessions/EmptyState.tsx` — **new**. The center-stage empty card. Pure presentation; receives an `onUpload: () => void` callback.
- `frontend/lib/stages.ts` — **new**. Exports `WorkflowStageCategory = 'awaiting' | 'progress' | 'complete'`, `STAGE_LABELS` (extracted from the current SessionCard), and `stageCategory(stage: WorkflowStage): WorkflowStageCategory`. `STAGE_LABELS` is also useful in the workspace, so extracting it now prevents future duplication.

No changes to:
- `frontend/components/sessions/UploadModal.tsx`
- `frontend/hooks/useSessionsList.ts`
- `frontend/lib/api.ts`
- Backend.

## State and data flow

`page.tsx` owns only `showUpload: boolean`. Sessions data comes from `useSessionsList` (unchanged). `handleCreated` flow (refresh → close modal → router.push) is preserved verbatim. The legacy localStorage cleanup at the top of the current `HomePage` (`localStorage.removeItem('dq_sessions')`) is preserved unchanged.

## Testing strategy

Unit tests on the high-judgment piece — the stage→category mapping — plus a smoke test on the card variant logic. No tests on the page-level layout (Phase 5 visual smoke catches that).

- `frontend/__tests__/lib/stages.test.ts` (new): every `WorkflowStage` value in the union resolves to a known category; unknown stages fall back to `'progress'`.
- `frontend/__tests__/components/sessions/SessionCard.test.tsx` (new): given a stage in each category, the card renders the corresponding chip variant (asserts a `data-stage-category` attribute on the chip). Given a low/mid/high score, the bar gets the right variant (asserts `data-score-variant`).
- `frontend/__tests__/components/sessions/EmptyState.test.tsx` (new, optional): clicking the CTA fires `onUpload`. Small; useful for future refactors.

## Open follow-ups for the planning phase

1. Confirm there's no Lucide icon name collision — `Upload` vs `UploadCloud` vs `ArrowUp`. Decision recommendation: `UploadCloud` for the empty-state large icon, `Upload` for the header / empty-state CTA buttons. Verify both exist in the installed `lucide-react` version.
2. The `RECENT SESSIONS` label may eventually want a count beside it (`RECENT SESSIONS (4)`). Out of scope for this stage; flagged so we don't surface-paint it now and then revisit.
3. Decide whether the simplified TopBar component should be extracted from the workspace `TopBar.tsx` (shared base) or live as its own small component at `frontend/components/sessions/SessionsTopBar.tsx`. Recommendation in the plan: keep them as two separate components — the workspace `TopBar` has session-specific props (filename, score, etc.) that don't apply, and a shared base with optional sections would be more abstraction than this surface justifies right now.
