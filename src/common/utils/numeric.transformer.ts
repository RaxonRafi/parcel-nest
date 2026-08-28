import { ValueTransformer } from 'typeorm';

/**
 * Postgres `numeric` is returned by node-postgres as a string, because it can
 * hold values a JS number cannot represent exactly. Money here is small enough
 * that a number is safe, and returning one keeps every caller — and every JSON
 * response — from having to parse it.
 */
export const numericTransformer: ValueTransformer = {
  to: (value: number | null) => value,
  from: (value: string | null): number | null =>
    value === null ? null : Number(value),
};
