/** Where a payment attempt stands. Persisted, so treat as append-only. */
export enum PaymentState {
  /** A gateway session was opened; the sender has not finished paying. */
  INITIATED = 'INITIATED',
  PAID = 'PAID',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  /**
   * The gateway took the money but flagged it as risky. Nothing is credited
   * until someone has looked at it in the SSLCommerz merchant panel.
   */
  REVIEW = 'REVIEW',
}

export enum PaymentProvider {
  SSLCOMMERZ = 'SSLCOMMERZ',
}

/** What the sender's browser is sent back to the client with. */
export type PaymentOutcome = 'paid' | 'failed' | 'cancelled' | 'review';

export interface CheckoutSession {
  paymentId: string;
  tranId: string;
  amount: number;
  currency: string;
  /** Send the sender's browser here to pay. */
  gatewayUrl: string;
}
