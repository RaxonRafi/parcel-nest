/** Shared shell so every message looks like it came from the same product. */
export function emailLayout(heading: string, bodyHtml: string): string {
  return `
<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#16181f">
  <h1 style="font-size:20px;margin:0 0 20px;letter-spacing:-.01em">${heading}</h1>
  ${bodyHtml}
  <hr style="border:none;border-top:1px solid #e6e8ed;margin:28px 0 16px">
  <p style="font-size:12px;color:#5a6070;margin:0">Parcel Delivery</p>
</div>`.trim();
}

export function button(href: string, label: string): string {
  return `<p style="margin:0 0 28px"><a href="${href}" style="display:inline-block;background:#3b3f94;color:#fff;text-decoration:none;padding:12px 22px;border-radius:4px;font-size:15px">${label}</a></p>`;
}

export function paragraph(text: string): string {
  return `<p style="font-size:15px;line-height:1.6;margin:0 0 16px">${text}</p>`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
