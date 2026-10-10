/**
 * Makes user input literal inside a `LIKE` / `ILIKE` pattern.
 *
 * `%` and `_` are wildcards there, so a search for `50%` matched everything
 * beginning with `50`, and a lone `_` matched every row. Postgres' default
 * escape character is the backslash, which therefore needs escaping too.
 */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}
