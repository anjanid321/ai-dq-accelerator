// frontend/app/demo/chips/page.tsx
//
// Temporary showcase route used during the chip-system brainstorm. Shows every
// variant + tone of the proposed Chip primitive next to the existing call-site
// markup so the user can review visually before locking the spec. Drop this
// route before tagging chip-system-v1.
'use client'

import { Chip, type StatusTone, type ScoreTone } from '@/components/ui/Chip'

const STATUS_TONES: StatusTone[] = [
  'success',
  'warning',
  'danger',
  'info',
  'accent-purple',
  'accent-indigo',
  'neutral',
]

const SCORE_TONES: ScoreTone[] = ['success', 'warning', 'danger']

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-fg">{title}</h2>
      {children}
    </section>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[180px_1fr] items-center gap-4 py-2 border-b border-border last:border-0">
      <div className="text-xs text-fg-muted">{label}</div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  )
}

function Before({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] uppercase tracking-wider text-fg-subtle font-semibold">
        before
      </span>
      {children}
    </div>
  )
}

function After({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] uppercase tracking-wider text-brand-primary font-semibold">
        after
      </span>
      {children}
    </div>
  )
}

export default function ChipShowcasePage() {
  return (
    <div className="min-h-screen bg-canvas">
      <div className="max-w-4xl mx-auto p-6 flex flex-col gap-8">
        <div className="flex flex-col gap-1">
          <h1 className="text-base font-bold text-fg">Chip system showcase</h1>
          <p className="text-xs text-fg-muted">
            Temporary preview during the chip-system brainstorm. Every variant + tone of the
            proposed Chip primitive, plus side-by-side comparisons against current call sites.
          </p>
        </div>

        {/* Variant: status */}
        <Section title="Variant 1 — status (semantic-colored soft fill, no border)">
          <div className="bg-surface border border-border rounded-xl p-4 flex flex-col">
            <Row label="success">
              <Chip variant="status" tone="success">Passed</Chip>
              <Chip variant="status" tone="success">Complete</Chip>
              <Chip variant="status" tone="success">Result</Chip>
            </Row>
            <Row label="warning">
              <Chip variant="status" tone="warning">Missing</Chip>
              <Chip variant="status" tone="warning">Constant</Chip>
              <Chip variant="status" tone="warning">Awaiting Rules</Chip>
              <Chip variant="status" tone="warning">Eval Error</Chip>
            </Row>
            <Row label="danger">
              <Chip variant="status" tone="danger">Failed · 152</Chip>
              <Chip variant="status" tone="danger">Type Mismatch</Chip>
            </Row>
            <Row label="info">
              <Chip variant="status" tone="info">High Cardinality</Chip>
              <Chip variant="status" tone="info">Duplicates</Chip>
              <Chip variant="status" tone="info">Skewness</Chip>
              <Chip variant="status" tone="info">Validating</Chip>
            </Row>
            <Row label="accent-purple">
              <Chip variant="status" tone="accent-purple">Thinking</Chip>
              <Chip variant="status" tone="accent-purple">Completeness</Chip>
            </Row>
            <Row label="accent-indigo">
              <Chip variant="status" tone="accent-indigo">Tool Call</Chip>
            </Row>
            <Row label="neutral">
              <Chip variant="status" tone="neutral">Done</Chip>
            </Row>
          </div>
        </Section>

        {/* Variant: neutral */}
        <Section title="Variant 2 — neutral (elevated bg + border, optional value)">
          <div className="bg-surface border border-border rounded-xl p-4 flex flex-col">
            <Row label="label only">
              <Chip variant="neutral">Round 1 of 3</Chip>
              <Chip variant="neutral">.csv</Chip>
              <Chip variant="neutral">.parquet</Chip>
              <Chip variant="neutral">.json</Chip>
            </Row>
            <Row label="label + value">
              <Chip variant="neutral" value="100%">completeness</Chip>
              <Chip variant="neutral" value="100%">uniqueness</Chip>
              <Chip variant="neutral" value="78%">validity</Chip>
              <Chip variant="neutral" value="50%">consistency</Chip>
            </Row>
          </div>
        </Section>

        {/* Variant: score */}
        <Section title="Variant 3 — score (outline-only, rounded-full, TopBar only)">
          <div className="bg-surface border border-border rounded-xl p-4 flex flex-col">
            {SCORE_TONES.map((tone) => (
              <Row key={tone} label={tone}>
                <Chip variant="score" tone={tone}>Score: {tone === 'success' ? 94 : tone === 'warning' ? 82 : 64}%</Chip>
              </Row>
            ))}
          </div>
        </Section>

        {/* Before/after for each existing call site */}
        <Section title="Before / after — existing call sites">
          <div className="bg-surface border border-border rounded-xl p-4 flex flex-col">

            <Row label="Validate result — Passed">
              <Before>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-success/15 text-success-deep border border-success/30">PASSED</span>
              </Before>
              <span className="text-fg-subtle text-xs">→</span>
              <After>
                <Chip variant="status" tone="success">Passed</Chip>
              </After>
            </Row>

            <Row label="Validate result — Failed">
              <Before>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-danger/15 text-danger-deep border border-danger/30">FAILED · 152</span>
              </Before>
              <span className="text-fg-subtle text-xs">→</span>
              <After>
                <Chip variant="status" tone="danger">Failed · 152</Chip>
              </After>
            </Row>

            <Row label="Validate result — Eval Error">
              <Before>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-warning/15 text-warning-deep border border-warning/30">EVAL ERROR</span>
              </Before>
              <span className="text-fg-subtle text-xs">→</span>
              <After>
                <Chip variant="status" tone="warning">Eval Error</Chip>
              </After>
            </Row>

            <Row label="SessionCard stage">
              <Before>
                <span className="inline-flex items-center px-2 py-1 rounded-md text-[11px] font-semibold tracking-tight bg-warning/15 text-warning-deep">Awaiting Rule Approval</span>
              </Before>
              <span className="text-fg-subtle text-xs">→</span>
              <After>
                <Chip variant="status" tone="warning">Awaiting Rule Approval</Chip>
              </After>
            </Row>

            <Row label="Profile alert chip">
              <Before>
                <span className="bg-warning/15 text-warning-deep text-[11px] font-semibold px-2 py-0.5 rounded-md">Missing</span>
              </Before>
              <span className="text-fg-subtle text-xs">→</span>
              <After>
                <Chip variant="status" tone="warning">Missing</Chip>
              </After>
            </Row>

            <Row label="AI event — Tool Call">
              <Before>
                <span className="inline-flex items-center text-[10px] font-mono font-semibold px-2 py-0.5 rounded uppercase tracking-wide bg-accent-indigo/15 text-accent-indigo-deep">TOOL CALL</span>
              </Before>
              <span className="text-fg-subtle text-xs">→</span>
              <After>
                <Chip variant="status" tone="accent-indigo">Tool Call</Chip>
              </After>
            </Row>

            <Row label="AI event — Thinking">
              <Before>
                <span className="inline-flex items-center text-[10px] font-mono font-semibold px-2 py-0.5 rounded uppercase tracking-wide bg-accent-purple/15 text-accent-purple-deep">THINKING</span>
              </Before>
              <span className="text-fg-subtle text-xs">→</span>
              <After>
                <Chip variant="status" tone="accent-purple">Thinking</Chip>
              </After>
            </Row>

            <Row label="AI event — Result">
              <Before>
                <span className="inline-flex items-center text-[10px] font-mono font-semibold px-2 py-0.5 rounded uppercase tracking-wide bg-success/15 text-success-deep">RESULT</span>
              </Before>
              <span className="text-fg-subtle text-xs">→</span>
              <After>
                <Chip variant="status" tone="success">Result</Chip>
              </After>
            </Row>

            <Row label="AI event — Done">
              <Before>
                <span className="inline-flex items-center text-[10px] font-mono font-semibold px-2 py-0.5 rounded uppercase tracking-wide bg-fg-subtle/15 text-fg-muted">DONE</span>
              </Before>
              <span className="text-fg-subtle text-xs">→</span>
              <After>
                <Chip variant="status" tone="neutral">Done</Chip>
              </After>
            </Row>

            <Row label="DimensionChip">
              <Before>
                <span className="inline-flex items-center px-2 py-1 rounded-md text-[12px] font-medium tracking-tight bg-accent-purple/15 text-accent-purple-deep">Completeness</span>
              </Before>
              <span className="text-fg-subtle text-xs">→</span>
              <After>
                <Chip variant="status" tone="accent-purple">Completeness</Chip>
              </After>
            </Row>

            <Row label="Round chip (Explore)">
              <Before>
                <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-elevated border border-border text-[11px] font-semibold text-fg-muted">Round 1 of 3</span>
              </Before>
              <span className="text-fg-subtle text-xs">→</span>
              <After>
                <Chip variant="neutral">Round 1 of 3</Chip>
              </After>
            </Row>

            <Row label="CategoryPill (Validate)">
              <Before>
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-elevated text-[11px] text-fg-muted border border-border">
                  <span className="capitalize">validity</span>
                  <span className="font-semibold text-fg">78%</span>
                </span>
              </Before>
              <span className="text-fg-subtle text-xs">→</span>
              <After>
                <Chip variant="neutral" value="78%">validity</Chip>
              </After>
            </Row>

            <Row label="File-type chip (Upload)">
              <Before>
                <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-elevated border border-border text-[11px] font-semibold text-fg-muted">.csv</span>
              </Before>
              <span className="text-fg-subtle text-xs">→</span>
              <After>
                <Chip variant="neutral">.csv</Chip>
              </After>
            </Row>

            <Row label="TopBar Score (no change)">
              <Before>
                <span className="bg-surface border rounded-full px-2.5 py-0.5 text-xs font-semibold border-success text-success-deep">Score: 82%</span>
              </Before>
              <span className="text-fg-subtle text-xs">→</span>
              <After>
                <Chip variant="score" tone="success">Score: 82%</Chip>
              </After>
            </Row>
          </div>
        </Section>

        {/* On-background test — make sure chips read on every surface */}
        <Section title="Readability test — chips on bg-canvas / bg-surface / bg-elevated">
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-canvas border border-border rounded-xl p-4 flex flex-col gap-2">
              <div className="text-[10px] uppercase tracking-wider text-fg-muted font-semibold">on bg-canvas</div>
              <Chip variant="status" tone="success">Passed</Chip>
              <Chip variant="status" tone="danger">Failed · 6</Chip>
              <Chip variant="status" tone="warning">Eval Error</Chip>
              <Chip variant="neutral">Round 1 of 3</Chip>
              <Chip variant="neutral" value="78%">validity</Chip>
            </div>
            <div className="bg-surface border border-border rounded-xl p-4 flex flex-col gap-2">
              <div className="text-[10px] uppercase tracking-wider text-fg-muted font-semibold">on bg-surface</div>
              <Chip variant="status" tone="success">Passed</Chip>
              <Chip variant="status" tone="danger">Failed · 6</Chip>
              <Chip variant="status" tone="warning">Eval Error</Chip>
              <Chip variant="neutral">Round 1 of 3</Chip>
              <Chip variant="neutral" value="78%">validity</Chip>
            </div>
            <div className="bg-elevated border border-border rounded-xl p-4 flex flex-col gap-2">
              <div className="text-[10px] uppercase tracking-wider text-fg-muted font-semibold">on bg-elevated</div>
              <Chip variant="status" tone="success">Passed</Chip>
              <Chip variant="status" tone="danger">Failed · 6</Chip>
              <Chip variant="status" tone="warning">Eval Error</Chip>
              <Chip variant="neutral">Round 1 of 3</Chip>
              <Chip variant="neutral" value="78%">validity</Chip>
            </div>
          </div>
        </Section>

        {/* A11y summary */}
        <Section title="WCAG AA contrast check (text on bg-{tone}/15 over the lightest surface)">
          <div className="bg-surface border border-border rounded-xl p-4">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-fg-muted">
                  <th className="px-2 py-1 font-semibold">Tone</th>
                  <th className="px-2 py-1 font-semibold">Before (was)</th>
                  <th className="px-2 py-1 font-semibold">After (now)</th>
                  <th className="px-2 py-1 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="text-fg">
                <tr className="border-t border-border"><td className="px-2 py-1">success</td><td className="px-2 py-1 text-fg-muted">4.08–4.40</td><td className="px-2 py-1">5.80–6.26</td><td className="px-2 py-1"><Chip variant="status" tone="success">Pass</Chip></td></tr>
                <tr className="border-t border-border"><td className="px-2 py-1">warning</td><td className="px-2 py-1 text-fg-muted">4.13–4.47</td><td className="px-2 py-1">5.83–6.31</td><td className="px-2 py-1"><Chip variant="status" tone="success">Pass</Chip></td></tr>
                <tr className="border-t border-border"><td className="px-2 py-1">danger</td><td className="px-2 py-1 text-fg-muted">4.88–5.32</td><td className="px-2 py-1">4.88–5.32 (unchanged)</td><td className="px-2 py-1"><Chip variant="status" tone="success">Pass</Chip></td></tr>
                <tr className="border-t border-border"><td className="px-2 py-1">info</td><td className="px-2 py-1 text-fg-muted">5.21–5.64</td><td className="px-2 py-1">5.21–5.64 (unchanged)</td><td className="px-2 py-1"><Chip variant="status" tone="success">Pass</Chip></td></tr>
                <tr className="border-t border-border"><td className="px-2 py-1">accent-purple</td><td className="px-2 py-1 text-fg-muted">6.41–6.95</td><td className="px-2 py-1">6.41–6.95 (unchanged)</td><td className="px-2 py-1"><Chip variant="status" tone="success">Pass</Chip></td></tr>
                <tr className="border-t border-border"><td className="px-2 py-1">accent-indigo</td><td className="px-2 py-1 text-fg-muted">7.60–8.23</td><td className="px-2 py-1">7.60–8.23 (unchanged)</td><td className="px-2 py-1"><Chip variant="status" tone="success">Pass</Chip></td></tr>
              </tbody>
            </table>
            <p className="text-[11px] text-fg-muted mt-3 leading-relaxed">
              <span className="font-semibold text-fg">Fix:</span> success-deep darkened from <span className="font-mono">#15803D</span> to <span className="font-mono">#166534</span> (Tailwind success-800); warning-deep from <span className="font-mono">#B45309</span> to <span className="font-mono">#92400E</span> (amber-800). Both token shifts ripple through the whole frontend — strict improvement everywhere these tokens are used.
            </p>
          </div>
        </Section>
      </div>
    </div>
  )
}
