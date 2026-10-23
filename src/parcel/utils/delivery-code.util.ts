import { createHmac, randomInt, timingSafeEqual } from 'crypto';

/** Wrong codes allowed against one issued code before it stops working. */
export const MAX_DELIVERY_CODE_ATTEMPTS = 5;

/** Six digits: short enough to read out at a door, issued fresh per attempt. */
export function generateDeliveryCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/**
 * Keyed with a server secret, and bound to the parcel, so a leaked row
 * cannot be brute-forced offline — a million candidates is nothing to plain
 * SHA-256 — and a code for one parcel never verifies against another.
 */
export function hashDeliveryCode(
  parcelId: string,
  code: string,
  secret: string,
): string {
  return createHmac('sha256', secret).update(`${parcelId}:${code}`).digest('hex');
}

export function deliveryCodeMatches(
  parcelId: string,
  code: string,
  hash: string,
  secret: string,
): boolean {
  const candidate = Buffer.from(hashDeliveryCode(parcelId, code, secret));
  const stored = Buffer.from(hash);
  return (
    candidate.length === stored.length && timingSafeEqual(candidate, stored)
  );
}
