# Load Stage + AI Panel Auto-Scroll — Design Spec

**Round / Stage:** Round 2 / Stage 3
**Date:** 2026-05-18
**Predecessors:** [`2026-05-14-figma-roundtrip-redesign-design.md`](2026-05-14-figma-roundtrip-redesign-design.md) (foundation), [`2026-05-17-rules-stage-redesign.md`](2026-05-17-rules-stage-redesign.md) (Stage 1), [`2026-05-18-sessions-list-redesign.md`](2026-05-18-sessions-list-redesign.md) (Stage 2)
**Figma:** `https://www.figma.com/design/gsnW43uSpvdLpwandZM8Zx` — page `02 — Foundation`
- `Load / 1440x900 / Default` (`117:209`)
- `AIPanel / Pill / 3 new` (`118:239`)
- `AIPanel / Pill / Scroll to bottom` (`118:293`)

---

## Goal

Two scoped changes that together make the post-upload experience feel finished:

1. **Load stage retokenize.** Replace the legacy indigo spinner with a token-driven brand-primary (UDig orange) ring and update the surrounding copy/typography to match the rest of the redesigned chrome. Visual parity — no new affordances on the stage itself.
2. **AI Panel follow-mode + scroll-to-latest pill.** Make the AI activity feed auto-scroll to the latest event when the user is pinned to the bottom, and surface a clear "jump back" pill when they've scrolled up. Applies to both the Feed and Terminal views.

The trigger for both changes is the Load stage: it's the first place a fresh session lands, and right now it's a generic spinner while the AI panel is the most informative thing on screen. The user needs to see the latest activity without manual scrolling.

---

## Out of scope

- File metadata card / progress bar / phase labels on the Load stage. The user explicitly chose visual parity for the stage itself — the activity belongs in the AI panel.
- Backend changes. No new endpoints, no schema changes.
- Other stages. The retokenization here doesn't touch ProfileStage, RulesStage, etc. Those have their own pass.
- Persisting scroll/pin state across navigation. Pin state is in-memory per mount.
- New stream events. The AI panel renders whatever `useAIStream` already emits.

---

## Background

### Load stage today

```tsx
// frontend/components/stages/LoadingStage.tsx (current — 8 lines)
export function LoadingStage() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-text-muted">
      <div className="w-8 h-8 border-2 border-indigo border-t-transparent rounded-full animate-spin" />
      <div className="text-sm">Uploading and loading your dataset...</div>
    </div>
  )
}
```

Used in two places:
- `app/sessions/[id]/page.tsx:75` — the `case 'load'` branch when the workflow stage is `LOADING`.
- Same file, line 73 — the fallback while `session` is still loading from the API.
- `components/stages/SnapshotStageView.tsx:37, 84` — the suspense fallback and the `default` switch case.

Uses two legacy tokens that don't exist in the foundation-v1 token system: `border-indigo` and `text-text-muted`. They visually render through Tailwind's hex defaults today, but they don't theme-switch with the brand swap.

### AI Panel today

`frontend/components/ai-panel/AIPanel.tsx` is the shell — header (status dot + "AI Activity" title + segmented Feed/Terminal control), the active view, and a footer that renders either a "Running · Xs" indicator or a `WaitingBanner`. Width is user-resizable and the panel can be collapsed to a 12px rail.

The actual feed lives in:
- `frontend/components/ai-panel/EventFeed.tsx` — cards (`ToolCallCard`, `ResultCard`, `ThinkingCard`, `DoneCard`).
- `frontend/components/ai-panel/EventTerminal.tsx` — line-based view of the same events.

Both render their content inside `overflow-y-auto` containers with **no scroll management**. When `events` grows the cards/lines append to the bottom but the scroll position stays wherever the user left it. New events arrive without any visual indication if the user is reading scrollback.

---

## Design — Load stage retokenize

### Markup

```tsx
// frontend/components/stages/LoadingStage.tsx (new)
export function LoadingStage() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-fg-muted">
      <div
        role="status"
        aria-label="Loading"
        className="w-8 h-8 border-2 border-brand-primary border-t-transparent rounded-full animate-spin"
      />
      <div className="text-sm">Loading your dataset…</div>
    </div>
  )
}
```

### What changed vs. today

| Aspect | Before | After |
|---|---|---|
| Spinner ring color | `border-indigo` (legacy) | `border-brand-primary` (UDig orange via token) |
| Wrapper text color | `text-text-muted` (legacy) | `text-fg-muted` (foundation token) |
| Copy | "Uploading and loading your dataset..." (`...`) | "Loading your dataset…" (ellipsis char `…`) |
| A11y | no role/label | `role="status" aria-label="Loading"` on the spinner |
| Layout | unchanged | unchanged |

The brand-swap behavior comes for free: under Clayton Homes the spinner renders Clayton navy instead of UDig orange, because `border-brand-primary` resolves to whichever brand is active at the theme provider.

### Where it renders

Unchanged. Still mounted at:
- `app/sessions/[id]/page.tsx:73` (fallback when session is loading)
- `app/sessions/[id]/page.tsx:75` (the `case 'load'` branch)
- `app/sessions/[id]/page.tsx:85` (the `default` branch — defensive)
- `components/stages/SnapshotStageView.tsx:37, 84`

The spinner is the entire stage content; the surrounding chrome (TopBar, Stepper, AI Panel) is provided by the workspace shell and gets its own polish during whatever stage you're viewing.

---

## Design — AI Panel auto-scroll + scroll-to-latest pill

### Behavior

There are three states the panel can be in. They are owned by a new `useStickToBottom(ref)` hook that lives next to the panel components.

| State | When | Behavior |
|---|---|---|
| **Pinned** | User is scrolled to the bottom (within a 24px threshold) | New events smooth-scroll the panel down so the latest stays in view. Pill is hidden. |
| **Lifted (no unread)** | User scrolled up; no new events since the lift | Auto-scroll is paused. Pill is visible with label `Scroll to bottom`. |
| **Lifted (unread)** | User scrolled up; new events arrived after the lift | Auto-scroll stays paused. Pill is visible with label `<N> new`, where `N` increments on every new event. |

### Transitions

- **Pinned → Lifted** when the user scrolls up past the 24px threshold (either via mouse wheel, trackpad, touchpad, or programmatic scroll that lands above the threshold). Unread counter resets to 0 at the moment of lift.
- **Lifted → Pinned** when the user scrolls back to within the 24px threshold manually, **or** clicks the pill (which smooth-scrolls to the bottom). Unread counter resets to 0.
- **Unread increments** only while Lifted, and only on `events.length` change (one increment per appended event).
- **View switch (Feed ↔ Terminal):** each view owns its own scroll container, so the pin/unread state is re-evaluated from the new container's scroll position on mount. In practice this means switching views while the new container is shorter than its viewport will immediately re-pin (the threshold check sees `scrollTop === 0` and `scrollHeight === clientHeight`).

### Edge cases

| Case | Behavior |
|---|---|
| `events.length === 0` | Pinned by definition (`scrollTop = 0`, `scrollHeight === clientHeight`). Pill hidden. |
| Content shorter than viewport (no scrollbar) | Same as above. Pinned, pill hidden. |
| Container resized (panel widened/collapsed) | Re-evaluate threshold. If newly-pinned, the pill hides; if newly-lifted, the pill stays hidden until the next event arrives so we don't surprise the user. |
| Smooth-scroll race (a new event arrives mid-animation) | The hook calls `scrollIntoView({ behavior: 'smooth', block: 'end' })` on the last child each render. If a new event lands mid-animation the next render kicks off another smooth-scroll to the new bottom — the browser absorbs this gracefully (the second animation interrupts the first). |
| Programmatic `scrollTo` in third-party code | Honoured the same as any user scroll. We don't try to detect intent. |
| User scrolls down past the bottom (over-scroll bounce on macOS) | Treated as Pinned (`scrollHeight - scrollTop - clientHeight <= 24`). |

### Threshold

24px. Chosen so it's tolerant of the user landing just-above-the-bottom by accident, but not so loose that a user reading the second-to-last card is treated as pinned.

### Scroll-to-latest pill

**Style** matches the established primary button: `bg-brand-accent text-on-brand text-[13px] font-semibold px-4 py-2 rounded-md hover:bg-brand-accent/90 hover:shadow-md transition-all`. Same Tailwind class shape used by `SessionsTopBar` and `EmptyState`'s CTAs in Stage 2.

**Icon:** lucide-react `ArrowDown`, 14px, strokeWidth 2, on the left of the label.

**Label:**
- `<N> new` when `unreadCount > 0` (e.g. `3 new`, `1 new` — singular form not necessary, the count is the affordance).
- `Scroll to bottom` when `unreadCount === 0`.

**Placement:** absolutely positioned inside the scroll container, `bottom: 12px`, horizontally centered (`left: 50%; transform: translateX(-50%)`), `z-index: 10` so it floats above the card stack. Lives inside the same DOM subtree as the cards so the scroll container clips it when needed (it never escapes the panel).

**Accessibility:** `aria-live="polite"` on the pill so the unread count is announced when it updates; `aria-label` mirrors the visible text.

### Implementation shape

A single shared hook:

```ts
// frontend/hooks/useStickToBottom.ts
export interface StickyState {
  pinned: boolean
  unreadCount: number
  scrollToBottom: () => void
}

export function useStickToBottom(
  containerRef: RefObject<HTMLElement | null>,
  itemCount: number,
  threshold = 24,
): StickyState
```

Both `EventFeed` and `EventTerminal` host their own scroll container and render their own pill. The hook handles:
- Listening to `scroll` on the container (cleaning up on unmount or container change)
- Updating `pinned` when the threshold is crossed
- Auto-scrolling on `itemCount` change when `pinned`
- Tracking `unreadCount` while not pinned
- Exposing `scrollToBottom()` for the pill's onClick

The pill itself is a shared presentational component (`ScrollToLatestPill`) re-rendered from each view, so the label/style logic lives in one place.

---

## Components / file map

```
frontend/
  components/
    ai-panel/
      AIPanel.tsx          # UNCHANGED — panel shell, header, footer
      EventFeed.tsx        # MODIFY — wire useStickToBottom, render pill
      EventTerminal.tsx    # MODIFY — wire useStickToBottom, render pill
      ScrollToLatestPill.tsx  # NEW — shared pill (presentational)
    stages/
      LoadingStage.tsx     # MODIFY — retokenize
  hooks/
    useStickToBottom.ts    # NEW — pin/unread/scrollToBottom hook
  __tests__/
    hooks/
      useStickToBottom.test.ts   # NEW
    components/
      ai-panel/
        ScrollToLatestPill.test.tsx  # NEW
        EventFeed.test.tsx           # NEW (or extend existing if any)
    stages/
      LoadingStage.test.tsx          # NEW — small a11y + token assertion
```

The hook is a separate file (not co-located with `EventFeed`) because both `EventFeed` and `EventTerminal` consume it.

---

## Testing strategy

### `useStickToBottom`

Unit tests via `@testing-library/react`'s `renderHook`, with a fake scroll container (e.g. a div mounted in the test or a mocked ref):

- Initial mount with empty list → `pinned: true`, `unreadCount: 0`.
- Initial mount with content shorter than container → `pinned: true`.
- After a `scroll` event lifts past the threshold → `pinned: false`, `unreadCount: 0`.
- After `itemCount` increments while lifted → `pinned: false`, `unreadCount` increments by exactly the delta.
- After scrolling back within threshold → `pinned: true`, `unreadCount: 0`.
- After calling `scrollToBottom()` → `pinned: true`, `unreadCount: 0`, scroll container's `scrollTop` advanced to the bottom.
- Threshold is configurable (pass `threshold = 0` and assert exact-bottom behavior).

### `ScrollToLatestPill`

- Renders `↓ 3 new` when `unreadCount={3}`.
- Renders `↓ 1 new` when `unreadCount={1}`.
- Renders `↓ Scroll to bottom` when `unreadCount={0}`.
- `aria-label` matches visible text.
- `onClick` calls the supplied callback.

### `EventFeed` / `EventTerminal` integration

- Snapshot or DOM assertion that the pill is mounted as a child of the scroll container (so it's clipped/styled correctly).
- Pill is not rendered when the hook reports `pinned: true`.
- Smoke test that `useStickToBottom` is invoked with `events.length`.

### `LoadingStage`

- Renders text `Loading your dataset…` (ellipsis character, not three dots).
- Spinner has `role="status"` and `aria-label="Loading"`.
- Spinner element's `classList` contains `border-brand-primary` (jsdom doesn't compute Tailwind CSS — class presence is the regression signal).

### Full suite baseline

After this stage's tests land:
- Baseline at end of Stage 2: 85 passing, 1 failing (pre-existing `useAIStream` failure).
- Stage 3 should not change the 1-failing number. Tests added here should all pass.

---

## Behavior matrix (summary)

| Scenario | Pinned? | Pill visible? | Pill label |
|---|---|---|---|
| Initial mount, 0 events | yes | no | — |
| Initial mount, content < viewport | yes | no | — |
| Stream of events while user passive | yes | no | — |
| User scrolls up, no new events arrive | no | yes | `Scroll to bottom` |
| User scrolls up, 1 new event arrives | no | yes | `1 new` |
| User scrolls up, N new events arrive | no | yes | `N new` |
| User scrolls back to bottom | yes | no | — |
| User clicks pill | yes | no | — |
| User switches Feed ↔ Terminal while pinned | yes (re-evaluated) | no | — |
| User switches Feed ↔ Terminal while lifted | re-evaluated from new container | per state | per state |

---

## Component boundaries (recap)

- **`useStickToBottom(ref, itemCount, threshold?)`** — owns scroll/pin/unread state. No DOM rendering. No knowledge of the AI panel.
- **`<ScrollToLatestPill unreadCount onClick />`** — owns the pill's appearance and label logic. No knowledge of scroll.
- **`<EventFeed events>`** — wires the hook + the pill into the cards container. Also handles the existing card rendering (unchanged).
- **`<EventTerminal events>`** — wires the hook + the pill into the terminal container. Same shape as EventFeed.
- **`<LoadingStage>`** — stage content, no dependencies beyond Lucide if we want an icon (we don't — keep the spinner CSS-only).

---

## Risks / open notes

- **Smooth scroll on auto-pin:** `scrollIntoView({ behavior: 'smooth' })` is supported across modern browsers but if the user has `prefers-reduced-motion`, the browser will silently fall back to instant scroll — fine.
- **Event de-duping:** the unread counter strictly increments on `events.length` change. If `useAIStream` ever replaces the array reference without changing length, no increment fires. This is correct.
- **First mount delay:** if the panel mounts before any events arrive (which is the common case), the empty state means we never enter "lifted" until something to scroll exists. Good.
- **Pill content via the `aria-live` attribute** will be announced by screen readers; we accept that as a feature, but if anyone reports it as noisy we can drop to `aria-live="off"` and rely on the visual affordance alone.

---

## Figma reference

- `117:209` (Load / Default) — the canonical Load stage view; pinned state, no pill.
- `118:239` (AIPanel / Pill / 3 new) — close-up showing the pill in unread state; partial top card hints at scroll-up.
- `118:293` (AIPanel / Pill / Scroll to bottom) — same close-up, no-unread state.

All three frames live on page `02 — Foundation` of `gsnW43uSpvdLpwandZM8Zx`. The Load frame stacks at `(80, 3100)`; pill close-ups at `(1600, 3100)` and `(2000, 3100)`.
