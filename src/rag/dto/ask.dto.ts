import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { RagFilter } from '../types/rag.types';

const RAG_FILTERS: RagFilter[] = ['pdf', 'parcel', 'all'];

export class AskDto {
  @ApiProperty({ example: 'Where is parcel TRK-12345 right now?' })
  @IsString()
  @IsNotEmpty({ message: 'Question is required' })
  @MaxLength(1000)
  question!: string;

  @ApiPropertyOptional({
    enum: RAG_FILTERS,
    default: 'all',
    description: 'Restricts retrieval to one slice of the vector index.',
  })
  @IsOptional()
  @IsIn(RAG_FILTERS)
  filter?: RagFilter;
}
