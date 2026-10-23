import {
  CsvFormatError,
  MAX_BULK_ROWS,
  parseCsv,
  readBulkBookings,
} from './parcel-csv.util';

describe('parseCsv', () => {
  it('reads quoted fields, doubled quotes and embedded commas and newlines', () => {
    expect(parseCsv('a,"b, c","say ""hi""","two\nlines"\n')).toEqual([
      ['a', 'b, c', 'say "hi"', 'two\nlines'],
    ]);
  });

  it('accepts CRLF, a byte order mark and a missing final newline', () => {
    expect(parseCsv('﻿x,y\r\n1,2')).toEqual([
      ['x', 'y'],
      ['1', '2'],
    ]);
  });

  it('drops blank lines and keeps empty cells', () => {
    expect(parseCsv('a,,c\n\n,,\n')).toEqual([['a', '', 'c']]);
  });

  it('refuses a quote that is never closed', () => {
    expect(() => parseCsv('a,"open\n')).toThrow(CsvFormatError);
  });
});

describe('readBulkBookings', () => {
  const header =
    'receiverName,receiverEmail,pickupAddress,deliveryAddress,weightKg,codAmount';

  it('turns rows into booking DTOs, numbers included', async () => {
    const { rows, errors } = await readBulkBookings(
      `${header}\nKarim,karim@test.com,Tejgaon,Mirpur,2.5,1500\n`,
    );
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({
      line: 2,
      dto: { receiverName: 'Karim', weightKg: 2.5, codAmount: 1500 },
    });
  });

  it('matches column names regardless of case', async () => {
    const { rows } = await readBulkBookings(
      'RECEIVERNAME,receiveremail,PickupAddress,deliveryaddress\nA,a@test.com,X,Y',
    );
    expect(rows).toHaveLength(1);
  });

  it('fills empty cells from the defaults', async () => {
    const { rows, errors } = await readBulkBookings(
      'receiverName,receiverEmail,deliveryAddress\nA,a@test.com,Mirpur',
      { pickupAddress: 'Warehouse 3, Tejgaon' },
    );
    expect(errors).toEqual([]);
    expect(rows[0].dto.pickupAddress).toBe('Warehouse 3, Tejgaon');
  });

  it('reports every bad row by its line in the file', async () => {
    const { rows, errors } = await readBulkBookings(
      `${header}\nOk,ok@test.com,X,Y,1,0\nBad,nope,X,Y,-1,0\n,also@test.com,X,Y,1,0`,
    );
    expect(rows).toHaveLength(1);
    expect(errors.map((error) => error.line)).toEqual([3, 4]);
    expect(errors[0].errors.join(' ')).toMatch(/receiverEmail/);
  });

  it('refuses unknown columns, an empty file and too many rows', async () => {
    await expect(readBulkBookings('receiverName,colour\nA,red')).rejects.toThrow(
      /Unknown column: colour/,
    );
    await expect(readBulkBookings('')).rejects.toThrow(CsvFormatError);
    await expect(readBulkBookings(header)).rejects.toThrow(/no parcels/);

    const many = Array.from(
      { length: MAX_BULK_ROWS + 1 },
      (_, i) => `R${i},r${i}@test.com,X,Y,1,0`,
    );
    await expect(
      readBulkBookings([header, ...many].join('\n')),
    ).rejects.toThrow(/At most/);
  });
});
