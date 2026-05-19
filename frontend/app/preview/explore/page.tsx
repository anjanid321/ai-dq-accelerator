'use client'
import { useState } from 'react'
import { AlertTriangle, ArrowRight, Download, RefreshCw } from 'lucide-react'

type ScenarioKey =
  | 'ready'
  | 'loading'
  | 'reinvestigating'
  | 'constrained'
  | 'max-rounds'
  | 'readonly'

interface MockState {
  open_questions: string[]
  investigation_round: number
  notebook_ready: boolean
  synthesis_constrained: boolean
  synthesis_constraint_reasons: string[]
}

interface Scenario {
  key: ScenarioKey
  label: string
  description: string
  state: MockState
  stage: string
  readOnly?: boolean
}

const READY_QUESTIONS = [
  'Is `co_signer_ssn` truly optional for non-cosigned loans, or is the 41% missingness a data-quality issue?',
  'Why does `state_code` show only one unique value? Verify whether this is a single-state dataset or a column-mapping bug.',
  'The `tenure` column is 100% distinct — is it an identifier rather than a feature?',
]

const SCENARIOS: Scenario[] = [
  {
    key: 'ready',
    label: 'Default (notebook ready, open Q)',
    description: 'Awaiting your approval. 3 open questions, notebook embedded.',
    stage: 'AWAITING_INVESTIGATION_REVIEW',
    state: {
      open_questions: READY_QUESTIONS,
      investigation_round: 0,
      notebook_ready: true,
      synthesis_constrained: false,
      synthesis_constraint_reasons: [],
    },
  },
  {
    key: 'loading',
    label: 'Loading (notebook generating)',
    description: 'No state yet — initial poll while the agent generates the notebook.',
    stage: 'AWAITING_INVESTIGATION_REVIEW',
    state: {
      open_questions: [],
      investigation_round: 0,
      notebook_ready: false,
      synthesis_constrained: false,
      synthesis_constraint_reasons: [],
    },
  },
  {
    key: 'reinvestigating',
    label: 'Re-investigating',
    description: 'Agent is re-running on the feedback. Different copy on the loader.',
    stage: 'REINVESTIGATING',
    state: {
      open_questions: [],
      investigation_round: 1,
      notebook_ready: false,
      synthesis_constrained: false,
      synthesis_constraint_reasons: [],
    },
  },
  {
    key: 'constrained',
    label: 'Constrained synthesis',
    description: 'Notebook ready, synthesis_constrained=true with reasons.',
    stage: 'AWAITING_INVESTIGATION_REVIEW',
    state: {
      open_questions: READY_QUESTIONS.slice(0, 1),
      investigation_round: 1,
      notebook_ready: true,
      synthesis_constrained: true,
      synthesis_constraint_reasons: [
        '`co_signer_ssn` missingness pattern still unresolved after Round 2',
        'Cross-column relationship between Status and Amount needs human review',
      ],
    },
  },
  {
    key: 'max-rounds',
    label: 'Max rounds reached',
    description: 'investigation_round = 2 — feedback hidden, only Approve remains.',
    stage: 'AWAITING_INVESTIGATION_REVIEW',
    state: {
      open_questions: READY_QUESTIONS,
      investigation_round: 2,
      notebook_ready: true,
      synthesis_constrained: false,
      synthesis_constraint_reasons: [],
    },
  },
  {
    key: 'readonly',
    label: 'Read-only (snapshot)',
    description: 'Historic view of a COMPLETE session — no actions, no feedback.',
    stage: 'COMPLETE',
    readOnly: true,
    state: {
      open_questions: READY_QUESTIONS.slice(0, 2),
      investigation_round: 1,
      notebook_ready: true,
      synthesis_constrained: false,
      synthesis_constraint_reasons: [],
    },
  },
]

// Inlined copy of ExplorationStage's render logic — see
// frontend/components/stages/ExplorationStage.tsx. The preview can't
// reuse the real component because it polls the live API; the markup
// is duplicated verbatim here, drive by static mock state.
function PreviewExploration({ scenario }: { scenario: Scenario }) {
  const { state, stage, readOnly } = scenario
  const [feedback, setFeedback] = useState('')
  const [submitted, setSubmitted] = useState(false)

  const isReinvestigating = stage === 'REINVESTIGATING' || stage === 'PROFILING_SYNTHESIS'
  const maxRoundsReached = state.investigation_round >= 2
  const canRequestReinvestigation = !maxRoundsReached && feedback.trim().length > 0
  const notebookReady = state.notebook_ready

  if (submitted) {
    return (
      <div className="p-5 flex flex-col items-center justify-center h-full gap-3">
        <div
          role="status"
          aria-label="Submitting"
          className="w-10 h-10 border-2 border-brand-primary border-t-transparent rounded-full animate-spin"
        />
        <p className="text-sm text-fg-muted">
          {isReinvestigating ? 'Re-investigating…' : 'Moving to rule proposal…'}
        </p>
      </div>
    )
  }

  return (
    <div className="p-5 flex flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-bold text-fg">Exploration Review</h1>
          <span className="flex-1" />
          <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-elevated border border-border text-[11px] font-semibold text-fg-muted">
            Round {state.investigation_round + 1} of 3
          </span>
        </div>
        <p className="text-xs text-fg-muted">
          Review the AI's investigation findings before rules are proposed.
        </p>
      </div>

      {maxRoundsReached && (
        <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-warning-deep">
          <AlertTriangle size={14} strokeWidth={2} />
          Maximum re-investigation rounds reached — approve to continue.
        </div>
      )}

      {state.open_questions.length > 0 && (
        <div className="bg-warning/15 border border-warning/30 rounded-xl p-4 flex flex-col gap-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-warning-deep">
            Open Questions — Requires Your Input
          </div>
          <ol className="list-decimal list-inside flex flex-col gap-1">
            {state.open_questions.map((q, i) => (
              <li key={i} className="text-xs text-warning-deep leading-relaxed">
                {q}
              </li>
            ))}
          </ol>
        </div>
      )}

      {state.synthesis_constrained && (
        <div className="bg-danger/15 border border-danger/30 rounded-xl p-3 flex flex-col gap-1">
          <div className="text-xs font-semibold uppercase tracking-wider text-danger-deep">
            Constrained Synthesis
          </div>
          <p className="text-xs text-danger-deep">
            Rules were proposed despite unresolved uncertainty. The AI summary includes a warning.
          </p>
          {state.synthesis_constraint_reasons.length > 0 && (
            <ul className="list-disc list-inside flex flex-col gap-0.5">
              {state.synthesis_constraint_reasons.map((r, i) => (
                <li key={i} className="text-xs text-danger-deep">
                  {r}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!notebookReady ? (
        <div className="bg-surface border border-border rounded-xl p-6 flex items-center gap-3">
          <div
            role="status"
            aria-label="Loading"
            className="w-4 h-4 border-2 border-brand-primary border-t-transparent rounded-full animate-spin shrink-0"
          />
          <span className="text-xs text-fg-muted">
            {isReinvestigating
              ? 'Agent is re-investigating your data…'
              : 'Generating exploration notebook…'}
          </span>
        </div>
      ) : (
        <div className="border border-border rounded-xl overflow-hidden h-[520px] flex flex-col">
          <div className="flex items-center bg-elevated px-3 py-2 border-b border-border">
            <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
              Exploration Notebook
            </span>
            <span className="flex-1" />
            <a
              href="#"
              onClick={(e) => e.preventDefault()}
              className="inline-flex items-center gap-1.5 bg-surface border border-border text-fg-muted text-[11px] font-semibold px-2.5 py-1 rounded-md hover:bg-canvas hover:border-fg-muted hover:text-fg transition-all"
            >
              <Download size={12} strokeWidth={2} />
              Download .ipynb
            </a>
          </div>
          <div className="flex-1 bg-white p-6 text-[12px] text-fg-muted font-mono leading-relaxed overflow-y-auto">
            <p className="mb-2 text-fg font-semibold"># Exploration Notebook (mock preview)</p>
            <p className="mb-3">
              In live mode this area embeds the rendered Jupyter notebook iframe. The wrapper, border, header, and download link are real — only the iframe body is mocked here.
            </p>
            <p className="mb-1">In [1]: <span className="text-fg">df = read_session(&quot;preview&quot;)</span></p>
            <p className="mb-3">Out[1]: 18,432 rows × 47 columns</p>
            <p className="mb-1">In [2]: <span className="text-fg">df[&apos;co_signer_ssn&apos;].isna().mean()</span></p>
            <p className="mb-3">Out[2]: 0.413  # ~41% missing — investigate optionality</p>
          </div>
        </div>
      )}

      {notebookReady && !readOnly && (
        <>
          {!maxRoundsReached && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
                Request targeted re-investigation (optional)
              </label>
              <textarea
                className="w-full bg-surface border border-border rounded-lg p-2.5 text-xs text-fg resize-none focus:outline-none focus:border-brand-primary placeholder:text-fg-subtle"
                rows={3}
                placeholder={`e.g. "Dig deeper into the relationship between Status and Amount — the cross-column finding seems important"`}
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
              />
            </div>
          )}

          <div className="flex justify-end gap-2">
            {!maxRoundsReached && (
              <button
                type="button"
                onClick={() => setSubmitted(true)}
                disabled={!canRequestReinvestigation}
                className="inline-flex items-center gap-1.5 bg-surface border border-border text-fg-muted text-[13px] font-semibold px-4 py-2 rounded-md hover:bg-elevated hover:border-fg-muted hover:text-fg disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                <RefreshCw size={14} strokeWidth={2} />
                Re-investigate
              </button>
            )}
            <button
              type="button"
              onClick={() => setSubmitted(true)}
              className="inline-flex items-center gap-1.5 bg-brand-accent text-on-brand text-[13px] font-semibold px-4 py-2 rounded-md hover:bg-brand-accent/90 hover:shadow-md transition-all"
            >
              Approve & Continue
              <ArrowRight size={14} strokeWidth={2} />
            </button>
          </div>
        </>
      )}
    </div>
  )
}

export default function ExplorePreviewPage() {
  const [active, setActive] = useState<ScenarioKey>('ready')
  const scenario = SCENARIOS.find((s) => s.key === active) ?? SCENARIOS[0]

  return (
    <div className="min-h-screen bg-canvas">
      <div className="max-w-[1000px] mx-auto p-6">
        <div className="mb-4 flex flex-col gap-2">
          <h1 className="text-sm font-bold text-fg">Explore stage — preview</h1>
          <p className="text-xs text-fg-muted">
            Temporary preview route for Round 2 / Stage 5 review. Switch scenarios below.
          </p>
          <div className="flex flex-wrap gap-2 mt-1">
            {SCENARIOS.map((s) => (
              <button
                key={s.key}
                onClick={() => setActive(s.key)}
                className={`text-[11px] font-medium px-2.5 py-1 rounded-md border transition-colors ${
                  active === s.key
                    ? 'bg-brand-accent text-on-brand border-brand-accent'
                    : 'bg-surface text-fg-muted border-border hover:bg-elevated hover:text-fg'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-fg-subtle italic">{scenario.description}</p>
        </div>

        <div className="bg-canvas border border-border rounded-xl overflow-hidden">
          <PreviewExploration scenario={scenario} />
        </div>
      </div>
    </div>
  )
}
