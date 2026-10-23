import { DeliveryZone, RouteType, ServiceTier } from '../types/parcel.types';
import {
  DEFAULT_RATES,
  calculateDeliveryFee,
  calculateReturnFee,
  estimateDeliveryAt,
  expressAvailable,
  ratesFromEnv,
  routeFor,
} from './pricing.util';

describe('calculateDeliveryFee', () => {
  it('charges only the base fee within the included weight', () => {
    expect(calculateDeliveryFee(1, 0).total).toBe(DEFAULT_RATES.baseFee);
    expect(calculateDeliveryFee(0.4, 0).total).toBe(DEFAULT_RATES.baseFee);
  });

  it('adds the per-kg fee above the included weight', () => {
    // 3kg − 1kg included = 2 chargeable → 60 + 2×25
    expect(calculateDeliveryFee(3, 0).total).toBe(110);
  });

  it('rounds part-kilograms up', () => {
    // 2.1kg − 1kg = 1.1 chargeable, billed as 2 slots
    expect(calculateDeliveryFee(2.1, 0).total).toBe(110);
  });

  it('adds a percentage for cash on delivery', () => {
    const fee = calculateDeliveryFee(1, 5000);
    expect(fee.codFee).toBe(50);
    expect(fee.total).toBe(110);
  });

  it('never returns less than the minimum fee', () => {
    const rates = { ...DEFAULT_RATES, baseFee: 5, minimumFee: 40 };
    expect(calculateDeliveryFee(0.5, 0, rates).total).toBe(40);
  });

  it('returns a breakdown that sums to the total', () => {
    const fee = calculateDeliveryFee(4, 1000);
    expect(fee.baseFee + fee.weightFee + fee.codFee).toBe(fee.total);
  });

  it('reads overrides from the environment', () => {
    const rates = ratesFromEnv((key) =>
      key === 'PRICING_BASE_FEE' ? '100' : undefined,
    );
    expect(rates.baseFee).toBe(100);
    expect(rates.perKgFee).toBe(DEFAULT_RATES.perKgFee);
  });

  it('ignores unparseable overrides rather than producing NaN', () => {
    const rates = ratesFromEnv(() => 'not-a-number');
    expect(rates.baseFee).toBe(DEFAULT_RATES.baseFee);
  });
});

describe('routes and tiers', () => {
  it('prices inside the city exactly as before zones existed', () => {
    expect(calculateDeliveryFee(3, 500)).toMatchObject({
      route: RouteType.CITY,
      baseFee: 60,
      total: 115,
    });
  });

  it('works out the route from the two zones', () => {
    const { DHAKA_CITY, DHAKA_SUBURB, OUTSIDE_DHAKA } = DeliveryZone;
    expect(routeFor(DHAKA_CITY, DHAKA_CITY)).toBe(RouteType.CITY);
    expect(routeFor(DHAKA_CITY, DHAKA_SUBURB)).toBe(RouteType.SUBURB);
    expect(routeFor(DHAKA_SUBURB, DHAKA_SUBURB)).toBe(RouteType.SUBURB);
    expect(routeFor(OUTSIDE_DHAKA, DHAKA_CITY)).toBe(RouteType.NATIONAL);
    expect(routeFor(DHAKA_SUBURB, OUTSIDE_DHAKA)).toBe(RouteType.NATIONAL);
  });

  it('uses the route’s base fee', () => {
    const suburb = calculateDeliveryFee(1, 0, DEFAULT_RATES, {
      deliveryZone: DeliveryZone.DHAKA_SUBURB,
    });
    const national = calculateDeliveryFee(1, 0, DEFAULT_RATES, {
      pickupZone: DeliveryZone.OUTSIDE_DHAKA,
    });
    expect(suburb.total).toBe(80);
    expect(national.total).toBe(120);
  });

  it('adds the express surcharge, and offers express only on Dhaka routes', () => {
    const fee = calculateDeliveryFee(1, 0, DEFAULT_RATES, {
      serviceTier: ServiceTier.EXPRESS,
    });
    expect(fee).toMatchObject({ expressFee: 50, total: 110 });
    expect(fee.baseFee + fee.weightFee + fee.codFee + fee.expressFee!).toBe(
      fee.total,
    );
    expect(expressAvailable(RouteType.SUBURB)).toBe(true);
    expect(expressAvailable(RouteType.NATIONAL)).toBe(false);
  });
});

describe('calculateReturnFee', () => {
  it('charges a share of the delivery charge, never of the cash fee', () => {
    const breakdown = calculateDeliveryFee(1.5, 2000); // 60 + 25 + 20
    expect(calculateReturnFee(breakdown, breakdown.total)).toBe(42.5);
  });

  it('falls back to the whole fee for a parcel without a breakdown', () => {
    expect(calculateReturnFee(null, 90)).toBe(45);
  });
});

describe('estimateDeliveryAt', () => {
  const from = new Date('2026-10-20T10:00:00Z');

  it('adds the route’s transit time to the pickup time', () => {
    expect(estimateDeliveryAt(from, RouteType.CITY).toISOString()).toBe(
      '2026-10-21T10:00:00.000Z',
    );
    expect(
      estimateDeliveryAt(from, RouteType.CITY, ServiceTier.EXPRESS).toISOString(),
    ).toBe('2026-10-20T18:00:00.000Z');
    expect(estimateDeliveryAt(from, RouteType.NATIONAL).toISOString()).toBe(
      '2026-10-23T10:00:00.000Z',
    );
  });
});

describe('ratesFromEnv for the new rates', () => {
  it('reads them, and treats an empty value as unset rather than zero', () => {
    const env: Record<string, string> = {
      PRICING_NATIONAL_BASE_FEE: '150',
      PRICING_EXPRESS_FEE: '',
    };
    const rates = ratesFromEnv((key) => env[key]);
    expect(rates.nationalBaseFee).toBe(150);
    expect(rates.expressFee).toBe(DEFAULT_RATES.expressFee);
  });
});
