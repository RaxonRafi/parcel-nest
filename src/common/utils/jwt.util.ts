/**
 * Pulls the raw token out of an `Authorization: Bearer <token>` header value.
 * Anything without the scheme is treated as no token at all.
 */
export function extractBearerToken(authorization?: string): string | undefined {
  const match = /^Bearer\s+(\S+)$/i.exec(authorization?.trim() ?? '');
  return match?.[1];
}
