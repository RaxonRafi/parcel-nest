import { Parcel } from '../entities/parcel.entity';
import {
  DeliveryZone,
  ParcelStatus,
  PaymentStatus,
  ServiceTier,
} from '../types/parcel.types';
import { renderInvoice, renderLabel } from './parcel-documents.util';
import { escapeText, formatMoney, PdfCanvas, wrap } from './pdf.util';
import { calculateDeliveryFee } from './pricing.util';

/** Checks the cross-reference table points at each object it claims to. */
function assertWellFormed(pdf: Buffer): void {
  const text = pdf.toString('latin1');
  expect(text.startsWith('%PDF-1.4')).toBe(true);
  expect(text.trimEnd().endsWith('%%EOF')).toBe(true);

  const xrefAt = Number(/startxref\n(\d+)/.exec(text)?.[1]);
  expect(text.slice(xrefAt, xrefAt + 4)).toBe('xref');

  const offsets = [...text.slice(xrefAt).matchAll(/^(\d{10}) 00000 n $/gm)].map(
    (match) => Number(match[1]),
  );
  offsets.forEach((offset, index) => {
    expect(text.startsWith(`${index + 1} 0 obj\n`, offset)).toBe(true);
  });
}

describe('PdfCanvas', () => {
  it('writes a PDF whose cross-reference table is right', () => {
    const pdf = new PdfCanvas(200, 200)
      .text(10, 10, 'Hello (world)')
      .rect(10, 40, 50, 20, { fill: true })
      .qr(10, 70, 60, 'https://example.com/track/TRK-1')
      .toBuffer();
    assertWellFormed(pdf);
  });

  it('escapes delimiters and replaces what WinAnsi cannot show', () => {
    expect(escapeText('a (b) \\ c')).toBe('a \\(b\\) \\\\ c');
    expect(escapeText('“Hi” — রহিম')).toBe('"Hi" - ????');
  });

  it('wraps on words and breaks a word longer than the line', () => {
    expect(wrap('one two three four', 40, 10)).toEqual(['one two', 'three', 'four']);
    expect(wrap('x'.repeat(20), 40, 10)).toEqual(['xxxxxxxx', 'xxxxxxxx', 'xxxx']);
  });

  it('formats taka with two decimals and thousands', () => {
    expect(formatMoney(1895)).toBe('BDT 1,895.00');
  });
});

describe('parcel documents', () => {
  const parcel = {
    trackingId: 'TRK-7K2M9QX4T1VB',
    status: ParcelStatus.DELIVERED,
    senderName: 'Shop Owner',
    senderPhone: '+8801700000000',
    receiverName: 'Rahim Uddin',
    receiverPhone: '+8801800000000',
    pickupAddress: 'Warehouse 3, Tejgaon, Dhaka',
    deliveryAddress: 'House 7, Road 2, Dhanmondi, Dhaka',
    pickupZone: DeliveryZone.DHAKA_CITY,
    deliveryZone: DeliveryZone.DHAKA_CITY,
    serviceTier: ServiceTier.STANDARD,
    weightKg: 1.5,
    codAmount: 2000,
    isCodCollected: true,
    deliveryFee: 105,
    feeBreakdown: calculateDeliveryFee(1.5, 2000),
    returnFee: null,
    paymentStatus: PaymentStatus.NOT_REQUIRED,
    estimatedDeliveryAt: new Date('2026-10-21T10:00:00Z'),
    pickupWindowStart: null,
    createdAt: new Date('2026-10-20T10:00:00Z'),
    sender: { email: 'shop@test.com' },
  } as unknown as Parcel;

  it('renders a label with the cash to collect', () => {
    const pdf = renderLabel(parcel, 'https://app.test/track/TRK-7K2M9QX4T1VB');
    assertWellFormed(pdf);
    const text = pdf.toString('latin1');
    expect(text).toContain('(COLLECT CASH)');
    expect(text).toContain('(BDT 2,000.00)');
  });

  it('renders an invoice that nets the fee off the cash', () => {
    const text = renderInvoice(parcel, 'https://app.test/t').toString('latin1');
    expect(text).toContain('(Cash handling)');
    expect(text).toContain('BDT 1,895.00 payable to you');
  });

  it('shows a returned parcel’s cash fee as refunded', () => {
    const text = renderInvoice(
      { ...parcel, status: ParcelStatus.RETURNED_TO_SENDER, returnFee: 42.5, isCodCollected: false },
      'https://app.test/t',
    ).toString('latin1');
    expect(text).toContain('(Return to sender)');
    expect(text).toContain('Cash handling refunded');
    // 105 − 20 + 42.50
    expect(text).toContain('(BDT 127.50)');
  });
});
