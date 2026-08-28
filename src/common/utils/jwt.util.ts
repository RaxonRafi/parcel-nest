/**
 * Pulls the raw token out of an `Authorization` header value.
 * Tolerates a bare token so callers can pass either form.
 */
export function extractBearerToken(authorization?: string): string | undefined {
  if (!authorization) return undefined;
  return authorization.startsWith('Bearer ')
    ? authorization.slice(7)
    : authorization;
}
