export type RagFilter = 'pdf' | 'parcel' | 'all';

/** Flattened parcel record as it is stored in the vector index. */
export interface ParcelDocument {
  id: string;
  trackingCode: string;
  status: string;
  origin: string;
  destination: string;
  recipientName: string;
  updatedAt: string;
  notes?: string;
}

export interface RagSource {
  type: string;
  source: string;
  page: number | null;
}

export interface RagAnswer {
  answer: string;
  sources: RagSource[];
}

export interface PdfIngestResult {
  chunksIndexed: number;
}

export interface PdfMetadata {
  source: string;
  category: string;
}
