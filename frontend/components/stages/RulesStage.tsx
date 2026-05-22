'use client'
import { useMemo, useState } from 'react'
import { Check, SquareCheckBig } from 'lucide-react'
import type { SessionState, Rule } from '@/lib/types'
import { approveRules } from '@/lib/api'
import { DIMENSION_IDS } from '@/lib/dq/dimensions'
import { RuleCard, type Decision } from '@/components/rules/RuleCard'
import { SelectionToolbar } from '@/components/rules/SelectionToolbar'
import { DecisionFooter } from '@/components/rules/DecisionFooter'

interface Props {
  session: SessionState
  readOnly?: boolean
  demoMode?: boolean
}

type Filter = 'all' | (typeof DIMENSION_IDS)[number]

export function RulesStage({ session, readOnly, demoMode }: Props) {
  const rules = session.suggested_rules as Rule[]

  const [decisions, setDecisions] = useState<Record<string, Decision>>(
    () => Object.fromEntries(rules.map((r) => [r.id, 'pending']))
  )
  const [edits, setEdits] = useState<Record<string, Partial<Rule>>>({})
  const [editingId, setEditingId] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [submitting, setSubmitting] = useState(false)

  const counts = useMemo(() => {
    let approved = 0, denied = 0, undecided = 0
    for (const id of Object.keys(decisions)) {
      const d = decisions[id]
      if (d === 'approved') approved++
      else if (d === 'denied') denied++
      else undecided++
    }
    return { approved, denied, undecided }
  }, [decisions])

  const visible = useMemo(
    () => (filter === 'all' ? rules : rules.filter((r) => r.category.toLowerCase() === filter)),
    [rules, filter]
  )
  const visibleIds = useMemo(() => visible.map((r) => r.id), [visible])
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id))

  function decide(id: string, next: Decision) {
    setDecisions((prev) => ({ ...prev, [id]: next }))
  }

  function approveAll() {
    setDecisions((prev) => {
      const out = { ...prev }
      for (const r of rules) out[r.id] = 'approved'
      return out
    })
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleAllVisible() {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (allVisibleSelected) {
        for (const id of visibleIds) next.delete(id)
      } else {
        for (const id of visibleIds) next.add(id)
      }
      return next
    })
  }

  function exitSelectionMode() {
    setSelectionMode(false)
    setSelectedIds(new Set())
  }

  function bulkApply(value: Decision) {
    setDecisions((prev) => {
      const out = { ...prev }
      for (const id of selectedIds) out[id] = value
      return out
    })
    exitSelectionMode()
  }

  async function handleSubmit() {
    setSubmitting(true)
    const approvedRules = rules
      .filter((r) => decisions[r.id] === 'approved')
      .map((r) => {
        const e = edits[r.id]
        return e ? { ...r, ...e } : r
      })
    const rejectedIds = rules.filter((r) => decisions[r.id] === 'denied').map((r) => r.id)
    try {
      if (demoMode) {
        await new Promise((r) => setTimeout(r, 600))
        return
      }
      await approveRules(session.session_id, approvedRules, rejectedIds)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
        <header>
          <h1 className="text-base font-bold text-fg">Rule Approval</h1>
          <p className="text-xs text-fg-muted">
            Approve, deny, or edit each AI-proposed rule. You can edit any rule before approving.
          </p>
        </header>

        <div className="flex items-center gap-2 flex-wrap">
          {(['all', ...DIMENSION_IDS] as Filter[]).map((f) => {
            const count = f === 'all' ? rules.length : rules.filter((r) => r.category.toLowerCase() === f).length
            const isActive = filter === f
            const label = f === 'all' ? `All (${count})` : `${f.charAt(0).toUpperCase()}${f.slice(1)} (${count})`
            return (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                data-filter={f}
                data-active={isActive}
                className={[
                  'text-xs px-2.5 py-1 rounded-md border bg-surface transition-colors',
                  isActive
                    ? 'border-brand-primary text-fg font-semibold hover:bg-brand-primary/5'
                    : 'border-border-strong text-fg-muted hover:bg-elevated hover:border-fg-muted hover:text-fg',
                ].join(' ')}
              >
                {label}
              </button>
            )
          })}
          <div className="flex-1" />
          {!readOnly && (
            <>
              <button
                type="button"
                onClick={() => (selectionMode ? exitSelectionMode() : setSelectionMode(true))}
                data-testid="select-toggle"
                data-active={selectionMode}
                className={[
                  'inline-flex items-center gap-1.5 px-3 py-1 rounded-md border text-[13px] font-medium transition-colors',
                  selectionMode
                    ? 'bg-elevated border-fg-default text-fg-default hover:bg-elevated/80'
                    : 'bg-surface border-border-strong text-fg-muted hover:bg-elevated hover:border-fg-muted hover:text-fg',
                ].join(' ')}
              >
                <SquareCheckBig size={14} strokeWidth={2} />
                {selectionMode ? 'Cancel' : 'Select'}
              </button>
              {!selectionMode && (
                <button
                  type="button"
                  onClick={approveAll}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md border bg-surface border-success text-success-deep text-[13px] font-medium transition-colors hover:bg-success/10"
                >
                  <Check size={14} strokeWidth={2} /> Approve all
                </button>
              )}
            </>
          )}
        </div>

        {selectionMode && !readOnly && (
          <SelectionToolbar
            selectedCount={selectedIds.size}
            allVisibleSelected={allVisibleSelected}
            onToggleAllVisible={toggleAllVisible}
            onBulkApprove={() => bulkApply('approved')}
            onBulkDeny={() => bulkApply('denied')}
            onBulkClear={() => bulkApply('pending')}
          />
        )}

        <div className="flex flex-col gap-2">
          {visible.map((rule) => (
            <RuleCard
              key={rule.id}
              rule={rule}
              decision={decisions[rule.id]}
              edit={edits[rule.id] ?? {}}
              isEditing={editingId === rule.id}
              isSelectionMode={selectionMode}
              isSelected={selectedIds.has(rule.id)}
              onDecide={(d) => decide(rule.id, d)}
              onToggleSelect={() => toggleSelect(rule.id)}
              onEditOpen={() => setEditingId(rule.id)}
              onEditClose={() => setEditingId(null)}
              onEditChange={(patch) =>
                setEdits((prev) => ({ ...prev, [rule.id]: { ...prev[rule.id], ...patch } }))
              }
              onSaveAndApprove={() => {
                decide(rule.id, 'approved')
                setEditingId(null)
              }}
            />
          ))}
        </div>
      </div>

      {!readOnly && (
        <DecisionFooter
          approved={counts.approved}
          denied={counts.denied}
          undecided={counts.undecided}
          submitting={submitting}
          onSubmit={handleSubmit}
        />
      )}
    </div>
  )
}
