'use client'
import { Check, X, Pencil } from 'lucide-react'
import type { Rule } from '@/lib/types'
import { DimensionChip } from '@/components/dq/DimensionChip'
import { RuleInlineEditor } from './RuleInlineEditor'

export type Decision = 'approved' | 'denied' | 'pending'

interface Props {
  rule: Rule
  decision: Decision
  edit: Partial<Rule>
  isEditing: boolean
  isSelectionMode: boolean
  isSelected: boolean
  onDecide: (next: Decision) => void
  onToggleSelect: () => void
  onEditOpen: () => void
  onEditClose: () => void
  onEditChange: (patch: Partial<Rule>) => void
  onSaveAndApprove: () => void
}

function cardChrome({ decision, isEditing }: { decision: Decision; isEditing: boolean }): string {
  if (decision === 'approved') return 'border-success ring-1 ring-success/40'
  if (decision === 'denied') return 'border-danger ring-1 ring-danger/40'
  if (isEditing) return 'border-fg-default ring-1 ring-fg-default/20'
  return 'border-border'
}

function decisionButton({
  active,
  variant,
  label,
  Icon,
  onClick,
}: {
  active: boolean
  variant: 'success' | 'danger'
  label: string
  Icon: typeof Check
  onClick: () => void
}) {
  const baseIdle = variant === 'success'
    ? 'bg-surface border-success text-success-deep hover:bg-success/10'
    : 'bg-surface border-danger text-danger-deep hover:bg-danger/10'
  const baseActive = variant === 'success'
    ? 'bg-success-deep border-success-deep text-on-brand hover:bg-success'
    : 'bg-danger-deep border-danger-deep text-on-brand hover:bg-danger'
  return (
    <button
      type="button"
      onClick={onClick}
      data-decision={variant}
      data-active={active}
      className={[
        'inline-flex items-center gap-1.5 px-3 py-1 rounded-md border text-[13px] font-medium transition-colors',
        active ? baseActive : baseIdle,
      ].join(' ')}
    >
      <Icon size={14} strokeWidth={2} />
      {label}
    </button>
  )
}

function SelectionCheckbox({
  checked,
  onChange,
  ariaLabel,
}: {
  checked: boolean
  onChange: () => void
  ariaLabel: string
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={onChange}
      className={[
        'shrink-0 w-5 h-5 rounded-md border flex items-center justify-center transition-colors',
        checked
          ? 'bg-brand-primary border-brand-primary text-on-brand'
          : 'bg-surface border-border-strong hover:border-fg-muted',
      ].join(' ')}
    >
      {checked && <Check size={14} strokeWidth={3} />}
    </button>
  )
}

export function RuleCard({
  rule, decision, edit, isEditing, isSelectionMode, isSelected,
  onDecide, onToggleSelect, onEditOpen, onEditClose, onEditChange, onSaveAndApprove,
}: Props) {
  const onApprove = () => onDecide(decision === 'approved' ? 'pending' : 'approved')
  const onDeny    = () => onDecide(decision === 'denied'   ? 'pending' : 'denied')

  return (
    <div
      data-rule-id={rule.id}
      data-decision={decision}
      className={[
        'bg-surface rounded-lg border p-4 flex flex-col gap-2',
        cardChrome({ decision, isEditing }),
      ].join(' ')}
    >
      <div className="flex items-center gap-2.5">
        {isSelectionMode && (
          <SelectionCheckbox
            checked={isSelected}
            onChange={onToggleSelect}
            ariaLabel={`Select rule ${rule.id}`}
          />
        )}
        <DimensionChip dimension={rule.category} className="shrink-0" />
        <span className="font-mono text-[13px] text-fg flex-1 break-words">{edit.check ?? rule.check}</span>
        {!isSelectionMode && (
          <div className="flex gap-2 shrink-0">
            {decisionButton({ active: decision === 'approved', variant: 'success', label: decision === 'approved' ? 'Approved' : 'Approve', Icon: Check, onClick: onApprove })}
            {decisionButton({ active: decision === 'denied',   variant: 'danger',  label: decision === 'denied'   ? 'Denied'   : 'Deny',    Icon: X,     onClick: onDeny })}
          </div>
        )}
      </div>

      <div className="flex gap-3 text-xs text-fg-muted">
        {rule.column && <span>column: {rule.column}</span>}
        <span>check: {rule.check}</span>
      </div>
      {rule.rationale && (
        <p className="text-xs italic text-fg-muted leading-relaxed">{rule.rationale}</p>
      )}

      {isEditing && (
        <RuleInlineEditor
          rule={rule}
          edit={edit}
          onChange={onEditChange}
          onCancel={onEditClose}
          onSaveAndApprove={onSaveAndApprove}
        />
      )}

      {!isEditing && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onEditOpen}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md border text-[13px] font-medium bg-surface border-border-strong text-fg-muted transition-colors hover:bg-elevated hover:border-fg-muted hover:text-fg"
          >
            <Pencil size={14} strokeWidth={2} />
            Edit
          </button>
        </div>
      )}
    </div>
  )
}
