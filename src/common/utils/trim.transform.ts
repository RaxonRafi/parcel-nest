/**
 * `@Transform(trimString)` — strips surrounding whitespace from a string field
 * and leaves anything else for the validators to reject.
 */
export const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;
