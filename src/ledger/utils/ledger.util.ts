import { Parcel } from '../../parcel/entities/parcel.entity';
import { round2 } from '../../parcel/utils/pricing.util';
import {
  LedgerAccountType,
  LedgerDraft,
  LedgerEntryType,
} from '../types/ledger.types';

/**
 * The entries each parcel event produces. Pure, so the money rules can be
 * read — and tested — apart from the code that saves them.
 *
 * In every case the merchant is the parcel's sender and the courier is
 * whoever is assigned at the moment of the event.
 */

const merchant = (parcel: Parcel) => ({
  accountType: LedgerAccountType.MERCHANT,
  accountId: parcel.sender.id,
  parcelId: parcel.id ?? null,
  trackingId: parcel.trackingId,
});

/** Booking charges the whole fee up front. */
export function bookingEntries(parcel: Parcel): LedgerDraft[] {
  return [
    {
      ...merchant(parcel),
      type: LedgerEntryType.DELIVERY_FEE,
      amount: -parcel.deliveryFee,
    },
  ];
}

/** A re-priced pending parcel is charged (or credited) the difference. */
export function repricingEntries(
  parcel: Parcel,
  previousFee: number,
): LedgerDraft[] {
  const difference = round2(parcel.deliveryFee - previousFee);
  if (difference === 0) return [];

  return [
    {
      ...merchant(parcel),
      type: LedgerEntryType.FEE_ADJUSTMENT,
      amount: -difference,
      note: `Fee changed from ${previousFee} to ${parcel.deliveryFee}`,
    },
  ];
}

/**
 * Cancelling gives back whatever fee is currently charged — `feeCharged` is
 * the (negative) sum of the parcel's fee entries so far, which is 0 for a
 * parcel booked before the ledger existed.
 */
export function cancellationEntries(
  parcel: Parcel,
  feeCharged: number,
): LedgerDraft[] {
  if (feeCharged === 0) return [];

  return [
    {
      ...merchant(parcel),
      type: LedgerEntryType.FEE_REVERSAL,
      amount: -feeCharged,
      note: 'Parcel cancelled',
    },
  ];
}

/**
 * Handing a COD parcel over moves its cash twice: into the courier's hands,
 * and onto the merchant's balance. A prepaid parcel moves no money here.
 */
export function deliveryEntries(parcel: Parcel): LedgerDraft[] {
  if (!(parcel.codAmount > 0)) return [];

  const courier = parcel.deliveryPersonnel;
  if (!courier) {
    // `submitDeliveryProof` refuses this; reaching here is a bug upstream.
    throw new Error(
      `COD parcel ${parcel.trackingId} delivered with no courier to hold the cash`,
    );
  }

  return [
    {
      accountType: LedgerAccountType.COURIER,
      accountId: courier.id,
      parcelId: parcel.id,
      trackingId: parcel.trackingId,
      type: LedgerEntryType.COD_COLLECTED,
      amount: parcel.codAmount,
    },
    {
      ...merchant(parcel),
      type: LedgerEntryType.COD_CREDIT,
      amount: parcel.codAmount,
    },
  ];
}

/**
 * A returned parcel handled no cash, so its cash-handling fee comes back,
 * and the trip back is charged.
 */
export function returnEntries(parcel: Parcel): LedgerDraft[] {
  const entries: LedgerDraft[] = [];
  const codFee = parcel.feeBreakdown?.codFee ?? 0;

  if (codFee > 0) {
    entries.push({
      ...merchant(parcel),
      type: LedgerEntryType.COD_FEE_REVERSAL,
      amount: codFee,
      note: 'No cash was collected',
    });
  }
  if ((parcel.returnFee ?? 0) > 0) {
    entries.push({
      ...merchant(parcel),
      type: LedgerEntryType.RETURN_FEE,
      amount: -(parcel.returnFee as number),
    });
  }

  return entries;
}
