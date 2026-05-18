# Sessions List Redesign — Session Handoff (2026-05-18)

This doc hands off to a fresh Claude session. Read it top-to-bottom before doing anything else.

## TL;DR for the next session

The Round 2 / Stage 2 redesign (sessions list home page) is **fully specced, designed in Figma, and planned — but not yet implemented in code**. The plan is committed; the execution is the next step. The user chose **subagent-driven execution** in the prior session.

The very next action is: invoke `superpowers:subagent-driven-development` and dispatch the first implementer subagent for Phase 0 / Task 0.1 of the plan.

## Where you are in the bigger arc

The codebase is mid-way through a multi-stage redesign of the DQ Accelerator frontend, swappable per-client (UDig default, Clayton Homes second brand). Status:

| Round | What | Tag |
|---|---|---|
| Round 1 | Foundation: theme system, tokens, workspace chrome | `foundation-v1` |
| Round 2 / Stage 1 | Rules stage redesign (RulesStage + RuleCard + dimension chips + bulk select + Lucide icons + RGB-triplet token system) | `rules-stage-v1` |
| Round 2 / Stage 2 | **Sessions list redesign (home page + SessionCard)** — currently here, plan written, not executed | (unset, will be `sessions-list-v1`) |
| Round 2 / Stage 3+ | Load, Profile, Explore, Validate, Triage, Plan, Transform, Scorecard, Pipeline — one stage per cycle | (future) |

The user explicitly chose **one-stage-per-cycle in order from the beginning of the app**. We're going stage-by-stage; Stage 2 is sessions because it's the entry point.

## Where everything lives

| Asset | Location |
|---|---|
| Git repo (this worktree) | `/Users/anjani.dabkara/ai-dq-accelerator/.claude/worktrees/nifty-jang-40768d` |
| Git branch | `claude/nifty-jang-40768d` |
| User's primary checkout (where `next dev` runs) | `/Users/anjani.dabkara/Downloads/GitHub/ai-dq-accelerator` |
| Stage 2 spec | `docs/superpowers/specs/2026-05-18-sessions-list-redesign.md` (commit `41dcf26`) |
| Stage 2 plan | `docs/superpowers/plans/2026-05-18-sessions-list-redesign.md` (commit `c6f3545`) |
| Stage 1 spec | `docs/superpowers/specs/2026-05-17-rules-stage-redesign.md` |
| Stage 1 plan | `docs/superpowers/plans/2026-05-18-rules-stage-redesign.md` |
| Original Foundation spec | `docs/superpowers/specs/2026-05-14-figma-roundtrip-redesign-design.md` |
| Original Foundation plan | `docs/superpowers/plans/2026-05-14-figma-foundation-roundtrip.md` |
| Figma file | `https://www.figma.com/design/gsnW43uSpvdLpwandZM8Zx/DQ-Accelerator` |
| Figma file key | `gsnW43uSpvdLpwandZM8Zx` |
| Round 2 / Stage 2 Figma frames (page 02) | `Sessions / 1440x900 / Populated` (`109:194`), `Sessions / 1440x900 / Empty` (`109:327`) |
| Round 2 / Stage 1 Figma frames (page 02) | `Rules / Main / Default` (`73:72`), `Rules / Main / Selection Mode` (`73:180`) |
| Foundation Figma shells (page 02) | `Shell / 1440x900 / UDig / v4` (`48:74`), `Shell / 1440x900 / Clayton Homes / v4` (`48:181`) |
| Figma tokens snapshot | `docs/superpowers/figma-tokens-snapshot.md` |
| Original foundation handoff (for context) | `docs/superpowers/context-handoff/2026-05-15-figma-foundation-handoff.md` |

**Worktree note:** the user's `next dev` runs from their primary checkout (`~/Downloads/GitHub/ai-dq-accelerator`), not from the worktree. They pull this branch into the primary checkout for testing via:

```bash
cd ~/Downloads/GitHub/ai-dq-accelerator
git pull /Users/anjani.dabkara/ai-dq-accelerator claude/nifty-jang-40768d --ff-only
```

`git fetch` won't work because they're already sitting on that branch in the primary checkout (git refuses to fetch into a checked-out branch). Pull from the worktree's local clone path is the workaround.

## Decisions already locked

### Scope of Stage 2 (visual parity + small additions)

The user chose "visual parity — retokenize + reuse the workspace shell, keep behavior the same". Within that, three Figma iterations bolted on:
1. **Stage chips use the dimension-chip pattern** (soft tinted 15% fill + `-deep` text, no border, `px-2 py-1 rounded-md`) — **NOT** the score-chip border pattern in the original spec. The plan reflects this.
2. **The list is split into `IN PROGRESS` and `COMPLETE` sections**, each with its own grid. Sections only render when their group has at least one card.
3. **Cards show a per-stage detail line** under the date — `14 rules awaiting decision`, `Running validations…`, `+18% over baseline`, etc. Sourced from a new `stageDetail()` helper.

### Stage→category palette

- `awaiting` → warning (amber): `AWAITING_*`, `RULE_REVIEW`, `PROFILING_SYNTHESIS`
- `progress` → info (blue): `LOADING`, `PROFILING`, `REINVESTIGATING`, `VALIDATING`, `TRIAGING`, `PLANNING`, `TRANSFORMATION_LOOP`, `GENERATING`
- `complete` → success (green): `COMPLETE`
- Unknown stage → falls back to `progress` (safer than awaiting, which visually shouts for action)

### Empty state copy + CTA

- Lucide `UploadCloud` icon (28px) in a 64×64 `bg-elevated rounded-full` chip
- Headline: "Start your first data quality session" (16px font-semibold)
- Body: "Upload a CSV, Parquet, or JSON file. AI will profile it, suggest rules, and walk you through cleanup." (13px text-fg-muted, center)
- CTA: primary `brand-accent` button "Upload a dataset" with Lucide `Upload` icon

### Chrome — simplified TopBar (homepage variant)

- 56px tall, `bg-surface`, `border-b border-border`
- Logo (theme-aware) + "DQ Accelerator" title on the left
- Spacer
- Primary `New session` CTA on the right (Lucide `Upload` icon + label, `brand-accent` fill)
- Lives at `frontend/components/sessions/SessionsTopBar.tsx` — **separate from** the workspace `TopBar.tsx`. They diverge enough that abstracting now would be premature.

### Removed from the original design

- The inline dashed "Upload a dataset" tile in the session grid — gone. Header CTA + empty-state CTA are the only creation affordances.
- The single "RECENT SESSIONS" label — replaced by the two section labels.

## Component / file map for Stage 2

```
frontend/
  app/
    page.tsx                                   # MODIFY — full rewrite
  components/
    sessions/
      SessionCard.tsx                          # MODIFY — full rewrite
      EmptyState.tsx                           # NEW
      SessionsTopBar.tsx                       # NEW
      UploadModal.tsx                          # UNCHANGED
  lib/
    stages.ts                                  # NEW — STAGE_LABELS + stageCategory + stageDetail
  __tests__/
    lib/stages.test.ts                         # NEW
    components/sessions/
      SessionCard.test.tsx                     # NEW
      EmptyState.test.tsx                      # NEW
```

`@/` resolves to `frontend/`. `lib/` is in the Tailwind content glob (added during Round 2 / Stage 1 as a hotfix).

## How to execute the plan

The plan in `docs/superpowers/plans/2026-05-18-sessions-list-redesign.md` is structured as **5 phases producing 4 commits**:

1. **Phase 0** — `lib/stages.ts` + test (one commit)
2. **Phase 1 + 2** — `SessionsTopBar` + `EmptyState` + test (one commit)
3. **Phase 3** — `SessionCard` rewrite + test (one commit)
4. **Phase 4** — `page.tsx` rewrite (one commit)
5. **Phase 5** — manual smoke test + optional tag

User-confirmed execution preference: **subagent-driven**. The Rules stage was executed the same way; pattern is:

- One implementer subagent per task (small/mechanical tasks use Haiku; larger ones use Sonnet)
- No per-task reviews; one final code review at Phase 4 end
- One commit per logical group (the plan's commit cadence already groups them)
- Smoke test via a temporary preview route was used for the Rules stage — for sessions the existing `/` route exercises everything, so **no preview route needed this time**.

### Recommended first dispatch

Phase 0 (the stages utility + test) is small and mechanical. Dispatch a Haiku implementer with the full text of Task 0.1 + 0.2 in one subagent — they'll write the test, run it (failing), write the impl, run again (passing), and commit. Then move to Phase 1 + 2 in a second dispatch.

## Critical caveats / pitfalls

- **`stageDetail()` reads optional fields not currently on `SessionListEntry`.** The helper looks for `rule_count`, `finding_count`, `baseline_score`, `current_score`. Today's `SessionListEntry` only has `current_score` and `baseline_score` (verify in `frontend/lib/types.ts`). Until the backend adds `rule_count` and `finding_count`, the detail line will fall back to generic messages ("Awaiting rule decisions" instead of "14 rules awaiting decision"). The helper handles missing fields gracefully — no runtime errors. The test uses `as SessionListEntry` casts to add the extra fields for assertions. This is intentional: backend can extend the type later without code changes.

- **The `RGB-triplet color system** (Round 2 / Stage 1 hotfix) means CSS variables are space-separated triplets, not hex. Theme provider runtime + globals.css both write in this format. Don't be surprised. Documented in `docs/superpowers/figma-tokens-snapshot.md`.

- **Tailwind content glob** includes `./lib/**/*.{ts,tsx}` — added in Stage 1 hotfix `4818b15`. The new `stages.ts` lives there and its class-name string constants depend on this glob.

- **lucide-react 1.x exports icons as forwardRef objects** — `typeof require('lucide-react').Check === 'object'` (not `'function'`). The Stage 1 plan had a verify step that asserted `function`; it's been corrected in this stage's plan.

- **Pre-existing test failures:** `__tests__/hooks/useAIStream.test.ts` and `__tests__/hooks/useSessionList.test.ts` have failures that **predate Round 1**. Confirmed unrelated. Baseline: 64 of 65 tests pass. Stage 2 should keep that baseline (plus the new tests passing).

- **Figma component IDs may shift** if components are re-created. Re-query via `mcp__figma__get_metadata` against `gsnW43uSpvdLpwandZM8Zx` if anything looks wrong. Components used by Stage 2 frames:
  - `Logo` (`21:8`), theme-aware
  - `StageChip` (`90:17`), 3 variants — soft fill + deep text, padding 8×4, rounded-md
  - `PrimaryButton` (`107:28`), variant set with `icon=arrow-right | upload | download`
  - `SessionsTopBar` is **inline** on each shell, not a Figma component

## Outstanding user prompt

The user's most recent message was: "let's consolidate the context we need so I can continue in a new session". So **this handoff doc IS the response to that.**

When the new session starts, it should:

1. Invoke `superpowers:using-superpowers` (auto on first message).
2. Read **this handoff doc** first, then the spec + plan for Stage 2.
3. Acknowledge the handoff and confirm: "Ready to dispatch the first subagent for Phase 0?"
4. On confirmation, invoke `superpowers:subagent-driven-development` and start dispatching.

## Branch state at handoff

20 commits ahead of `b19e009` (the original session-handoff commit), 2 tags placed:

```
foundation-v1 → 2f1efc9   self-review fixes
rules-stage-v1 → e811394   chore: remove preview route
HEAD           → c6f3545   docs: Round 2 Stage 2 plan
```

To resume in a new session, point Claude at this worktree (`/Users/anjani.dabkara/ai-dq-accelerator/.claude/worktrees/nifty-jang-40768d`) and tell it to read this doc.
