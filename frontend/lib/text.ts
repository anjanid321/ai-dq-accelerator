// Small text helpers used by the UI to normalize chip / label copy.

/**
 * Convert a snake_case or kebab-case identifier into Title Case. Used by chips
 * that render backend enum values (step types, escalation types, transform
 * statuses) so chip messaging stays Title Case across every surface, per the
 * chip-system-v1 convention.
 *
 *   toTitleCase('normalize_format')          → 'Normalize Format'
 *   toTitleCase('transform_verification_failed') → 'Transform Verification Failed'
 *   toTitleCase('no_effect')                 → 'No Effect'
 */
export function toTitleCase(value: string): string {
  if (!value) return ''
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}
