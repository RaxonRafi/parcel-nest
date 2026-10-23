import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import { CreateParcelDto } from '../dto/create-parcel.dto';

/** Rows accepted in one upload — a day's orders for a busy shop. */
export const MAX_BULK_ROWS = 500;

/** Columns a booking file may carry: `CreateParcelDto`'s own field names. */
export const BULK_COLUMNS = [
  'receiverName',
  'receiverEmail',
  'receiverId',
  'receiverPhone',
  'pickupAddress',
  'deliveryAddress',
  'description',
  'weightKg',
  'codAmount',
  'pickupZone',
  'deliveryZone',
  'serviceTier',
  'pickupWindowStart',
  'pickupWindowEnd',
] as const;

type BulkColumn = (typeof BULK_COLUMNS)[number];

/** Values applied to every row whose own cell is empty. */
export type BulkDefaults = Partial<Record<BulkColumn, string>>;

export interface BulkRow {
  /** Line in the file, counting the header as 1. */
  line: number;
  dto: CreateParcelDto;
}

export interface BulkRowError {
  line: number;
  errors: string[];
}

export class CsvFormatError extends Error {}

/**
 * RFC 4180: comma-separated, fields optionally quoted, a quote inside a
 * quoted field doubled. Accepts CRLF or LF line endings and a UTF-8 byte
 * order mark (Excel writes one).
 */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;

  while (i < text.length) {
    const char = text[i];

    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 2;
        continue;
      }
      if (char === '"') {
        quoted = false;
        i++;
        continue;
      }
      field += char;
      i++;
      continue;
    }

    if (char === '"' && field === '') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      if (char === '\r' && text[i + 1] === '\n') i++;
    } else {
      field += char;
    }
    i++;
  }

  if (quoted) {
    throw new CsvFormatError('A quoted field is never closed');
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }

  // Blank lines — commonly a trailing one — carry nothing.
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ''));
}

/**
 * Turns a booking file into validated `CreateParcelDto`s, checking every row
 * before anything is booked so a bad file books nothing.
 */
export async function readBulkBookings(
  input: string,
  defaults: BulkDefaults = {},
): Promise<{ rows: BulkRow[]; errors: BulkRowError[] }> {
  const [header, ...body] = parseCsv(input);

  if (!header) {
    throw new CsvFormatError('The file is empty');
  }
  if (!body.length) {
    throw new CsvFormatError('The file has a header but no parcels');
  }
  if (body.length > MAX_BULK_ROWS) {
    throw new CsvFormatError(
      `At most ${MAX_BULK_ROWS} parcels per file — this one has ${body.length}`,
    );
  }

  const known = new Map(
    BULK_COLUMNS.map((column) => [column.toLowerCase(), column]),
  );
  const columns = header.map((name) => known.get(name.trim().toLowerCase()));
  const unknown = header.filter((_, index) => !columns[index]);
  if (unknown.length) {
    throw new CsvFormatError(
      `Unknown column${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}. Allowed: ${BULK_COLUMNS.join(', ')}`,
    );
  }

  const rows: BulkRow[] = [];
  const errors: BulkRowError[] = [];

  for (const [index, cells] of body.entries()) {
    const line = index + 2;
    const plain: Record<string, string> = {};

    for (const [key, value] of Object.entries(defaults)) {
      if (value?.trim()) plain[key] = value.trim();
    }
    columns.forEach((column, position) => {
      const value = cells[position]?.trim();
      // An empty cell means "not given", so a default or the DTO's own
      // default applies rather than an empty string failing validation.
      if (column && value) plain[column] = value;
    });

    const dto = plainToInstance(CreateParcelDto, plain);
    const failures = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    if (failures.length) {
      errors.push({ line, errors: flatten(failures) });
    } else {
      rows.push({ line, dto });
    }
  }

  return { rows, errors };
}

function flatten(failures: ValidationError[]): string[] {
  return failures.flatMap((failure) =>
    Object.values(failure.constraints ?? {}),
  );
}
