import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UploadPdfDto {
  @ApiPropertyOptional({ default: 'general', example: 'policy' })
  category?: string;
}

/**
 * Documentation-only shape for the `multipart/form-data` body. The file itself
 * is pulled off the request by `FileInterceptor`, so it never reaches
 * `UploadPdfDto` — but Swagger UI needs it declared to render a file picker.
 */
export class UploadPdfFormDto extends UploadPdfDto {
  @ApiProperty({
    type: 'string',
    format: 'binary',
    description: 'PDF file, 10 MB maximum.',
  })
  file!: unknown;
}
