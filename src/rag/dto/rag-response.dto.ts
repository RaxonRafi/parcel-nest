import { ApiProperty } from '@nestjs/swagger';

export class RagSourceDto {
  @ApiProperty({ example: 'pdf' })
  type!: string;

  @ApiProperty({ example: 'delivery-policy.pdf' })
  source!: string;

  @ApiProperty({ nullable: true, example: 4 })
  page!: number | null;
}

export class RagAnswerDto {
  @ApiProperty({ example: 'Parcel TRK-12345 left the Dhaka sorting hub.' })
  answer!: string;

  @ApiProperty({ type: [RagSourceDto] })
  sources!: RagSourceDto[];
}

export class RagMessageResponseDto {
  @ApiProperty({ example: 'PDF ingested successfully' })
  message!: string;
}

export class PdfIngestResponseDto extends RagMessageResponseDto {
  @ApiProperty({ example: 'delivery-policy.pdf' })
  filename!: string;

  @ApiProperty({ example: 42 })
  chunksIndexed!: number;
}
