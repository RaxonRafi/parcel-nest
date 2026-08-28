/**
 * "Cal Rahman" → "Cal". Enough to identify a person on a public tracking page
 * without handing out their full name.
 *
 * Shared because the public parcel projection and the status-log notes written
 * on assignment must agree — a trimmed `deliveryPersonnelName` beside a note
 * reading "Assigned to Cal Rahman" would leak exactly what the trim prevents.
 */
export function firstName(name?: string | null): string | null {
  return name?.trim().split(/\s+/)[0] ?? null;
}
