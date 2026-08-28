import { emailLayout, escapeHtml, paragraph } from './layout.template';

const HEADLINES: Record<string, string> = {
  PENDING: 'Your parcel has been booked',
  PICKED_UP: 'Your parcel has been picked up',
  IN_TRANSIT: 'Your parcel is on its way',
  OUT_FOR_DELIVERY: 'Your parcel is out for delivery',
  DELIVERED: 'Your parcel has been delivered',
  CANCELLED: 'Your parcel was cancelled',
};

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
