import {
  DEFAULT_RATES,
  calculateDeliveryFee,
  ratesFromEnv,
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
