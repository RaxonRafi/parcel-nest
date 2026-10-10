import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { RagFilter, RagTurn } from '../types/rag.types';

const RAG_FILTERS: RagFilter[] = ['pdf', 'parcel', 'all'];

/** Enough to resolve "and where is it now?"; more only costs tokens. */
export const MAX_HISTORY_TURNS = 10;

export class AskTurnDto implements RagTurn {
  @ApiProperty({ enum: ['user', 'assistant'] })
  @IsIn(['user', 'assistant'])
  role!: 'user' | 'assistant';

  @ApiProperty({ example: 'Where is parcel TRK-12345 right now?' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  content!: string;
}

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

  @ApiPropertyOptional({
    type: [AskTurnDto],
    description: `The conversation so far, oldest first, without the new question — at most ${MAX_HISTORY_TURNS} turns. The server keeps no chat state, so a follow-up only makes sense if the client sends this.`,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_HISTORY_TURNS)
  @ValidateNested({ each: true })
  @Type(() => AskTurnDto)
  history?: AskTurnDto[];
}
