'use client'
import { useMemo } from 'react'
import { AlertCircle } from 'lucide-react'
import type { Rule } from '@/lib/types'

interface Props {
  rule: Rule
  edit: Partial<Rule>
  onChange: (patch: Partial<Rule>) => void
  onCancel: () => void
  onSaveAndApprove: () => void
}

function validate(rule: Rule, edit: Partial<Rule>): string | null {
  const min = edit.min ?? rule.min
  const max = edit.max ?? rule.max
  if (typeof min === 'number' && typeof max === 'number' && min > max) {
    return 'Min cannot be greater than Max.'
  }
  const pattern = edit.pattern ?? rule.pattern
  if (typeof pattern === 'string' && pattern.length > 0) {
    try { new RegExp(pattern) } catch {
      return 'Pattern is not a valid regular expression.'
    }
  }
  return null
}

const inputClass =
  'w-full mt-1 bg-surface border border-border-strong text-fg rounded-md px-3 py-2 text-xs font-mono ' +
  'focus:outline-none focus:ring-1 focus:ring-brand-primary focus:border-brand-primary'

export function RuleInlineEditor({ rule, edit, onChange, onCancel, onSaveAndApprove }: Props) {
  const error = useMemo(() => validate(rule, edit), [rule, edit])
  const canSave = error === null

  return (
    <div className="bg-canvas border border-fg-default rounded-lg p-4 flex flex-col gap-3">
      <div className="text-xs uppercase tracking-widest text-fg-default">Modify Rule</div>

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="text-xs text-fg-muted">Threshold (0–1)</label>
          <input
            className={inputClass}
            type="number"
            step="0.01"
            min="0"
            max="1"
            defaultValue={edit.threshold ?? rule.threshold}
            onChange={(e) => onChange({ threshold: Number(e.target.value) })}
          />
        </div>
        {rule.min !== undefined && (
          <div>
            <label className="text-xs text-fg-muted">Min</label>
            <input
              className={inputClass}
              defaultValue={edit.min ?? rule.min}
              onChange={(e) => onChange({ min: Number(e.target.value) })}
            />
          </div>
        )}
        {rule.max !== undefined && (
          <div>
            <label className="text-xs text-fg-muted">Max</label>
            <input
              className={inputClass}
              defaultValue={edit.max ?? rule.max}
              onChange={(e) => onChange({ max: Number(e.target.value) })}
            />
          </div>
        )}
        {rule.pattern !== undefined && (
          <div className="col-span-2">
            <label className="text-xs text-fg-muted">Pattern (regex)</label>
            <input
              className={inputClass}
              defaultValue={edit.pattern ?? rule.pattern}
              onChange={(e) => onChange({ pattern: e.target.value })}
            />
          </div>
        )}
        {rule.format !== undefined && (
          <div className="col-span-2">
            <label className="text-xs text-fg-muted">Format</label>
            <input
              className={inputClass}
              defaultValue={edit.format ?? rule.format}
              onChange={(e) => onChange({ format: e.target.value })}
            />
          </div>
        )}
        {rule.values !== undefined && (
          <div className="col-span-2">
            <label className="text-xs text-fg-muted">Values (comma-separated)</label>
            <input
              className={inputClass}
              defaultValue={((edit.values ?? rule.values ?? []) as unknown[]).join(', ')}
              onChange={(e) =>
                onChange({
                  values: e.target.value.split(',').map((v) => v.trim()).filter(Boolean),
                })
              }
            />
          </div>
        )}
      </div>

      {rule.sodacl && (
        <div>
          <label className="text-xs text-fg-muted">SodaCL (editable)</label>
          <textarea
            className={inputClass + ' resize-y min-h-[72px]'}
            defaultValue={edit.sodacl ?? rule.sodacl}
            onChange={(e) => onChange({ sodacl: e.target.value })}
          />
        </div>
      )}

      {error && (
        <div
          data-testid="rule-editor-error"
          className="flex items-start gap-2 px-3 py-2 rounded-md bg-danger/10 border border-danger/40 text-xs text-danger-deep"
        >
          <AlertCircle size={14} strokeWidth={2} className="shrink-0 mt-px" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="text-xs text-fg-muted border border-border-strong bg-surface px-4 py-2 rounded-md transition-colors hover:bg-elevated hover:border-fg-muted hover:text-fg"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!canSave}
          className="text-xs font-semibold bg-brand-accent text-on-brand px-4 py-2 rounded-md transition-all hover:bg-brand-accent/90 hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-brand-accent disabled:hover:shadow-none"
          onClick={onSaveAndApprove}
        >
          Save & Approve
        </button>
      </div>
    </div>
  )
}
