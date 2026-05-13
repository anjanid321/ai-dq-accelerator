'use client'
import { useState } from 'react'
import type { SessionState, Rule } from '@/lib/types'
import { approveRules } from '@/lib/api'

type Decision = 'approved' | 'rejected' | 'pending'

const CAT_COLORS: Record<string, string> = {
  validity: 'bg-indigo/20 text-indigo-light',
  completeness: 'bg-cyan-400/20 text-cyan-300',
  uniqueness: 'bg-purple/20 text-purple-light',
}

interface Props { session: SessionState; readOnly?: boolean }

export function RulesStage({ session, readOnly }: Props) {
  const rules = session.suggested_rules as Rule[]
  const [decisions, setDecisions] = useState<Record<string, Decision>>(() => Object.fromEntries(rules.map(r => [r.id, 'pending'])))
  const [edits, setEdits] = useState<Record<string, Partial<Rule>>>({})
  const [editingId, setEditingId] = useState<string | null>(null)
  const [filter, setFilter] = useState<string>('all')
  const [submitting, setSubmitting] = useState(false)

  const pending = Object.values(decisions).filter(d => d === 'pending').length
  const approved = Object.values(decisions).filter(d => d === 'approved').length
  const rejected = Object.values(decisions).filter(d => d === 'rejected').length
  const canSubmit = pending === 0

  const displayed = filter === 'all' ? rules : rules.filter(r => r.category === filter)

  function decide(id: string, d: Decision) {
    setDecisions(prev => ({ ...prev, [id]: d }))
  }

  function approveAll() {
    setDecisions(Object.fromEntries(rules.map(r => [r.id, 'approved'])))
  }

  async function handleSubmit() {
    setSubmitting(true)
    const approvedRules = rules
      .filter(r => decisions[r.id] === 'approved')
      .map(r => {
        const e = edits[r.id]
        return e ? { ...r, ...e } : r
      })
    const rejectedIds = rules.filter(r => decisions[r.id] === 'rejected').map(r => r.id)
    try {
      await approveRules(session.session_id, approvedRules, rejectedIds)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-5">
        <h1 className="text-base font-bold text-text-primary mb-1">Rule Approval</h1>
        <p className="text-xs text-text-muted mb-4">Approve or reject each AI-proposed rule. You can edit any rule before approving.</p>

        {/* Filter toolbar */}
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          {['all', 'validity', 'completeness', 'uniqueness'].map(f => (
            <button key={f} className={`text-xs px-2.5 py-1 rounded-md border capitalize ${filter === f ? 'border-indigo/40 text-indigo-light bg-indigo/10' : 'border-border text-text-muted'}`} onClick={() => setFilter(f)}>
              {f === 'all' ? `All (${rules.length})` : `${f} (${rules.filter(r => r.category === f).length})`}
            </button>
          ))}
          {!readOnly && (
            <button className="ml-auto text-xs px-2.5 py-1 rounded-md border border-success/40 text-success-light bg-success/10" onClick={approveAll}>
              Approve All
            </button>
          )}
        </div>

        {/* Rule cards */}
        {displayed.map(rule => {
          const d = decisions[rule.id]
          const editing = editingId === rule.id
          const edit = edits[rule.id] ?? {}
          return (
            <div key={rule.id} className={`border rounded-xl p-4 mb-2 transition-colors ${d === 'approved' ? 'border-success/40 bg-success/5' : d === 'rejected' ? 'border-danger/40 bg-danger/5 opacity-60' : editing ? 'border-warning/50 bg-warning/5' : 'border-border bg-surface'}`}>
              <div className="flex items-start gap-2.5 mb-2">
                <span className={`text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0 mt-0.5 ${CAT_COLORS[rule.category] ?? ''}`}>{rule.category}</span>
                <span className="font-mono text-sm text-text-primary flex-1">{edit.check ?? rule.check}</span>
                {!readOnly && (
                  <div className="flex gap-1 shrink-0">
                    <button className={`text-[11px] font-medium px-2.5 py-1 rounded-md border ${d === 'approved' ? 'bg-success text-black border-success' : 'bg-success/20 text-success-light border-success/40'}`} onClick={() => decide(rule.id, 'approved')}>
                      {d === 'approved' ? '✓ Approved' : '✓'}
                    </button>
                    <button className={`text-[11px] font-medium px-2.5 py-1 rounded-md border ${d === 'rejected' ? 'bg-danger text-white border-danger' : 'bg-danger/20 text-danger-light border-danger/40'}`} onClick={() => decide(rule.id, 'rejected')}>
                      {d === 'rejected' ? '✗ Rejected' : '✗'}
                    </button>
                    <button className={`text-[11px] font-medium px-2.5 py-1 rounded-md border ${editing ? 'bg-warning text-black border-warning' : 'bg-warning/15 text-warning border-warning/30'}`} onClick={() => setEditingId(editing ? null : rule.id)}>
                      {editing ? '✎ Editing' : '✎'}
                    </button>
                  </div>
                )}
              </div>
              <div className="flex gap-3 text-[11px] text-text-muted mb-1.5">
                {rule.column && <span>column: {rule.column}</span>}
                <span>check: {rule.check}</span>
              </div>
              {rule.rationale && <p className="text-[11px] text-text-muted italic leading-relaxed">{rule.rationale}</p>}

              {/* Inline editor */}
              {editing && (
                <div className="mt-3 bg-bg border border-warning/40 rounded-lg p-3">
                  <div className="text-[10px] uppercase tracking-widest text-warning mb-2">✎ Modify Rule</div>
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    {rule.min !== undefined && <div><label className="text-[10px] text-text-muted">Min</label><input className="w-full mt-1 bg-surface border border-border text-text-primary rounded px-2 py-1 text-xs font-mono" defaultValue={edit.min ?? rule.min} onChange={e => setEdits(prev => ({ ...prev, [rule.id]: { ...prev[rule.id], min: Number(e.target.value) } }))} /></div>}
                    {rule.max !== undefined && <div><label className="text-[10px] text-text-muted">Max</label><input className="w-full mt-1 bg-surface border border-border text-text-primary rounded px-2 py-1 text-xs font-mono" defaultValue={edit.max ?? rule.max} onChange={e => setEdits(prev => ({ ...prev, [rule.id]: { ...prev[rule.id], max: Number(e.target.value) } }))} /></div>}
                    {rule.pattern !== undefined && <div className="col-span-2"><label className="text-[10px] text-text-muted">Pattern (regex)</label><input className="w-full mt-1 bg-surface border border-border text-text-primary rounded px-2 py-1 text-xs font-mono" defaultValue={edit.pattern ?? rule.pattern} onChange={e => setEdits(prev => ({ ...prev, [rule.id]: { ...prev[rule.id], pattern: e.target.value } }))} /></div>}
                    {rule.values !== undefined && <div className="col-span-2"><label className="text-[10px] text-text-muted">Values (comma-separated)</label><input className="w-full mt-1 bg-surface border border-border text-text-primary rounded px-2 py-1 text-xs font-mono" defaultValue={(edit.values ?? rule.values ?? []).join(', ')} onChange={e => setEdits(prev => ({ ...prev, [rule.id]: { ...prev[rule.id], values: e.target.value.split(',').map(v => v.trim()).filter(Boolean) } }))} /></div>}
                  </div>
                  {rule.sodacl && (
                    <div className="mb-2">
                      <label className="text-[10px] text-text-muted">SodaCL (editable)</label>
                      <textarea className="w-full mt-1 bg-surface border border-border text-text-primary rounded px-2 py-1 text-xs font-mono resize-y min-h-[56px]" defaultValue={edit.sodacl ?? rule.sodacl} onChange={e => setEdits(prev => ({ ...prev, [rule.id]: { ...prev[rule.id], sodacl: e.target.value } }))} />
                    </div>
                  )}
                  <div className="flex justify-end gap-2">
                    <button className="text-xs text-text-muted border border-border px-3 py-1.5 rounded-md" onClick={() => setEditingId(null)}>Cancel</button>
                    <button className="text-xs font-semibold bg-warning text-black px-3 py-1.5 rounded-md" onClick={() => { decide(rule.id, 'approved'); setEditingId(null) }}>Save & Approve</button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Sticky submit bar */}
      {!readOnly && <div className="bg-elevated border-t border-border px-5 py-3 flex items-center gap-4 shrink-0">
        <div className="flex gap-3 text-xs">
          <span className="text-success-light">✓ {approved} approved</span>
          <span className="text-danger-light">✗ {rejected} rejected</span>
          <span className="text-text-muted">○ {pending} pending</span>
        </div>
        <button className="ml-auto bg-indigo text-white text-sm font-medium px-5 py-2 rounded-lg disabled:opacity-40" disabled={!canSubmit || submitting} onClick={handleSubmit}>
          {submitting ? 'Submitting...' : 'Submit Decisions →'}
        </button>
      </div>}
    </div>
  )
}
