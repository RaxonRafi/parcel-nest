import { RagFilter } from '../types/rag.types';

export class AskDto {
  question!: string;
  filter?: RagFilter;
}
