# Explore Stage + Post-Redesign Mini-Stage — Session Handoff (2026-05-19)

This doc hands off to a fresh Claude session. Read it top-to-bottom before doing anything else.

## TL;DR for the next session

Round 2 / Stage 5 (Explore stage) is **specced and Figma-locked but not yet implemented**. The spec is at `515a9bf`. Implementation hasn't started.

The very next action is: **confirm with the user that the spec is acceptable as-is, then invoke `superpowers:writing-plans` to produce the implementation plan, then `superpowers:subagent-driven-development` to execute it.**

After Stage 5 ships, two queued tasks need to be picked up before moving to Stage 6:
1. **A11y audit + token contrast fix** — `warning-deep` / `info-deep` / `danger-deep` / `accent-purple-deep` have borderline WCAG AA contrast on the `bg-X/15` soft fills. Affects every chip across Rules, Sessions, Profile, Explore, and the AI panel cards. Single-token-level fix in `frontend/app/globals.css` should ripple everywhere.
2. **Mock dataset for real-app walkthrough** — produce a small CSV that triggers interesting profiler alerts, rule patterns, and validations so the user can walk the live app instead of stitching preview routes together.

## Where you are in the bigger arc

Round 2 is a multi-stage redesign of the DQ Accelerator frontend, swappable per-client (UDig default, Clayton Homes second brand).

| Round / Stage | Tag | Status |
|---|---|---|
| Foundation (theme, tokens, workspace chrome) | `foundation-v1` | shipped |
| Stage 1 — Rules | `rules-stage-v1` | shipped |
| Stage 2 — Sessions list | `sessions-list-v1` | shipped |
| Stage 3 — Load + AI panel auto-scroll | `load-stage-v1` | shipped |
| Stage 4 — Profile | `profile-stage-v1` | shipped |
| **Stage 5 — Explore** | (unset, will be `explore-stage-v1`) | spec done, plan + execute next |
| Mini-stage — A11y audit + token contrast fix | — | queued (post Stage 5) |
| Mini-stage — Mock dataset for real-app walkthrough | — | queued (post Stage 5) |
| Stages 6+ — Validate, Triage, Plan, Transform, Scorecard, Pipeline | — | future |

User explicitly chose **one-stage-per-cycle in order from the beginning of the app**. Stage 5 (Explore) sits between Profile and Rules in the workflow.

## Where everything lives

| Asset | Location |
|---|---|
| Git repo (this worktree) | `/Users/anjani.dabkara/ai-dq-accelerator/.claude/worktrees/flamboyant-torvalds-62637b` |
| Git branch | `claude/flamboyant-torvalds-62637b` |
| User's primary checkout (where `npm run dev` runs) | `/Users/anjani.dabkara/Downloads/GitHub/ai-dq-accelerator` |
| Stage 5 spec | `docs/superpowers/specs/2026-05-19-explore-stage-redesign.md` (commit `515a9bf`) |
| Stage 5 plan | not written yet — `writing-plans` skill is next |
| Stage 4 (Profile) spec / plan | `docs/superpowers/specs/2026-05-19-profile-stage-redesign.md` / `plans/2026-05-19-profile-stage-redesign.md` |
| Stage 3 spec / plan | `docs/superpowers/specs/2026-05-18-load-stage-and-ai-panel-scroll.md` / same in plans |
| Stage 2 spec / plan | `docs/superpowers/specs/2026-05-18-sessions-list-redesign.md` / plans |
| Stage 1 spec / plan | `docs/superpowers/specs/2026-05-17-rules-stage-redesign.md` / plans |
| Foundation spec / plan | `docs/superpowers/specs/2026-05-14-figma-roundtrip-redesign-design.md` / plans |
| Figma file | `https://www.figma.com/design/gsnW43uSpvdLpwandZM8Zx/DQ-Accelerator` |
| Figma file key | `gsnW43uSpvdLpwandZM8Zx` |
| Stage 5 Figma frame (page 02) | `Explore / 1440x900 / Default` (`147:269`) at (80, 5100) |
| Stage 4 Figma frame (page 02) | `Profile / 1440x900 / Default` (`131:239`) at (80, 4100) |
| Stage 3 Figma frames (page 02) | `Load / 1440x900 / Default` (`117:209`) + pill close-ups (`118:239`, `118:293`) |
| Stage 2 Figma frames (page 02) | `Sessions / Populated` (`109:194`), `Sessions / Empty` (`109:327`) |
| Stage 1 Figma frames (page 02) | `Rules / Main / Default` (`73:72`), `Rules / Main / Selection Mode` (`73:180`) |
| Foundation Figma shells (page 02) | `Shell / UDig` (`48:74`), `Shell / Clayton` (`48:181`) |
| Foundation token snapshot | `docs/superpowers/figma-tokens-snapshot.md` |
| Previous handoff (Stage 2 era) | `docs/superpowers/context-handoff/2026-05-18-sessions-list-handoff.md` |
| Original foundation handoff | `docs/superpowers/context-handoff/2026-05-15-figma-foundation-handoff.md` |

**Worktree note:** the user's `npm run dev` runs from their primary checkout. They pull this branch into the primary checkout via:

```bash
cd ~/Downloads/GitHub/ai-dq-accelerator
git pull /Users/anjani.dabkara/ai-dq-accelerator claude/flamboyant-torvalds-62637b --ff-only
```

`git fetch` won't work because the primary checkout is already sitting on the same branch (git refuses to fetch into a checked-out branch). To pull tags too:

```bash
git fetch /Users/anjani.dabkara/ai-dq-accelerator 'refs/tags/*:refs/tags/*'
```

## Decisions locked this session

### Stage 5 (Explore) — scope

- **Visual parity + retokenize only.** No layout reworks, no new features.
- Re-investigate button = **neutral outlined secondary** (`bg-surface border-border text-fg-muted` + hover swap). The default action is Approve; Re-investigate should not compete visually.
- Approve & Continue button = the established **primary-button class** (`bg-brand-accent text-on-brand text-[13px] font-semibold px-4 py-2 rounded-md hover:bg-brand-accent/90 hover:shadow-md transition-all`) with lucide `ArrowRight` icon on the right.
- Open Questions card = **dimension-chip pattern** (`bg-warning/15 border-warning/30` + `text-warning-deep`) — matches Stage 4 alerts semantically.
- Constraint warning = same pattern, danger tones.
- Round chip = **neutral elevated chip** (`text-[11px] font-semibold text-fg-muted bg-elevated border border-border px-2 py-0.5 rounded-md`).
- Notebook download link = `fg-muted hover:fg` text with lucide `Download` icon (no literal `↓`).
- All loading spinners use `border-brand-primary` (matches Load + Profile loading patterns).
- `role="status"` + `aria-label` on every spinner.
- No internal helpers extracted from `ExplorationStage` — the file is 218 lines today, ~150 after the rewrite. Small enough to stay one file.

### Post-Stage-5 plan (locked)

- **A11y audit + token contrast fix is the next mini-stage after Stage 5 ships.** The chip palette (`text-warning-deep` on `bg-warning/15` etc.) is borderline for WCAG AA 4.5:1 on small text. Single-token fix should propagate.
- Use `design:accessibility-review` skill for the actual audit.
- **Then** generate a mock dataset (`task #19` in the task list) and shift to real-app walkthroughs going forward.
- **Per-stage preview pattern stays for in-progress iterations.** User explicitly wants the existing pattern: spot-build `/preview/{stage}` during a stage's iteration cycle, drop it before tagging. The Profile preview at `b0d360d` / removed at `0018895` is the reference example.

### Stage 5 in particular — preview lifecycle

The plan should include building `frontend/app/preview/explore/page.tsx` during implementation (so the user can review before tagging), then a `chore(preview): remove temporary Explore stage preview route` commit before the `explore-stage-v1` tag — same lifecycle as the Profile preview.

## Stepper / stage state during Explore

The Explore stage is shown while the workflow is in one of:
- `AWAITING_INVESTIGATION_REVIEW` — notebook ready, user can Approve or Re-investigate (this is the most common state)
- `REINVESTIGATING` — agent is investigating again
- `PROFILING_SYNTHESIS` — agent is writing the data passport

The Figma frame at `147:269` shows the **AWAITING_INVESTIGATION_REVIEW** state — notebook ready, waiting for the human. Stepper has Load + Profile completed (green ✓), Explore active (orange + bold).

## Component / file map for Stage 5

```
frontend/
  components/
    stages/
      ExplorationStage.tsx                 # MODIFY — full rewrite (~150 lines after)
  app/
    preview/
      explore/
        page.tsx                           # NEW — temporary preview route, drop before tag
  __tests__/
    stages/
      ExplorationStage.test.tsx            # NEW
```

Path alias `@/` → `frontend/`. Tailwind content glob already covers all of these.

## How to execute the plan (once written)

User-confirmed execution preference: **subagent-driven**.

- Three-or-fewer-phase cadence (Stage 4 used three phases / commits).
- One implementer subagent per phase. Use **Haiku** for small/mechanical phases, **Sonnet** for the multi-file integration phase.
- **No per-task reviews** — user-locked pattern. ONE final cross-stage code review at the end via `superpowers:code-reviewer`.
- A `/preview/explore` route gets added in an implementation phase and removed in a chore commit before the tag.
- After the final review approves: tag `explore-stage-v1`.

## Critical caveats / pitfalls

- **`text-warning-deep` on `bg-warning/15` contrast is borderline WCAG AA.** Acknowledged in the Stage 5 spec's "Open notes" as deferred to the next mini-stage. Do NOT try to fix it during Stage 5 — it's a token-level fix that ripples to every chip in Rules, Sessions, Profile, Explore, and the AI panel. Out-of-scope for this stage.

- **Figma variable IDs.** I caught during Stage 4 that the variable IDs I'd been assuming for some semantic tokens were wrong. The actual IDs:
  - `warning` = `6:12`, `warning-deep` = `21:3`
  - `danger` = `6:13`, `danger-deep` = `21:4`
  - `info` = `6:14`, `info-deep` = `21:5`
  - `success` = `6:11`, `success-deep` = `21:2`
  - `accent-purple` = `29:2`, `accent-purple-deep` = `29:3`
  - `brand-accent` = `5:3`, `brand-on-primary` (`on-brand`) = `5:4`
  - `bg-canvas` = `6:2`, `bg-surface` = `6:3`, `bg-elevated` = `6:4`
  - `fg` (`fg/default`) = `6:5`, `fg-muted` = `6:6`, `fg-subtle` = `6:7`
  - `border` (`border/subtle`) = `6:9`, `border-strong` = `6:10`
  - `brand-primary` (orange) = `5:2`, `brand-on-primary` (white on orange) = `5:4`
  Visual fallback colors are forgiving so frames render correctly even when the binding misses, but theme-swap to Clayton only works on properly-bound nodes.

- **Manual user spacing iteration pattern.** During Stage 4 the user manually adjusted Figma frame spacing (Main padding, alerts gap, alert row padding, etc.) and asked me to mirror those into the React code. The pattern: I re-inspect the Figma frame's autolayout properties, build a diff vs. the React markup, apply Tailwind class changes. Reference commit: `12f9e97`. The Stage 5 plan should anticipate one round of this.

- **Pre-existing test failure baseline.** `__tests__/hooks/useAIStream.test.ts` has one failing test that predates Round 1. Going-in baseline at the start of Stage 5: **139 passing / 1 failing**. After Stage 5 expect ~150–155 passing / 1 failing.

- **Pre-existing `tsc --noEmit` warning.** `.next/types/validator.ts` references a stale `app/preview/sessions/page.js` from a deleted route in Stage 2. Regenerated cleanly by `npm run build`. Not a regression — ignore in implementer reports.

- **lucide-react v1 exports forwardRef objects, not functions.** No `typeof === 'function'` assertions on icons.

- **Polling pattern.** Today's `ExplorationStage` has a stale-closure quirk in its 3-second poll interval cleanup. The rewrite **preserves the existing behavior verbatim** — don't try to fix the closure in this stage. If it becomes a real problem, separate task.

## Outstanding user prompt

The user's most recent message was a request to consolidate context for a fresh session. **This handoff doc IS the response to that.**

Before the user requested the handoff, the open question was: "Spec at `515a9bf` good to move forward, or want any changes first?" They never explicitly approved or rejected it — they pivoted to asking about preview strategy. The next session should:

1. Invoke `superpowers:using-superpowers` (auto on first message).
2. Read **this handoff doc** first.
3. Read `docs/superpowers/specs/2026-05-19-explore-stage-redesign.md`.
4. Ask the user: "Spec at `515a9bf` looks good to move forward, or want any changes?"
5. On approval: invoke `superpowers:writing-plans` to produce the implementation plan.
6. After the plan is committed and user-approved, invoke `superpowers:subagent-driven-development`.

## Branch state at handoff

```
profile-stage-v1 → 0018895   chore(preview): remove temporary Profile stage preview route
load-stage-v1    → fa97d4f   feat(ai-panel): wire follow-mode into EventTerminal
sessions-list-v1 → 1c318a0   chore(preview): remove temporary sessions list preview route
rules-stage-v1   → e811394   chore(preview): remove preview route
foundation-v1    → 2f1efc9   self-review fixes
HEAD             → 515a9bf   docs: Round 2 Stage 5 — Explore stage redesign spec
```

Recent commit log (last ~10):

```
515a9bf docs: Round 2 Stage 5 — Explore stage redesign spec
0018895 chore(preview): remove temporary Profile stage preview route
12f9e97 fix(profile): mirror Figma spacing tweaks in ProfileStage + AlertRow
b0d360d chore(preview): add temporary Profile stage preview route
8b06920 feat(profile): rewrite ProfileStage to token-driven chrome
9fe35b5 feat(profile): add AlertRow presentational component
3a5ed5b feat(profile): add chipClasses helper for alert-type tinting
3dd9f8b docs: implementation plan for Round 2 / Stage 4
abd2ec9 docs: Round 2 Stage 4 — Profile stage redesign spec
fa97d4f feat(ai-panel): wire follow-mode + scroll-to-latest pill into EventTerminal
```

No uncommitted changes in the worktree at handoff time.

To resume in a new session, point Claude at this worktree (`/Users/anjani.dabkara/ai-dq-accelerator/.claude/worktrees/flamboyant-torvalds-62637b`) and tell it to read this doc.
