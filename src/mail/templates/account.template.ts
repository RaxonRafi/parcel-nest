import { button, emailLayout, escapeHtml, paragraph } from './layout.template';

export function verifyEmailTemplate(
  name: string,
  url: string,
  expiryHours: number,
): { subject: string; html: string; text: string } {
  return {
    subject: 'Confirm your email address',
    html: emailLayout(
      'Confirm your email address',
      [
        paragraph(`Hi ${escapeHtml(name)},`),
        paragraph(
          `Confirm this address so we can send you parcel updates. The link expires in ${expiryHours} hours.`,
        ),
        button(url, 'Confirm email'),
        paragraph(
          `<span style="font-size:13px;color:#5a6070">If the button does not work, paste this into your browser:<br>${url}</span>`,
        ),
      ].join('\n'),
    ),
    text: [
      `Hi ${name},`,
      '',
      `Confirm your email address so we can send you parcel updates.`,
      `This link expires in ${expiryHours} hours:`,
      '',
      url,
    ].join('\n'),
  };
}

/** Tells a courier applicant what an admin decided. */
export function courierDecisionTemplate(
  name: string,
  approved: boolean,
  /** The dashboard, so an approved courier can go straight to work. */
  url: string,
): { subject: string; html: string; text: string } {
  const subject = approved
    ? 'Your courier application was approved'
    : 'An update on your courier application';
  const body = approved
    ? 'Your application to deliver with us has been approved. Parcels assigned to you will now appear in your dashboard.'
    : 'We were not able to approve your courier application this time. Your account stays open as a regular sender account, and you are welcome to apply again.';

  return {
    subject,
    html: emailLayout(
      subject,
      [
        paragraph(`Hi ${escapeHtml(name)},`),
        paragraph(body),
        approved ? button(url, 'Open your dashboard') : '',
      ].join('\n'),
    ),
    text: [`Hi ${name},`, '', body, ...(approved ? ['', url] : [])].join('\n'),
  };
}

/**
 * Sent to a receiver who had an account created for them by a sender. They
 * never chose a password, so the link is a password-reset grant — the same
 * mechanism, framed as claiming the account rather than recovering it.
 */
export function claimAccountTemplate(
  name: string,
  senderName: string,
  trackingId: string,
  url: string,
  /** Human-readable lifetime, e.g. "7 days". */
  expiresIn: string,
): { subject: string; html: string; text: string } {
  return {
    subject: `${senderName} sent you a parcel — set up your account`,
    html: emailLayout(
      'A parcel is on its way to you',
      [
        paragraph(`Hi ${escapeHtml(name)},`),
        paragraph(
          `${escapeHtml(senderName)} has sent you a parcel, tracking id <strong>${escapeHtml(trackingId)}</strong>. We created an account for you so you can follow it.`,
        ),
        paragraph(
          `Choose a password to finish setting it up — the link is valid for ${expiresIn}.`,
        ),
        button(url, 'Set up your account'),
      ].join('\n'),
    ),
    text: [
      `Hi ${name},`,
      '',
      `${senderName} has sent you a parcel (tracking id ${trackingId}).`,
      'We created an account so you can follow it. Choose a password here:',
      '',
      url,
      '',
      `The link is valid for ${expiresIn}.`,
    ].join('\n'),
  };
}
