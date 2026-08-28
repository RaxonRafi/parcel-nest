/** Plain HTML with inline styles — mail clients strip stylesheets. */
export function passwordResetEmail(
  name: string,
  resetUrl: string,
  expiryMinutes: number,
): { html: string; text: string } {
  const text = [
    `Hi ${name},`,
    '',
    'You asked to reset your Parcel Delivery password.',
    `Open this link within ${expiryMinutes} minutes to choose a new one:`,
    '',
    resetUrl,
    '',
    "If you didn't ask for this, you can ignore this email — your password stays as it is.",
  ].join('\n');

  const html = `
<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#16181f">
  <h1 style="font-size:20px;margin:0 0 16px">Reset your password</h1>
  <p style="font-size:15px;line-height:1.6;margin:0 0 16px">Hi ${escapeHtml(name)},</p>
  <p style="font-size:15px;line-height:1.6;margin:0 0 24px">
    You asked to reset your Parcel Delivery password. This link works once and
    expires in ${expiryMinutes} minutes.
  </p>
  <p style="margin:0 0 28px">
    <a href="${resetUrl}" style="display:inline-block;background:#3b3f94;color:#fff;text-decoration:none;padding:12px 22px;border-radius:4px;font-size:15px">Choose a new password</a>
  </p>
  <p style="font-size:13px;line-height:1.6;color:#5a6070;margin:0 0 8px">
    If the button does not work, paste this into your browser:
  </p>
  <p style="font-size:12px;word-break:break-all;color:#5a6070;margin:0 0 24px">${resetUrl}</p>
  <p style="font-size:13px;line-height:1.6;color:#5a6070;margin:0">
    If you didn't ask for this, ignore this email — your password stays as it is.
  </p>
</div>`.trim();

  return { html, text };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
