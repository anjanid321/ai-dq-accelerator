# Round 2 / Triage Stage + Post-Chip-System Handoff (2026-05-19)

This doc hands off to a fresh Claude session. Read it top-to-bottom before doing anything else.

## TL;DR for the next session

Round 2 / Stage 7 (Triage stage) is **specced but not yet planned or implemented**. The spec is committed at `f6aee0a`. The user approved the design and the next action is: **invoke `superpowers:writing-plans` to produce the implementation plan, then Figma-first subagent-driven execution per the established Validate / Upload Modal cadence.**

Everything before Stage 7 has shipped and is tagged. The chip-system consolidation also landed this session.

## Where you are in the bigger arc

Round 2 is the multi-stage frontend redesign of the DQ Accelerator (UDig default + Clayton Homes second brand).

| Round / Stage | Tag | Status |
|---|---|---|
| Foundation | `foundation-v1` | shipped |
| Stage 1 — Rules | `rules-stage-v1` | shipped |
| Stage 2 — Sessions list | `sessions-list-v1` | shipped |
| Stage 3 — Load + AI panel auto-scroll | `load-stage-v1` | shipped |
| Stage 4 — Profile | `profile-stage-v1` | shipped |
| Stage 5 — Explore | `explore-stage-v1` | shipped |
| Mini — Mock dataset | (no tag) | shipped |
| Mini — Upload Modal | `upload-modal-v1` | shipped |
| Stage 6 — Validate | `validate-stage-v1` | shipped |
| Mini — Chip system consolidation | `chip-system-v1` | shipped |
| **Stage 7 — Triage** | (unset, will be `triage-stage-v1`) | **spec done, plan + execute next** |
| Stages 8+ — Plan, Transform, Scorecard, Pipeline | — | future |

Pattern: one stage at a time, in workflow order. Triage sits between Validate and Plan.

## Where everything lives

| Asset | Location |
|---|---|
| Git repo (this worktree) | `/Users/anjani.dabkara/ai-dq-accelerator/.claude/worktrees/kind-brattain-7675b4` |
| Git branch | `claude/kind-brattain-7675b4` |
| Git HEAD at handoff | `f6aee0a` |
| User's primary checkout (where `npm run dev` runs) | `/Users/anjani.dabkara/Downloads/GitHub/ai-dq-accelerator` |
| **Triage spec (just written)** | `docs/superpowers/specs/2026-05-19-triage-stage-redesign.md` (commit `f6aee0a`) |
| Triage plan | not written yet — `writing-plans` skill is the next action |
| Validate spec / plan (reference) | `docs/superpowers/specs/2026-05-19-validate-stage-redesign.md` / `plans/2026-05-19-validate-stage-redesign.md` |
| Chip-system spec / plan (just shipped) | `docs/superpowers/specs/2026-05-19-chip-system-design.md` / `plans/2026-05-19-chip-system.md` |
| Earlier specs | All under `docs/superpowers/specs/` |
| Earlier plans | All under `docs/superpowers/plans/` |
| Previous handoff (Stage 5 era) | `docs/superpowers/context-handoff/2026-05-19-explore-stage-handoff.md` |
| Figma file | `https://www.figma.com/design/gsnW43uSpvdLpwandZM8Zx/DQ-Accelerator` |
| Figma file key | `gsnW43uSpvdLpwandZM8Zx` |
| Validate Figma frame (page 02) | `Validate / 1440x900 / Default` (`230:306`) at (80, 6700) |
| Upload Modal Figma frame (page 02) | `UploadModal / 480x369 / Default` (`223:306`) at (80, 6100) |
| Explore Figma frame (page 02) | `Explore / 1440x900 / Default` (`147:269`) at (80, 5100) |
| Triage Figma frame slot (page 02) | `Triage / 1440x900 / Default` planned at (80, 7700) — not yet created |
| Foundation token snapshot | `docs/superpowers/figma-tokens-snapshot.md` |
| Demo route (no backend needed) | `frontend/app/demo/page.tsx` + fixtures in `frontend/app/demo/_fixtures/mock-session.ts` |

**Worktree note:** the user's `npm run dev` runs from their primary checkout. They pull this branch into the primary checkout via:

```bash
cd ~/Downloads/GitHub/ai-dq-accelerator
git pull /Users/anjani.dabkara/ai-dq-accelerator claude/kind-brattain-7675b4 --ff-only
git fetch /Users/anjani.dabkara/ai-dq-accelerator 'refs/tags/*:refs/tags/*'
```

`git fetch` won't work because the primary checkout is already sitting on the same branch.

## Triage stage — exactly what was approved

Read `docs/superpowers/specs/2026-05-19-triage-stage-redesign.md` for the full spec. Key locked decisions:

- **Scope:** "Retokenize + match Rules card chrome" (visual parity + token swap + decision-driven outline+ring on rule cards).
- **Card chrome** (matches Rules approved/denied pattern from commit `04ce1d4` on Validate):
  - `pending` / no-decision-required → `border-border` (no ring)
  - `accept` decision → `border-success ring-1 ring-success/40`
  - `keep` decision → `border-danger ring-1 ring-danger/40`
  - **Drops the left-side `border-l-{class}/60` accent** — the chip on top-left + the chrome carry the signal.
- **Classification → Chip tone** (using the chip-system-v1 primitive):
  - `transform_fixable` → `success` "Transform Fixable"
  - `threshold_too_strict` → `warning` "Threshold Too Strict"
  - `unfixable` → `danger` "Unfixable"
  - `eval_error` → `warning` "Eval Error" (split from danger — technical issue, not a data-quality verdict; the destructive "remove rule" action still uses `text-danger-deep`)
- **Filter tabs:** compact buttons in a horizontal row (no chip refactor). Active = `bg-brand-primary text-on-brand`, inactive = `bg-surface border-border text-fg-muted` with hover.
- **Decision buttons** use the Rules vocabulary:
  - Active Accept: `bg-success-deep border-success-deep text-on-brand`
  - Inactive Accept: `bg-surface border-success text-success-deep hover:bg-success/10`
  - Active Keep: `bg-danger-deep border-danger-deep text-on-brand`
  - Inactive Keep: `bg-surface border-danger text-danger-deep hover:bg-danger/10`
  - Lucide `Check` + `X` icons (not literal glyphs).
- **Submit bar** keeps today's sticky structure, uses primary navy button + lucide `ArrowRight`.
- **Summary card** keeps the colored-dot pattern but at full alpha (`bg-success` not `bg-success/60`).
- **Loading state** uses the brand-primary spinner with `role="status"` + `aria-label="Triaging"`, drops the "AI panel shows live progress" hint.
- **Confidence text** stays inline (not a chip) — `text-success-deep` / `text-warning-deep` / `text-fg-muted`.
- **No behavior changes.** Same Props, same data extraction, same submit payload.

The spec includes a complete "What changes vs. today" table (~30 rows) and a behavior matrix.

## Execution preference (user-locked from earlier stages)

- **Figma-first** for stages: build the Figma frame BEFORE the code (validates the visual before code commits).
- **Subagent-driven** execution. One implementer subagent per phase. Haiku for mechanical phases, Sonnet for multi-file integration phases.
- **No per-task reviews.** ONE final cross-stage code-reviewer pass at the end before the tag.
- **Tag after the code lands**; mirror the Figma frame BEFORE the tag (per the Figma-first preference) but Figma updates can also be batched as a separate session via `spawn_task` (the user has done both patterns).

## Recommended next-action sequence

1. Read this handoff (you're doing that now).
2. Read `docs/superpowers/specs/2026-05-19-triage-stage-redesign.md` in full.
3. Invoke `superpowers:writing-plans` and produce the implementation plan at `docs/superpowers/plans/2026-05-19-triage-stage-redesign.md`. Mirror the Validate plan's phase structure:
   - **Phase 0** — Build the Triage Figma frame at slot (80, 7700) on page `02 — Foundation` using `mcp__6fb33dc5-...__use_figma`. Reference the Validate build script (commit `21de360` neighborhood, frame `230:306`). Use foundation variable IDs from the caveats below.
   - **Phase 1** — TDD rewrite of `frontend/components/stages/TriageStage.tsx` with ~16 integration tests at `frontend/__tests__/stages/TriageStage.test.tsx`. Sonnet implementer.
   - **Phase 2** — Demo wiring: add `DEMO_TRIAGE_SESSION` fixture to `frontend/app/demo/_fixtures/mock-session.ts`, advance `ACTIVE_STAGE` in `frontend/app/demo/page.tsx` from `'validate'` to `'triage'`, wire the real `TriageStage` into the workspace switch. Haiku implementer.
   - **Phase 3** — Manual verification → `superpowers:code-reviewer` final pass → tag `triage-stage-v1`.
4. Get user execution-mode approval (subagent-driven recommended).
5. Execute.

## /demo current state

The persistent walkthrough lives at `/demo`. After Validate + chip-system shipped:

- **Landing:** sessions list with 4 mock entries (`SessionCard` variants).
- **Click any card → workspace shell** with `ACTIVE_STAGE = 'validate'`. Stepper shows Load / Profile / Explore / Rules with green checks; Validate active (orange); Triage / Plan / Transform / Scorecard / Pipeline locked.
- **Stages walkable:** Load, Profile, Explore, Rules, Validate. Each renders the real component with frozen mock data from `mock-session.ts`.
- **Out-of-scope stages** (Triage onward) render a placeholder. After Stage 7 ships, Triage moves into the walkable set and `ACTIVE_STAGE` advances to `'triage'` (Validate becomes a clickable past stage).
- **UploadModal** with `demoMode` opens from the "+ New session" button.

When the new session lands Stage 7, follow the established demo-wiring pattern: advance `ACTIVE_STAGE`, add the fixture, render the real component.

## Chip system (just shipped)

`chip-system-v1` consolidated 9 ad-hoc chip patterns into a single primitive at `frontend/components/ui/Chip.tsx` with three variants:

- **`status`** — semantic soft-fill, NO border. Tones: `success`, `warning`, `danger`, `info`, `accent-purple`, `accent-indigo`, `neutral`. Used for stage statuses, alert types, validation results, AI event kinds, DQ dimensions. Bundle includes WCAG AA contrast fix: `success-deep` darkened to `#166534`, `warning-deep` to `#92400E`.
- **`neutral`** — `bg-elevated + border + text-fg-muted`. Optional `value` slot for label+value pairs (e.g. `<Chip variant="neutral" value="78%">validity</Chip>`). Used for Round counter, file-type chips, category labels.
- **`score`** — outline-only `rounded-full` pill. Intentional exception for the TopBar score readout.

All chip messaging is Title Case (`Passed` / `Failed · N` / `Eval Error` / `Tool Call` / etc., not UPPERCASE).

When Triage migrates, use `<Chip variant="status" tone={...}>` for classification badges — don't introduce ad-hoc chip class strings.

## Queued follow-ups (chips spawned for separate sessions)

Two Figma sync tasks have been spawned via `mcp__ccd_session__spawn_task`. They show as chips in the user's UI:

1. **"Sync chip + token changes across Figma frames"** — broad chip-system mirror across all existing frames (Rules / Sessions / Load / Profile / Explore / Validate / Upload Modal). Pre-dates the Validate card-chrome change.
2. **"Mirror Validate card chrome to Figma"** — narrow Validate-only update to swap the single-side accent for the outline + ring pattern. From commit `04ce1d4`.

Both are independent — user starts whichever first. New session shouldn't re-spawn these.

Also still queued from earlier in the arc:
- **Live-app `/sessions` 500** — backend POST `/api/v1/sessions` returns 500 when uploading the mock CSV. Root-cause not investigated (likely stale Docker container / DB schema mismatch). User explicitly paused this work in favor of `/demo` route. Backend logs needed to root-cause.

## Decisions locked across the recent session

### Validate card chrome (commit `04ce1d4`)

The Validate rule cards swap their single-side `border-l-{tone}-deep` accent for the Rules approved/denied pattern: `border-{tone} ring-1 ring-{tone}/40` (full outline + soft ring glow). Tones: success for Passed, danger for Failed, warning for Eval Error. The Triage stage adopts the same pattern (driven by decision state instead of pass/fail state).

### Chip system (tagged `chip-system-v1`)

See above. Locked decisions during brainstorm:
1. Status chips have NO border (full soft-fill).
2. AI event badges unify with status chips — no font-mono / uppercase / tracking-wide.
3. TopBar Score chip stays distinct (outline-only `rounded-full`).
4. WCAG fix bundled in (success-deep + warning-deep darkened).
5. Title Case all chip messaging.

## Critical caveats / pitfalls

- **Pre-existing test baseline.** `__tests__/hooks/useAIStream.test.ts` has one failing test that predates Round 1. `__tests__/hooks/useSessionList.test.ts` is a placeholder file with no tests (jest reports the suite as failed because of zero tests, but no actual test fails). Going-in baseline at the start of Stage 7: **206 passing / 1 failing**. After Stage 7 expect ~222 passing / 1 failing.

- **Pre-existing `.next/types/validator.ts` warning** on `tsc --noEmit`. Stale Next.js artifact, regenerated clean by `npm run build`. Not a regression — ignore.

- **Figma variable IDs** (correct ones — caught wrong during Stage 4):
  - `warning` = `6:12`, `warning-deep` = `21:3`
  - `danger` = `6:13`, `danger-deep` = `21:4`
  - `info` = `6:14`, `info-deep` = `21:5`
  - `success` = `6:11`, `success-deep` = `21:2`
  - `accent-purple` = `29:2`, `accent-purple-deep` = `29:3`
  - `brand-accent` = `5:3`, `on-brand` (`brand-on-primary`) = `5:4`
  - `bg-canvas` = `6:2`, `bg-surface` = `6:3`, `bg-elevated` = `6:4`
  - `fg` (`fg/default`) = `6:5`, `fg-muted` = `6:6`, `fg-subtle` = `6:7`
  - `border` (`border/subtle`) = `6:9`, `border-strong` = `6:10`
  - `brand-primary` (orange) = `5:2`, `brand-on-primary` (white on orange) = `5:4`

- **lucide-react v1 exports forwardRef objects, not functions.** No `typeof === 'function'` assertions on icons.

- **`use_figma` quirks** (caught while building the Validate frame in commit `21de360` era):
  - `strokeOpacity` is NOT a valid property on FRAME nodes. Use opacity baked into the SolidPaint instead (e.g. `{ type: 'SOLID', color, opacity: 0.3 }`).
  - `layoutSizingHorizontal: 'FILL'` can only be set AFTER appending the node to a parent auto-layout frame, not in the constructor.
  - For Body containers with VERTICAL children of explicit width: set `primaryAxisSizingMode = 'FIXED'` and `counterAxisSizingMode = 'FIXED'` on Body, then `layoutSizingHorizontal = 'FIXED'` + `layoutSizingVertical = 'FIXED'` + `resize(w, h)` on each child after appending.

- **Frontend `AGENTS.md` warning**: "This is NOT the Next.js you know" — Next.js 16 with Turbopack, APIs may differ from training. Stick to patterns visible in Stages 1–6.

- **`readOnly` prop is accepted-but-unused on stages with no human gate** (Validate). Triage HAS a human gate (the submit), so `readOnly` IS used there to hide decision buttons + submit bar.

- **`approveTriage` payload shape** in the existing implementation:
  ```ts
  await approveTriage(
    session.session_id,
    [{ rule_id, new_threshold }],   // accepted threshold changes
    [rule_id, ...]                  // rejected rule IDs (unfixable + eval_error accepted)
  )
  ```
  Don't change this in the redesign.

- **Don't change the Score chip variant.** Intentional exception per chip-system-v1.

## Branch state at handoff

Tags (most recent first):
```
chip-system-v1     → 98d3ebb   chore(preview): remove /demo/chips showcase
validate-stage-v1  → 142b29b   chore(demo): refresh mock-session.ts header with Validate
upload-modal-v1    → 152bcbb   feat(demo): wire UploadModal into the sessions list
explore-stage-v1   → 2d67a27   chore(preview): remove temporary Explore stage preview route
profile-stage-v1   → 0018895   chore(preview): remove temporary Profile stage preview route
load-stage-v1      → fa97d4f   feat(ai-panel): wire follow-mode into EventTerminal
sessions-list-v1   → 1c318a0   chore(preview): remove temporary sessions list preview route
rules-stage-v1     → e811394   chore(preview): remove preview route
foundation-v1      → 2f1efc9   self-review fixes
HEAD               → f6aee0a   docs: Round 2 Stage 7 — Triage stage redesign spec
```

Recent commit log (last ~20):
```
f6aee0a docs: Round 2 Stage 7 — Triage stage redesign spec
04ce1d4 style(validate): match Rules approved/denied card chrome on rule cards
98d3ebb chore(preview): remove /demo/chips showcase
5f74e25 refactor(chips): migrate every call site to Chip + title-case labels
49bd420 test(ui): add Chip primitive tests
6daca65 docs: implementation plan for chip-system
0c62f60 docs: chip-system design spec
d4c6213 chore(preview): darken success/warning deep tokens for WCAG AA + title-case showcase
3168fbd chore(preview): add temporary Chip primitive + /demo/chips showcase
142b29b chore(demo): refresh mock-session.ts header with Validate
7bfd42d chore(demo): refresh stale comments after Validate landed
1bdd0c8 feat(demo): advance walkthrough to Validate stage
21de360 feat(validate): rewrite ValidateStage to token-driven chrome
5ce4f97 docs: implementation plan for Round 2 / Stage 6 (Validate)
c475cd2 docs: Round 2 Stage 6 — Validate stage redesign spec
152bcbb feat(demo): wire UploadModal into the sessions list
e96bf3f feat(upload-modal): retokenize + add chrome and demoMode
0ac07f4 fix(demo): land workspace on the active stage, not Profile
17a8075 fix(demo): anchor stepper completion to active, not viewingStage
e7a6689 feat(demo): start /demo on the sessions list
```

No uncommitted changes in the worktree at handoff time.

## To resume in a new session

Tell the new Claude:

> Read `docs/superpowers/context-handoff/2026-05-19-triage-stage-handoff.md` in worktree `claude/kind-brattain-7675b4`, then continue.

That doc captures:
- **Current state:** Stages 1–6 + 2 mini-stages tagged + shipped, chip system shipped. Stage 7 spec at `f6aee0a`. Plan not written yet.
- **Exact next action:** invoke `superpowers:writing-plans` → then Figma-first subagent-driven execution → tag `triage-stage-v1`.
- **All decisions locked this session** — Triage scope (retokenize + match Rules card chrome), classification→tone mapping, decision-button vocabulary, filter-tab pattern, submit-bar vocabulary, Title Case throughout.
- **Queued mini-tasks** — two Figma syncs already spawned as chips; live-app /sessions 500 still paused.
- **Preview lifecycle pattern** — disposable `/demo/*` previews during iteration (chip-system-v1 used `/demo/chips` for this; dropped before tag).
- **Caveats** — pre-existing useAIStream baseline failure, Figma variable IDs, `use_figma` quirks (`strokeOpacity` invalid, FILL sizing requires parent), lucide v1 forwardRef quirk.
- **Branch/tag state at handoff.**

Branch sits at `f6aee0a` on `claude/kind-brattain-7675b4`. No uncommitted changes. Clean stopping point.
