'use client'
import type { Rule } from '@/lib/types'

interface Props {
  rule: Rule
  edit: Partial<Rule>
  onChange: (patch: Partial<Rule>) => void
  onCancel: () => void
  onSaveAndApprove: () => void
}

export function RuleInlineEditor({ rule, edit, onChange, onCancel, onSaveAndApprove }: Props) {
  return (
    <div className="bg-canvas border border-fg-default rounded-lg p-3">
      <div className="text-[10px] uppercase tracking-widest text-fg-default mb-2">Modify Rule</div>
      <div className="grid grid-cols-2 gap-2 mb-2">
        {rule.min !== undefined && (
          <div>
            <label className="text-[10px] text-fg-muted">Min</label>
            <input
              className="w-full mt-1 bg-surface border border-border text-fg rounded px-2 py-1 text-xs font-mono"
              defaultValue={edit.min ?? rule.min}
              onChange={(e) => onChange({ min: Number(e.target.value) })}
            />
          </div>
        )}
        {rule.max !== undefined && (
          <div>
            <label className="text-[10px] text-fg-muted">Max</label>
            <input
              className="w-full mt-1 bg-surface border border-border text-fg rounded px-2 py-1 text-xs font-mono"
              defaultValue={edit.max ?? rule.max}
              onChange={(e) => onChange({ max: Number(e.target.value) })}
            />
          </div>
        )}
        {rule.pattern !== undefined && (
          <div className="col-span-2">
            <label className="text-[10px] text-fg-muted">Pattern (regex)</label>
            <input
              className="w-full mt-1 bg-surface border border-border text-fg rounded px-2 py-1 text-xs font-mono"
              defaultValue={edit.pattern ?? rule.pattern}
              onChange={(e) => onChange({ pattern: e.target.value })}
            />
          </div>
        )}
        {rule.values !== undefined && (
          <div className="col-span-2">
            <label className="text-[10px] text-fg-muted">Values (comma-separated)</label>
            <input
              className="w-full mt-1 bg-surface border border-border text-fg rounded px-2 py-1 text-xs font-mono"
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
        <div className="mb-2">
          <label className="text-[10px] text-fg-muted">SodaCL (editable)</label>
          <textarea
            className="w-full mt-1 bg-surface border border-border text-fg rounded px-2 py-1 text-xs font-mono resize-y min-h-[56px]"
            defaultValue={edit.sodacl ?? rule.sodacl}
            onChange={(e) => onChange({ sodacl: e.target.value })}
          />
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="text-xs text-fg-muted border border-border-strong bg-surface px-3 py-1.5 rounded-md"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className="text-xs font-semibold bg-brand-accent text-on-brand px-3 py-1.5 rounded-md"
          onClick={onSaveAndApprove}
        >
          Save & Approve
        </button>
      </div>
    </div>
  )
}
