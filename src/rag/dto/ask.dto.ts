import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RagFilter } from '../types/rag.types';

export class AskDto {
  @ApiProperty({ example: 'Where is parcel TRK-12345 right now?' })
  question!: string;

  @ApiPropertyOptional({
    enum: ['pdf', 'parcel', 'all'],
    default: 'all',
    description: 'Restricts retrieval to one slice of the vector index.',
  })
  filter?: RagFilter;
}
