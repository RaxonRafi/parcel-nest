import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const SANDBOX_HOST = 'https://sandbox.sslcommerz.com';
const LIVE_HOST = 'https://securepay.sslcommerz.com';

/** Long enough for a slow gateway, short enough not to hang a request. */
const REQUEST_TIMEOUT_MS = 20_000;

export interface SessionRequest {
  tranId: string;
  amount: number;
  currency: string;
  successUrl: string;
  failUrl: string;
  cancelUrl: string;
  ipnUrl: string;
  customer: {
    name: string;
    email: string;
    phone: string;
    address: string;
  };
  productName: string;
  /** Echoed back as `value_a` on every callback. */
  reference: string;
}

/** The fields of a validation answer this API relies on. */
export interface ValidationResult {
  status: string;
  tran_id?: string;
  val_id?: string;
  amount?: string;
  currency?: string;
  bank_tran_id?: string;
  card_type?: string;
  /** "0" is fine; "1" means the gateway wants the payment held for review. */
  risk_level?: string;
  risk_title?: string;
}

export class GatewayError extends Error {}

/**
 * SSLCommerz, the gateway most Bangladeshi merchants use — cards, bKash,
 * Nagad, Rocket and internet banking behind one hosted page.
 *
 * Two calls: open a session (the sender's browser is sent to the URL it
 * returns), and validate a finished one. The validation call is the only
 * thing a payment is ever believed on — what the browser posts back to the
 * success URL can be forged by anyone.
 */
@Injectable()
export class SslCommerzGateway {
  private readonly logger = new Logger(SslCommerzGateway.name);

  constructor(private readonly config: ConfigService) {}

  isEnabled(): boolean {
    return (
      this.config.get<string>('PAYMENT_SSLCOMMERZ_ENABLED') === 'true' &&
      !!this.config.get<string>('SSLCOMMERZ_STORE_ID') &&
      !!this.config.get<string>('SSLCOMMERZ_STORE_PASSWORD')
    );
  }

  async createSession(request: SessionRequest): Promise<string> {
    const form = new URLSearchParams({
      store_id: this.storeId(),
      store_passwd: this.storePassword(),
      total_amount: request.amount.toFixed(2),
      currency: request.currency,
      tran_id: request.tranId,
      success_url: request.successUrl,
      fail_url: request.failUrl,
      cancel_url: request.cancelUrl,
      ipn_url: request.ipnUrl,
      cus_name: request.customer.name,
      cus_email: request.customer.email,
      cus_phone: request.customer.phone,
      cus_add1: request.customer.address,
      cus_city: 'Dhaka',
      cus_postcode: '1000',
      cus_country: 'Bangladesh',
      shipping_method: 'NO',
      num_of_item: '1',
      product_name: request.productName,
      product_category: 'Delivery',
      product_profile: 'non-physical-goods',
      value_a: request.reference,
    });

    const body = await this.request<{
      status?: string;
      failedreason?: string;
      GatewayPageURL?: string;
    }>(`${this.host()}/gwprocess/v4/api.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });

    if (body.status !== 'SUCCESS' || !body.GatewayPageURL) {
      throw new GatewayError(
        body.failedreason || 'The payment gateway refused to open a session',
      );
    }

    return body.GatewayPageURL;
  }

  async validate(valId: string): Promise<ValidationResult> {
    const query = new URLSearchParams({
      val_id: valId,
      store_id: this.storeId(),
      store_passwd: this.storePassword(),
      format: 'json',
    });

    return this.request<ValidationResult>(
      `${this.host()}/validator/api/validationserverAPI.php?${query.toString()}`,
      { method: 'GET' },
    );
  }

  private async request<T>(url: string, init: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      // The URL carries the store password in its query string: never log it.
      this.logger.warn(`SSLCommerz unreachable: ${message}`);
      throw new GatewayError('The payment gateway could not be reached');
    }

    if (!response.ok) {
      throw new GatewayError(
        `The payment gateway answered ${response.status}`,
      );
    }

    try {
      return (await response.json()) as T;
    } catch {
      throw new GatewayError('The payment gateway sent an unreadable answer');
    }
  }

  private host(): string {
    // Sandbox unless explicitly switched off, so a misconfigured deploy
    // cannot take real money by accident.
    return this.config.get<string>('SSLCOMMERZ_SANDBOX') === 'false'
      ? LIVE_HOST
      : SANDBOX_HOST;
  }

  private storeId(): string {
    return this.config.getOrThrow<string>('SSLCOMMERZ_STORE_ID');
  }

  private storePassword(): string {
    return this.config.getOrThrow<string>('SSLCOMMERZ_STORE_PASSWORD');
  }
}
