/** Shared so the DTOs, the reset flow and Swagger cannot drift apart. */
export const PASSWORD_MIN_LENGTH = 8;

/** Loose on purpose — numbers vary by country and this is not a billing system. */
export const PHONE_REGEX = /^\+?[0-9\s-]{6,20}$/;
