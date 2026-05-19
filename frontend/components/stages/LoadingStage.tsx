export function LoadingStage() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-fg-muted">
      <div
        role="status"
        aria-label="Loading"
        className="w-8 h-8 border-2 border-brand-primary border-t-transparent rounded-full animate-spin"
      />
      <div className="text-sm">Loading your dataset…</div>
    </div>
  )
}
