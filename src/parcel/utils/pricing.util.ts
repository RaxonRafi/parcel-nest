/**
 * Delivery fee calculation.
 *
 * Deliberately server-side only: the client sends a weight, never a price.
 * Rates are env-overridable so a change does not need a deploy, and the
 * breakdown is returned alongside the total so a customer can be shown why
 * they are paying what they are paying.
 */
export interface PricingRates {
  baseFee: number;
  perKgFee: number;
  /** Weight included in the base fee before per-kg charging starts. */
  includedKg: number;
  /** Percentage of `codAmount` charged for handling cash. */
  codFeePercent: number;
  minimumFee: number;
}

export const DEFAULT_RATES: PricingRates = {
  baseFee: 60,
  perKgFee: 25,
  includedKg: 1,
  codFeePercent: 1,
  minimumFee: 60,
};

export interface FeeBreakdown {
  baseFee: number;
  weightFee: number;
  codFee: number;
  total: number;
}

export function calculateDeliveryFee(
  weightKg: number,
  codAmount: number,
  rates: PricingRates = DEFAULT_RATES,
): FeeBreakdown {
  const chargeableKg = Math.max(0, weightKg - rates.includedKg);
  // Part-kilograms round up: couriers charge by the slot, not the gram.
  const weightFee = Math.ceil(chargeableKg) * rates.perKgFee;
  const codFee = round2((codAmount * rates.codFeePercent) / 100);

  const total = Math.max(
    rates.minimumFee,
    round2(rates.baseFee + weightFee + codFee),
  );

  return { baseFee: rates.baseFee, weightFee, codFee, total };
}

export function ratesFromEnv(
  read: (key: string) => string | undefined,
): PricingRates {
  const num = (key: string, fallback: number): number => {
    const parsed = Number(read(key));
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  return {
    baseFee: num('PRICING_BASE_FEE', DEFAULT_RATES.baseFee),
    perKgFee: num('PRICING_PER_KG_FEE', DEFAULT_RATES.perKgFee),
    includedKg: num('PRICING_INCLUDED_KG', DEFAULT_RATES.includedKg),
    codFeePercent: num('PRICING_COD_FEE_PERCENT', DEFAULT_RATES.codFeePercent),
    minimumFee: num('PRICING_MINIMUM_FEE', DEFAULT_RATES.minimumFee),
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
