import { Parcel } from '../entities/parcel.entity';
import { ParcelStatus, PaymentStatus, RouteType } from '../types/parcel.types';
import { formatMoney, PdfCanvas } from './pdf.util';
import { routeFor } from './pricing.util';

const ZONE_LABELS: Record<string, string> = {
  DHAKA_CITY: 'Dhaka city',
  DHAKA_SUBURB: 'Dhaka suburb',
  OUTSIDE_DHAKA: 'Outside Dhaka',
};

const ROUTE_LABELS: Record<RouteType, string> = {
  [RouteType.CITY]: 'Inside Dhaka',
  [RouteType.SUBURB]: 'Dhaka suburbs',
  [RouteType.NATIONAL]: 'Nationwide',
};

const date = (value: Date | string | null | undefined): string =>
  value ? new Date(value).toISOString().slice(0, 10) : '-';

const dateTime = (value: Date | string): string =>
  new Date(value).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

/**
 * A 4 x 6 inch shipping label: what a hub needs to sort the parcel and a
 * courier needs at the door. The QR code opens the public tracking page, so
 * scanning it at pickup or drop-off needs nothing but a phone camera.
 */
export function renderLabel(parcel: Parcel, trackingUrl: string): Buffer {
  const pdf = new PdfCanvas(288, 432);
  const margin = 14;
  const inner = 288 - margin * 2;
  const route = routeFor(parcel.pickupZone, parcel.deliveryZone);

  // Headline: tier and route, readable from across a sorting floor.
  pdf.rect(0, 0, 288, 34, { fill: true });
  pdf.invertedText(margin, 9, parcel.serviceTier, { size: 16, bold: true });
  pdf.invertedText(150, 12, ROUTE_LABELS[route], { size: 11, bold: true });

  pdf.qr(margin, 46, 104, trackingUrl);
  pdf.text(128, 48, 'TRACKING', { size: 7 });
  pdf.paragraph(128, 58, parcel.trackingId, 146, { size: 12, bold: true });
  pdf.text(128, 92, `Booked ${date(parcel.createdAt)}`, { size: 8 });
  pdf.text(128, 104, `Weight ${parcel.weightKg} kg`, { size: 8 });
  if (parcel.estimatedDeliveryAt) {
    pdf.text(128, 116, `Due ${date(parcel.estimatedDeliveryAt)}`, { size: 8 });
  }
  if (parcel.pickupWindowStart) {
    pdf.text(128, 128, `Pickup ${dateTime(parcel.pickupWindowStart)}`, {
      size: 7,
    });
  }

  pdf.line(margin, 160, 288 - margin, 160);
  pdf.text(margin, 168, 'DELIVER TO', { size: 7, bold: true });
  pdf.text(margin, 180, parcel.receiverName, { size: 13, bold: true });
  let y = 198;
  if (parcel.receiverPhone) {
    pdf.text(margin, y, parcel.receiverPhone, { size: 11 });
    y += 16;
  }
  y = pdf.paragraph(margin, y, parcel.deliveryAddress, inner, {
    size: 10,
    maxLines: 4,
  });
  pdf.text(margin, y + 2, ZONE_LABELS[parcel.deliveryZone] ?? '', {
    size: 8,
    bold: true,
  });

  pdf.line(margin, 290, 288 - margin, 290);
  pdf.text(margin, 298, 'FROM', { size: 7, bold: true });
  pdf.text(margin, 309, parcel.senderName, { size: 9, bold: true });
  y = 321;
  if (parcel.senderPhone) {
    pdf.text(margin, y, parcel.senderPhone, { size: 8 });
    y += 11;
  }
  pdf.paragraph(margin, y, parcel.pickupAddress, inner, {
    size: 8,
    maxLines: 2,
  });

  // The one number the courier must not get wrong.
  pdf.rect(margin, 370, inner, 48, { fill: parcel.codAmount > 0 });
  if (parcel.codAmount > 0) {
    pdf.invertedText(margin + 8, 376, 'COLLECT CASH', { size: 8, bold: true });
    pdf.invertedText(margin + 8, 390, formatMoney(parcel.codAmount), {
      size: 18,
      bold: true,
    });
  } else {
    pdf.text(margin + 8, 376, 'PREPAID', { size: 8, bold: true });
    pdf.text(margin + 8, 390, 'Collect nothing', { size: 16, bold: true });
  }

  return pdf.toBuffer();
}

/**
 * The sender's record of a booking: what the fee was made of, how it was
 * settled, and — once the parcel is finished — what they are owed for it.
 */
export function renderInvoice(parcel: Parcel, trackingUrl: string): Buffer {
  const pdf = new PdfCanvas(595, 842);
  const left = 50;
  const right = 545;
  const breakdown = parcel.feeBreakdown;
  const route = breakdown?.route ?? routeFor(parcel.pickupZone, parcel.deliveryZone);

  pdf.text(left, 50, 'INVOICE', { size: 24, bold: true });
  pdf.text(left, 82, 'Parcel Delivery', { size: 10 });
  pdf.qr(right - 80, 44, 80, trackingUrl);

  pdf.text(left, 140, 'Invoice number', { size: 8 });
  pdf.text(left, 151, parcel.trackingId, { size: 11, bold: true });
  pdf.text(220, 140, 'Date', { size: 8 });
  pdf.text(220, 151, date(parcel.createdAt), { size: 11, bold: true });
  pdf.text(340, 140, 'Status', { size: 8 });
  pdf.text(340, 151, parcel.status.replace(/_/g, ' '), {
    size: 11,
    bold: true,
  });

  pdf.text(left, 190, 'BILLED TO', { size: 8, bold: true });
  pdf.text(left, 203, parcel.senderName, { size: 11, bold: true });
  let y = 218;
  for (const value of [parcel.sender?.email, parcel.senderPhone]) {
    if (value) {
      pdf.text(left, y, value, { size: 9 });
      y += 13;
    }
  }

  pdf.text(300, 190, 'SHIPMENT', { size: 8, bold: true });
  pdf.text(300, 203, `${ROUTE_LABELS[route]}, ${parcel.serviceTier.toLowerCase()}`, {
    size: 10,
  });
  pdf.text(300, 217, `${parcel.weightKg} kg`, { size: 9 });
  pdf.paragraph(
    300,
    231,
    `To ${parcel.receiverName}, ${parcel.deliveryAddress}`,
    right - 300,
    { size: 9, maxLines: 3 },
  );

  // Charges table.
  y = 300;
  pdf.rect(left, y, right - left, 22, { fill: true, gray: 0.9 });
  pdf.text(left + 8, y + 6, 'Description', { size: 9, bold: true });
  pdf.text(right - 110, y + 6, 'Amount', { size: 9, bold: true });
  y += 30;

  const rows: [string, number][] = breakdown
    ? [
        [`Delivery (${ROUTE_LABELS[route]})`, breakdown.baseFee],
        ['Weight beyond the first kilogram', breakdown.weightFee],
        ['Cash handling', breakdown.codFee],
        ['Express service', breakdown.expressFee ?? 0],
      ]
    : [['Delivery', parcel.deliveryFee]];
  // A minimum fee can lift the total above the sum of its parts.
  const listed = rows.reduce((sum, [, amount]) => sum + amount, 0);
  if (breakdown && breakdown.total > listed) {
    rows.push(['Minimum charge top-up', breakdown.total - listed]);
  }
  // A returned parcel handled no cash, so its cash-handling fee was given
  // back — see `returnEntries` in the ledger.
  const returned = parcel.status === ParcelStatus.RETURNED_TO_SENDER;
  const refundedCodFee = returned ? (breakdown?.codFee ?? 0) : 0;
  if (refundedCodFee) {
    rows.push(['Cash handling refunded (nothing collected)', -refundedCodFee]);
  }

  for (const [label, amount] of rows) {
    if (!amount) continue;
    pdf.text(left + 8, y, label, { size: 10 });
    pdf.text(right - 110, y, formatMoney(amount), { size: 10 });
    y += 20;
  }
  if (parcel.returnFee) {
    pdf.text(left + 8, y, 'Return to sender', { size: 10 });
    pdf.text(right - 110, y, formatMoney(parcel.returnFee), { size: 10 });
    y += 20;
  }

  const total = parcel.deliveryFee - refundedCodFee + (parcel.returnFee ?? 0);
  pdf.line(left, y, right, y);
  y += 10;
  pdf.text(left + 8, y, 'Total charges', { size: 11, bold: true });
  pdf.text(right - 110, y, formatMoney(total), { size: 11, bold: true });
  y += 40;

  pdf.text(left, y, 'SETTLEMENT', { size: 8, bold: true });
  y += 16;
  for (const line of settlementLines(parcel, total)) {
    pdf.text(left, y, line, { size: 10 });
    y += 16;
  }

  pdf.text(left, 800, `Track this parcel: ${trackingUrl}`, { size: 8 });

  return pdf.toBuffer();
}

function settlementLines(parcel: Parcel, total: number): string[] {
  if (parcel.status === ParcelStatus.RETURNED_TO_SENDER) {
    return [
      'Returned to you. No cash was collected from the receiver.',
      `Charges of ${formatMoney(total)} are deducted from your balance.`,
    ];
  }
  if (parcel.status === ParcelStatus.CANCELLED) {
    return ['Cancelled. Any fee charged for this parcel was credited back.'];
  }
  if (parcel.codAmount > 0) {
    const lines = [
      `Cash on delivery: ${formatMoney(parcel.codAmount)} to be collected from the receiver.`,
      'Charges are deducted from the cash collected; the rest is paid out to you.',
    ];
    if (parcel.isCodCollected) {
      lines.push(
        `Collected ${formatMoney(parcel.codAmount)} - charges ${formatMoney(total)} = ${formatMoney(parcel.codAmount - total)} payable to you.`,
      );
    }
    return lines;
  }

  return parcel.paymentStatus === PaymentStatus.PAID
    ? ['Prepaid. The delivery fee was paid online.']
    : [
        'Prepaid, not yet paid. Pay online from your dashboard, or the amount is',
        'deducted from your next payout.',
      ];
}
