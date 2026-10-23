import {
  deliveryCodeMatches,
  generateDeliveryCode,
  hashDeliveryCode,
} from './delivery-code.util';

describe('delivery codes', () => {
  it('are six digits, leading zeros kept', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateDeliveryCode()).toMatch(/^\d{6}$/);
    }
  });

  it('verify against their own parcel only, and only with the server secret', () => {
    const hash = hashDeliveryCode('parcel-1', '042917', 'secret');

    expect(deliveryCodeMatches('parcel-1', '042917', hash, 'secret')).toBe(true);
    expect(deliveryCodeMatches('parcel-1', '042918', hash, 'secret')).toBe(false);
    expect(deliveryCodeMatches('parcel-2', '042917', hash, 'secret')).toBe(false);
    expect(deliveryCodeMatches('parcel-1', '042917', hash, 'other')).toBe(false);
  });

  it('never store the code itself', () => {
    expect(hashDeliveryCode('parcel-1', '042917', 'secret')).not.toContain(
      '042917',
    );
  });
});
