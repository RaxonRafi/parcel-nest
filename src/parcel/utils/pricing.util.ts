import { DeliveryZone, RouteType, ServiceTier } from '../types/parcel.types';

/**
 * Delivery fee calculation.
 *
 * Deliberately server-side only: the client sends a weight, zones and a tier,
 * never a price. Rates are env-overridable so a change does not need a
 * deploy, and the breakdown is returned alongside the total so a customer can
 * be shown why they are paying what they are paying.
 */
export interface PricingRates {
  /** Base fee for a delivery inside Dhaka city. */
  baseFee: number;
  /** Base fee when either end is in the Dhaka suburbs. */
  suburbBaseFee: number;
  /** Base fee when either end is outside Dhaka. */
  nationalBaseFee: number;
  perKgFee: number;
  /** Weight included in the base fee before per-kg charging starts. */
  includedKg: number;
  /** Percentage of `codAmount` charged for handling cash. */
  codFeePercent: number;
  /** Flat surcharge for the express tier. */
  expressFee: number;
  /**
   * Charged when a parcel goes back to its sender, as a percentage of the
   * delivery charge (base + weight + express — not the cash-handling fee,
   * since no cash was handled).
   */
  returnFeePercent: number;
  minimumFee: number;
}

export const DEFAULT_RATES: PricingRates = {
  baseFee: 60,
  suburbBaseFee: 80,
  nationalBaseFee: 120,
  perKgFee: 25,
  includedKg: 1,
  codFeePercent: 1,
  expressFee: 50,
  returnFeePercent: 50,
  minimumFee: 60,
};

export interface RouteOptions {
  pickupZone?: DeliveryZone;
  deliveryZone?: DeliveryZone;
  serviceTier?: ServiceTier;
}

/**
 * Frozen onto the parcel at booking. `route`, `serviceTier` and `expressFee`
 * are optional because breakdowns stored before zones existed lack them.
 */
export interface FeeBreakdown {
  route?: RouteType;
  serviceTier?: ServiceTier;
  baseFee: number;
  weightFee: number;
  codFee: number;
  expressFee?: number;
  total: number;
}

/**
 * Inside the city when both ends are; national as soon as either end is
 * outside Dhaka; suburban for any other mix of city and suburb.
 */
export function routeFor(
  pickupZone: DeliveryZone = DeliveryZone.DHAKA_CITY,
  deliveryZone: DeliveryZone = DeliveryZone.DHAKA_CITY,
): RouteType {
  if (
    pickupZone === DeliveryZone.OUTSIDE_DHAKA ||
    deliveryZone === DeliveryZone.OUTSIDE_DHAKA
  ) {
    return RouteType.NATIONAL;
  }
  if (
    pickupZone === DeliveryZone.DHAKA_CITY &&
    deliveryZone === DeliveryZone.DHAKA_CITY
  ) {
    return RouteType.CITY;
  }
  return RouteType.SUBURB;
}

/** Express is a same-day / next-day promise only a Dhaka route can keep. */
export function expressAvailable(route: RouteType): boolean {
  return route !== RouteType.NATIONAL;
}

export function calculateDeliveryFee(
  weightKg: number,
  codAmount: number,
  rates: PricingRates = DEFAULT_RATES,
  options: RouteOptions = {},
): FeeBreakdown {
  const route = routeFor(options.pickupZone, options.deliveryZone);
  const serviceTier = options.serviceTier ?? ServiceTier.STANDARD;

  const baseFee = {
    [RouteType.CITY]: rates.baseFee,
    [RouteType.SUBURB]: rates.suburbBaseFee,
    [RouteType.NATIONAL]: rates.nationalBaseFee,
  }[route];
  const chargeableKg = Math.max(0, weightKg - rates.includedKg);
  // Part-kilograms round up: couriers charge by the slot, not the gram.
  const weightFee = Math.ceil(chargeableKg) * rates.perKgFee;
  const codFee = round2((codAmount * rates.codFeePercent) / 100);
  const expressFee = serviceTier === ServiceTier.EXPRESS ? rates.expressFee : 0;

  const total = Math.max(
    rates.minimumFee,
    round2(baseFee + weightFee + codFee + expressFee),
  );

  return { route, serviceTier, baseFee, weightFee, codFee, expressFee, total };
}

/**
 * What sending a parcel back costs. Older parcels without a breakdown are
 * charged on their whole fee, which is the closest thing available.
 */
export function calculateReturnFee(
  breakdown: FeeBreakdown | null,
  deliveryFee: number,
  rates: PricingRates = DEFAULT_RATES,
): number {
  const deliveryCharge = breakdown
    ? breakdown.baseFee + breakdown.weightFee + (breakdown.expressFee ?? 0)
    : deliveryFee;

  return round2((deliveryCharge * rates.returnFeePercent) / 100);
}

/** Hours from pickup to the door, by route and tier. */
const TRANSIT_HOURS: Record<RouteType, Record<ServiceTier, number>> = {
  [RouteType.CITY]: {
    [ServiceTier.STANDARD]: 24,
    [ServiceTier.EXPRESS]: 8,
  },
  [RouteType.SUBURB]: {
    [ServiceTier.STANDARD]: 48,
    [ServiceTier.EXPRESS]: 24,
  },
  [RouteType.NATIONAL]: {
    [ServiceTier.STANDARD]: 72,
    // Never offered — see `expressAvailable` — but the table stays total.
    [ServiceTier.EXPRESS]: 72,
  },
};

/**
 * When a parcel should reach its receiver: the end of the pickup window (or
 * the moment it was booked, without one) plus the route's transit time.
 */
export function estimateDeliveryAt(
  pickupBy: Date,
  route: RouteType,
  serviceTier: ServiceTier = ServiceTier.STANDARD,
): Date {
  return new Date(
    pickupBy.getTime() + TRANSIT_HOURS[route][serviceTier] * 3_600_000,
  );
}

export function ratesFromEnv(
  read: (key: string) => string | undefined,
): PricingRates {
  const num = (key: string, fallback: number): number => {
    const raw = read(key);
    const parsed = Number(raw);
    return raw !== undefined && raw !== '' && Number.isFinite(parsed)
      ? parsed
      : fallback;
  };

  return {
    baseFee: num('PRICING_BASE_FEE', DEFAULT_RATES.baseFee),
    suburbBaseFee: num('PRICING_SUBURB_BASE_FEE', DEFAULT_RATES.suburbBaseFee),
    nationalBaseFee: num(
      'PRICING_NATIONAL_BASE_FEE',
      DEFAULT_RATES.nationalBaseFee,
    ),
    perKgFee: num('PRICING_PER_KG_FEE', DEFAULT_RATES.perKgFee),
    includedKg: num('PRICING_INCLUDED_KG', DEFAULT_RATES.includedKg),
    codFeePercent: num('PRICING_COD_FEE_PERCENT', DEFAULT_RATES.codFeePercent),
    expressFee: num('PRICING_EXPRESS_FEE', DEFAULT_RATES.expressFee),
    returnFeePercent: num(
      'PRICING_RETURN_FEE_PERCENT',
      DEFAULT_RATES.returnFeePercent,
    ),
    minimumFee: num('PRICING_MINIMUM_FEE', DEFAULT_RATES.minimumFee),
  };
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
