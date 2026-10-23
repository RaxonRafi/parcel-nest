import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentProvider, PaymentState } from '../types/payment.types';

export class CheckoutResponseDto {
  @ApiProperty({ format: 'uuid' })
  paymentId!: string;

  @ApiProperty({ example: 'TRK-7K2M9QX4T1VB-1A2B3C4D' })
  tranId!: string;

  @ApiProperty({ example: 85 })
  amount!: number;

  @ApiProperty({ example: 'BDT' })
  currency!: string;

  @ApiProperty({
    example: 'https://sandbox.sslcommerz.com/EasyCheckOut/testcde…',
    description: "Send the payer's browser here.",
  })
  gatewayUrl!: string;
}

export class PaymentResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: PaymentProvider })
  provider!: PaymentProvider;

  @ApiProperty({ example: 'TRK-7K2M9QX4T1VB-1A2B3C4D' })
  tranId!: string;

  @ApiProperty({ example: 85 })
  amount!: number;

  @ApiProperty({ example: 'BDT' })
  currency!: string;

  @ApiProperty({ enum: PaymentState })
  status!: PaymentState;

  @ApiPropertyOptional({ nullable: true, example: 'BKASH-BKash' })
  cardType!: string | null;

  @ApiPropertyOptional({ nullable: true })
  bankTranId!: string | null;

  @ApiPropertyOptional({ nullable: true })
  failureReason!: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  paidAt!: Date | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;
}
