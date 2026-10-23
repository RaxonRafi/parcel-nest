import * as QRCode from 'qrcode';

/**
 * A minimal PDF writer: text in the two built-in Helvetica faces, lines,
 * rectangles and QR codes drawn as filled squares.
 *
 * Hand-rolled rather than a library on purpose. The standard 14 fonts need
 * no embedding, so there are no font files to ship — which is what breaks
 * PDF libraries once the API is bundled for a serverless host. The cost is
 * that text is limited to Latin-1: anything else (Bangla script included)
 * prints as "?". Coordinates are in points from the top-left corner.
 */
export class PdfCanvas {
  private readonly ops: string[] = [];

  constructor(
    readonly width: number,
    readonly height: number,
  ) {}

  text(
    x: number,
    y: number,
    value: string,
    options: { size?: number; bold?: boolean } = {},
  ): this {
    const size = options.size ?? 10;
    const font = options.bold ? 'F2' : 'F1';
    // `y` is the top of the line; PDF places text by its baseline.
    const baseline = this.height - y - size * 0.8;
    this.ops.push(
      `BT /${font} ${size} Tf ${num(x)} ${num(baseline)} Td (${escapeText(value)}) Tj ET`,
    );
    return this;
  }

  /** Writes `value` wrapped to `maxWidth`; returns the y below the last line. */
  paragraph(
    x: number,
    y: number,
    value: string,
    maxWidth: number,
    options: { size?: number; bold?: boolean; maxLines?: number } = {},
  ): number {
    const size = options.size ?? 10;
    const lines = wrap(value, maxWidth, size).slice(0, options.maxLines);
    const leading = size * 1.25;

    lines.forEach((line, index) =>
      this.text(x, y + index * leading, line, options),
    );
    return y + lines.length * leading;
  }

  line(x1: number, y1: number, x2: number, y2: number, width = 0.75): this {
    this.ops.push(
      `${num(width)} w ${num(x1)} ${num(this.height - y1)} m ${num(x2)} ${num(this.height - y2)} l S`,
    );
    return this;
  }

  rect(
    x: number,
    y: number,
    w: number,
    h: number,
    options: { fill?: boolean; gray?: number } = {},
  ): this {
    const gray = options.gray ?? 0;
    const bottom = this.height - y - h;
    this.ops.push(
      options.fill
        ? `q ${num(gray)} g ${num(x)} ${num(bottom)} ${num(w)} ${num(h)} re f Q`
        : `0.75 w ${num(x)} ${num(bottom)} ${num(w)} ${num(h)} re S`,
    );
    return this;
  }

  /** White text on a filled block — the label's headline bars. */
  invertedText(
    x: number,
    y: number,
    value: string,
    options: { size?: number; bold?: boolean } = {},
  ): this {
    this.ops.push('q 1 g');
    this.text(x, y, value, options);
    this.ops.push('Q');
    return this;
  }

  /** A QR code `size` points square, with no quiet zone of its own. */
  qr(x: number, y: number, size: number, value: string): this {
    const { modules } = QRCode.create(value, { errorCorrectionLevel: 'M' });
    const cell = size / modules.size;
    const squares: string[] = [];

    for (let row = 0; row < modules.size; row++) {
      for (let col = 0; col < modules.size; col++) {
        if (modules.get(row, col)) {
          const left = x + col * cell;
          const bottom = this.height - (y + (row + 1) * cell);
          // A hair of overlap, so viewers draw no seams between modules.
          squares.push(
            `${num(left)} ${num(bottom)} ${num(cell + 0.05)} ${num(cell + 0.05)} re`,
          );
        }
      }
    }
    this.ops.push(`q 0 g ${squares.join(' ')} f Q`);
    return this;
  }

  toBuffer(): Buffer {
    const content = this.ops.join('\n');
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(this.width)} ${num(this.height)}] ` +
        '/Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>',
      `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    ];

    let body = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
    const offsets: number[] = [];
    objects.forEach((object, index) => {
      offsets.push(Buffer.byteLength(body, 'latin1'));
      body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });

    const xref = Buffer.byteLength(body, 'latin1');
    body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    body += offsets
      .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
      .join('');
    body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

    return Buffer.from(body, 'latin1');
  }
}

function num(value: number): string {
  return Number(value.toFixed(2)).toString();
}

/**
 * Escapes PDF string delimiters, and replaces what WinAnsi cannot encode:
 * typographic punctuation gets its plain equivalent, anything else a "?".
 */
export function escapeText(value: string): string {
  return value
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

/**
 * Greedy word wrap. Helvetica averages a little over half an em per
 * character, which is close enough to keep addresses inside their box.
 */
export function wrap(value: string, maxWidth: number, size: number): string[] {
  const perLine = Math.max(8, Math.floor(maxWidth / (size * 0.52)));
  const lines: string[] = [];
  let current = '';

  for (const word of value.replace(/\s+/g, ' ').trim().split(' ')) {
    if (!word) continue;
    const candidate = current ? `${current} ${word}` : word;

    if (candidate.length <= perLine) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    // A single word longer than the line is broken where it must be.
    let rest = word;
    while (rest.length > perLine) {
      lines.push(rest.slice(0, perLine));
      rest = rest.slice(perLine);
    }
    current = rest;
  }
  if (current) lines.push(current);

  return lines;
}

export function formatMoney(amount: number): string {
  return `BDT ${amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
