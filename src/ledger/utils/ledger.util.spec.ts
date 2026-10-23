import { Parcel } from '../../parcel/entities/parcel.entity';
import { calculateDeliveryFee } from '../../parcel/utils/pricing.util';
import { User } from '../../user/entities/user.entity';
import { LedgerAccountType, LedgerEntryType } from '../types/ledger.types';
import {
  bookingEntries,
  cancellationEntries,
  deliveryEntries,
  repricingEntries,
  returnEntries,
} from './ledger.util';

const sum = (entries: { amount: number }[]) =>
  entries.reduce((total, entry) => total + entry.amount, 0);

/** The 2,000 taka COD order: 1.5 kg inside Dhaka, fee 105. */
const codParcel = (overrides: Partial<Parcel> = {}): Parcel => {
  const feeBreakdown = calculateDeliveryFee(1.5, 2000);
  return {
    id: 'parcel-1',
    trackingId: 'TRK-TEST',
    sender: { id: 'shop' } as User,
    deliveryPersonnel: { id: 'rider' } as User,
    codAmount: 2000,
    deliveryFee: feeBreakdown.total,
    feeBreakdown,
    returnFee: null,
    ...overrides,
  } as Parcel;
};

describe('ledger entries', () => {
  it('charges the shop the fee at booking', () => {
    expect(bookingEntries(codParcel())).toEqual([
      expect.objectContaining({
        accountType: LedgerAccountType.MERCHANT,
        accountId: 'shop',
        type: LedgerEntryType.DELIVERY_FEE,
        amount: -105,
      }),
    ]);
  });

  it('moves COD cash to the rider and onto the shop’s balance on delivery', () => {
    const entries = deliveryEntries(codParcel());
    expect(entries).toEqual([
      expect.objectContaining({
        accountType: LedgerAccountType.COURIER,
        accountId: 'rider',
        type: LedgerEntryType.COD_COLLECTED,
        amount: 2000,
      }),
      expect.objectContaining({
        accountType: LedgerAccountType.MERCHANT,
        accountId: 'shop',
        type: LedgerEntryType.COD_CREDIT,
        amount: 2000,
      }),
    ]);
    // Booking then delivery: the shop ends up owed 1,895.
    const shop = [...bookingEntries(codParcel()), ...entries].filter(
      (entry) => entry.accountType === LedgerAccountType.MERCHANT,
    );
    expect(sum(shop)).toBe(1895);
  });

  it('moves no money when a prepaid parcel is delivered', () => {
    expect(deliveryEntries(codParcel({ codAmount: 0 }))).toEqual([]);
  });

  it('refuses COD cash with no rider to hold it', () => {
    expect(() =>
      deliveryEntries(codParcel({ deliveryPersonnel: null })),
    ).toThrow(/no courier/);
  });

  it('gives the cash fee back and charges the trip on a return', () => {
    const entries = returnEntries(codParcel({ returnFee: 42.5 }));
    expect(entries.map((entry) => [entry.type, entry.amount])).toEqual([
      [LedgerEntryType.COD_FEE_REVERSAL, 20],
      [LedgerEntryType.RETURN_FEE, -42.5],
    ]);
  });

  it('charges or credits only the difference when a booking is re-priced', () => {
    expect(repricingEntries(codParcel({ deliveryFee: 130 }), 105)).toEqual([
      expect.objectContaining({
        type: LedgerEntryType.FEE_ADJUSTMENT,
        amount: -25,
      }),
    ]);
    expect(repricingEntries(codParcel(), 105)).toEqual([]);
  });

  it('gives back whatever fee is charged on cancellation, and nothing when none was', () => {
    expect(cancellationEntries(codParcel(), -130)).toEqual([
      expect.objectContaining({ type: LedgerEntryType.FEE_REVERSAL, amount: 130 }),
    ]);
    expect(cancellationEntries(codParcel(), 0)).toEqual([]);
  });
});
