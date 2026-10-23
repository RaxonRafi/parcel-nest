import { emailLayout, escapeHtml, paragraph } from './layout.template';

const HEADLINES: Record<string, string> = {
  PENDING: 'Your parcel has been booked',
  PICKED_UP: 'Your parcel has been picked up',
  IN_TRANSIT: 'Your parcel is on its way',
  OUT_FOR_DELIVERY: 'Your parcel is out for delivery',
  FAILED_ATTEMPT: 'We could not deliver your parcel',
  RETURNING: 'Your parcel is being returned to its sender',
  DELIVERED: 'Your parcel has been delivered',
  CANCELLED: 'Your parcel was cancelled',
  RETURNED_TO_SENDER: 'Your parcel was returned to its sender',
};

/**
 * The code a receiver gives the courier at the door. Sent each time the
 * parcel goes out, so an old email's code is never the one that works.
 */
export function deliveryCodeEmail(params: {
  recipientName: string;
  trackingId: string;
  code: string;
  codAmount: number;
  trackingUrl: string;
}): { subject: string; html: string; text: string } {
  const subject = `Your delivery code: ${params.code} — ${params.trackingId}`;
  const cash =
    params.codAmount > 0
      ? `Please have ${params.codAmount} BDT ready in cash.`
      : 'Nothing is due on delivery.';

  const text = [
    `Hi ${params.recipientName},`,
    '',
    `Your parcel ${params.trackingId} is out for delivery today.`,
    `Give the courier this code once you have the parcel in hand: ${params.code}`,
    cash,
    'Never share the code before you receive the parcel.',
    '',
    `Track it here: ${params.trackingUrl}`,
  ].join('\n');

  const html = emailLayout(
    'Your parcel is out for delivery',
    [
      paragraph(`Hi ${escapeHtml(params.recipientName)},`),
      paragraph(
        `Parcel <strong>${escapeHtml(params.trackingId)}</strong> is on its way to you today. Give the courier this code once the parcel is in your hands:`,
      ),
      `<p style="font-size:32px;font-weight:bold;letter-spacing:8px;margin:16px 0">${escapeHtml(params.code)}</p>`,
      paragraph(escapeHtml(cash)),
      paragraph('Never share the code before you receive the parcel.'),
      paragraph(
        `<a href="${params.trackingUrl}" style="color:#3b3f94">Track your parcel</a>`,
      ),
    ].join('\n'),
  );

  return { subject, html, text };
}

export function parcelStatusEmail(params: {
  recipientName: string;
  trackingId: string;
  status: string;
  note?: string | null;
  courierName?: string | null;
  trackingUrl: string;
}): { subject: string; html: string; text: string } {
  const headline = HEADLINES[params.status] ?? 'Parcel update';
  const subject = `${headline} — ${params.trackingId}`;

  const lines = [
    `Hi ${params.recipientName},`,
    '',
    `${headline}.`,
    `Tracking id: ${params.trackingId}`,
    params.courierName ? `Courier: ${params.courierName}` : '',
    params.note ? `Note: ${params.note}` : '',
    '',
    `Track it here: ${params.trackingUrl}`,
  ].filter(Boolean);

  const html = emailLayout(
    headline,
    [
      paragraph(`Hi ${escapeHtml(params.recipientName)},`),
      paragraph(
        `Tracking id <strong>${escapeHtml(params.trackingId)}</strong>` +
          (params.courierName
            ? ` — currently with ${escapeHtml(params.courierName)}.`
            : '.'),
      ),
      params.note ? paragraph(escapeHtml(params.note)) : '',
      paragraph(
        `<a href="${params.trackingUrl}" style="color:#3b3f94">Track your parcel</a>`,
      ),
    ].join('\n'),
  );

  return { subject, html, text: lines.join('\n') };
}
