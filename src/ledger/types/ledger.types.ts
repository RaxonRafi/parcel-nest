/**
 * Whose money an entry moves.
 *
 * - `MERCHANT` — a sender. A positive balance is what the company owes them
 *   (cash collected on their behalf, refunds); a negative one is what they
 *   owe the company (fees not yet covered).
 * - `COURIER` — a delivery person. A positive balance is cash they collected
 *   at the door and have not yet handed in.
 */
export enum LedgerAccountType {
  MERCHANT = 'MERCHANT',
  COURIER = 'COURIER',
}

/**
 * What an entry records. Values are persisted, so treat this as an
 * append-only list. The sign each one carries is fixed:
 *
 * Merchant account
 * - `DELIVERY_FEE`      − the fee, charged at booking
 * - `FEE_ADJUSTMENT`    ± the difference when a pending parcel is re-priced
 * - `FEE_REVERSAL`      + every fee charged, given back when a parcel is cancelled
 * - `COD_FEE_REVERSAL`  + the cash-handling fee, given back when a COD parcel
 *                         is returned and no cash was ever handled
 * - `RETURN_FEE`        − the charge for carrying a parcel back
 * - `COD_CREDIT`        + the cash collected from the receiver
 * - `FEE_PAYMENT`       + a fee paid online
 * - `PAYOUT`            − money sent to the merchant
 *
 * Courier account
 * - `COD_COLLECTED`     + cash taken at the door
 * - `COD_DEPOSIT`       − cash handed in at the hub
 */
export enum LedgerEntryType {
  DELIVERY_FEE = 'DELIVERY_FEE',
  FEE_ADJUSTMENT = 'FEE_ADJUSTMENT',
  FEE_REVERSAL = 'FEE_REVERSAL',
  COD_FEE_REVERSAL = 'COD_FEE_REVERSAL',
  RETURN_FEE = 'RETURN_FEE',
  COD_CREDIT = 'COD_CREDIT',
  FEE_PAYMENT = 'FEE_PAYMENT',
  PAYOUT = 'PAYOUT',
  COD_COLLECTED = 'COD_COLLECTED',
  COD_DEPOSIT = 'COD_DEPOSIT',
}

/** The fee charges a cancellation unwinds. */
export const FEE_CHARGE_TYPES: readonly LedgerEntryType[] = [
  LedgerEntryType.DELIVERY_FEE,
  LedgerEntryType.FEE_ADJUSTMENT,
  LedgerEntryType.FEE_REVERSAL,
];

export enum PayoutMethod {
  BANK = 'BANK',
  BKASH = 'BKASH',
  NAGAD = 'NAGAD',
  CASH = 'CASH',
}

/** An entry before it is saved — what parcel and payment code hand over. */
export interface LedgerDraft {
  accountType: LedgerAccountType;
  accountId: string;
  type: LedgerEntryType;
  /** Signed, in BDT. */
  amount: number;
  parcelId?: string | null;
  trackingId?: string | null;
  note?: string | null;
  reference?: string | null;
  createdById?: string | null;
}

export interface LedgerBalanceRow {
  userId: string;
  name: string;
  email: string;
  balance: number;
  entries: number;
}
