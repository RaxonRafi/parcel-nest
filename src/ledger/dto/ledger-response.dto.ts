import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PageMetaDto } from '../../common/dto/paginated-response.dto';
import { LedgerAccountType, LedgerEntryType } from '../types/ledger.types';

export class LedgerEntryResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: LedgerEntryType })
  type!: LedgerEntryType;

  @ApiProperty({
    example: -105,
    description:
      'Signed BDT. Positive adds to the balance, negative takes from it.',
  })
  amount!: number;

  @ApiPropertyOptional({ nullable: true, example: 'TRK-7K2M9QX4T1VB' })
  trackingId!: string | null;

  @ApiPropertyOptional({ nullable: true })
  note!: string | null;

  @ApiPropertyOptional({ nullable: true })
  reference!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;
}

class PaginatedLedgerEntriesDto {
  @ApiProperty({ type: [LedgerEntryResponseDto] })
  data!: LedgerEntryResponseDto[];

  @ApiProperty({ type: PageMetaDto })
  meta!: PageMetaDto;
}

export class LedgerStatementDto {
  @ApiProperty({ enum: LedgerAccountType })
  accountType!: LedgerAccountType;

  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({
    example: 1895,
    description:
      'Merchant: positive is owed to them, negative is owed by them. Courier: cash they hold.',
  })
  balance!: number;

  @ApiProperty({ type: PaginatedLedgerEntriesDto })
  entries!: PaginatedLedgerEntriesDto;
}

export class LedgerBalanceDto {
  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty({ example: 1895 })
  balance!: number;

  @ApiProperty({ example: 4, description: 'How many entries make it up.' })
  entries!: number;
}

export class PaginatedLedgerBalancesDto {
  @ApiProperty({ type: [LedgerBalanceDto] })
  data!: LedgerBalanceDto[];

  @ApiProperty({ type: PageMetaDto })
  meta!: PageMetaDto;
}
