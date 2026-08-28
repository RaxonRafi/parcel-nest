import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PineconeStore } from '@langchain/pinecone';
import { Pinecone } from '@pinecone-database/pinecone';
import { Document } from '@langchain/core/documents';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import {
  RunnableSequence,
  RunnablePassthrough,
} from '@langchain/core/runnables';
import { ChatGroq } from '@langchain/groq';
import { HuggingFaceInferenceEmbeddings } from '@langchain/community/embeddings/hf';
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import * as fs from 'fs';
import {
  ParcelDocument,
  PdfIngestResult,
  PdfMetadata,
  RagAnswer,
  RagFilter,
  RagSource,
  RagStreamChunk,
} from '../types/rag.types';

/** Overridable with the GROQ_MODEL env var. */
const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-20b';

@Injectable()
export class RagService implements OnModuleInit {
  private readonly logger = new Logger(RagService.name);
  private vectorStore!: PineconeStore;
  private embeddings!: HuggingFaceInferenceEmbeddings;
  private llm!: ChatGroq;

  constructor(private config: ConfigService) {}

  async onModuleInit() {
    const pinecone = new Pinecone({
      apiKey: this.config.getOrThrow<string>('PINECONE_API_KEY'),
    });

    const pineconeIndex = pinecone.Index(
      this.config.getOrThrow<string>('PINECONE_INDEX'),
    );

    // Free embeddings — 384 dimensions
    this.embeddings = new HuggingFaceInferenceEmbeddings({
      apiKey: this.config.getOrThrow<string>('HUGGINGFACE_API_KEY'),
      model: 'sentence-transformers/all-MiniLM-L6-v2',
    });

    // Free LLM via Groq. Groq retires models with little notice (it dropped
    // `llama-3.1-8b-instant` out from under us), so the id is overridable with
    // GROQ_MODEL — check https://console.groq.com/docs/models when answers
    // start failing with `model_not_found`.
    this.llm = new ChatGroq({
      apiKey: this.config.getOrThrow<string>('GROQ_API_KEY'),
      model: this.config.get<string>('GROQ_MODEL') ?? DEFAULT_GROQ_MODEL,
      temperature: 0,
    });

    this.vectorStore = await PineconeStore.fromExistingIndex(this.embeddings, {
      pineconeIndex,
      textKey: 'text',
    });

    this.logger.log('✅ RAG initialized (Groq + HuggingFace + Pinecone)');
  }

  // ─── PDF Ingestion ────────────────────────────────────────────────────────

  async ingestPDF(
    filePath: string,
    metadata: PdfMetadata,
  ): Promise<PdfIngestResult> {
    const loader = new PDFLoader(filePath);
    const rawDocs = await loader.load();

    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
    });
    const chunks = await splitter.splitDocuments(rawDocs);

    const taggedChunks = chunks.map((chunk, i) => ({
      ...chunk,
      metadata: {
        ...chunk.metadata,
        source: metadata.source,
        category: metadata.category,
        type: 'pdf',
        chunk_index: i,
      },
    }));

    const ids = chunks.map((_, i) => `pdf-${metadata.source}-chunk-${i}`);
    await this.vectorStore.addDocuments(taggedChunks, { ids });

    fs.unlinkSync(filePath);

    this.logger.log(
      `📄 Ingested "${metadata.source}" → ${chunks.length} chunks`,
    );
    return { chunksIndexed: chunks.length };
  }

  // ─── Delete PDF ───────────────────────────────────────────────────────────

  async deletePDF(source: string): Promise<void> {
    await this.vectorStore.delete({
      filter: { source: { $eq: source }, type: { $eq: 'pdf' } },
    });
    this.logger.log(`🗑️ Deleted PDF "${source}" from Pinecone`);
  }

  // ─── Parcel Indexing ──────────────────────────────────────────────────────

  async indexParcel(parcel: ParcelDocument): Promise<void> {
    const doc = new Document({
      pageContent: `
        Tracking Code: ${parcel.trackingCode}
        Recipient: ${parcel.recipientName}
        Status: ${parcel.status}
        Route: ${parcel.origin} to ${parcel.destination}
        Last Updated: ${parcel.updatedAt}
        Notes: ${parcel.notes ?? 'None'}
      `.trim(),
      metadata: {
        parcel_id: parcel.id,
        tracking_code: parcel.trackingCode,
        status: parcel.status,
        type: 'parcel',
      },
    });

    await this.vectorStore.addDocuments([doc], {
      ids: [`parcel-${parcel.id}`],
    });

    this.logger.log(`📦 Indexed parcel ${parcel.trackingCode}`);
  }

  async reindexParcel(parcel: ParcelDocument): Promise<void> {
    await this.indexParcel(parcel);
  }

  async deleteParcel(parcelId: string): Promise<void> {
    await this.vectorStore.delete({ ids: [`parcel-${parcelId}`] });
  }

  // ─── Ask ──────────────────────────────────────────────────────────────────

  /**
   * Streams the answer token by token.
   *
   * Sources resolve first and are yielded as a single leading chunk, so a
   * client can render attribution before the prose finishes. Retrieval runs
   * once and is shared with the chain rather than being issued twice.
   */
  async *askStream(
    question: string,
    filter?: RagFilter,
  ): AsyncGenerator<RagStreamChunk> {
    const retriever = this.buildRetriever(filter);
    const sourceDocs = await retriever.invoke(question);

    yield {
      type: 'sources',
      sources: sourceDocs.map((d) => this.toSource(d)),
    };

    const chain = RunnableSequence.from([
      {
        context: () => sourceDocs.map((d) => d.pageContent).join('\n\n'),
        question: new RunnablePassthrough(),
      },
      this.answerPrompt(),
      this.llm,
      new StringOutputParser(),
    ]);

    try {
      for await (const token of await chain.stream(question)) {
        if (token) {
          yield { type: 'token', token };
        }
      }
      yield { type: 'done' };
    } catch (error) {
      // Surfaced as a stream event rather than thrown: the response headers
      // and some body have already gone out, so an exception filter cannot
      // turn this into a clean HTTP error any more.
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`RAG stream failed: ${message}`);
      yield { type: 'error', message: 'The answer could not be completed' };
    }
  }

  async ask(question: string, filter?: RagFilter): Promise<RagAnswer> {
    const retriever = this.buildRetriever(filter);

    const formatDocs = (docs: Document[]) =>
      docs.map((d) => d.pageContent).join('\n\n');

    const chain = RunnableSequence.from([
      {
        context: retriever.pipe(formatDocs),
        question: new RunnablePassthrough(),
      },
      this.answerPrompt(),
      this.llm,
      new StringOutputParser(),
    ]);

    const [answer, sourceDocs] = await Promise.all([
      chain.invoke(question),
      retriever.invoke(question),
    ]);

    return { answer, sources: sourceDocs.map((d) => this.toSource(d)) };
  }

  /** Shared by `ask` and `askStream` so the two cannot retrieve differently. */
  private buildRetriever(filter?: RagFilter) {
    return filter && filter !== 'all'
      ? this.vectorStore.asRetriever({
          k: 5,
          filter: { type: { $eq: filter } },
        })
      : this.vectorStore.asRetriever({ k: 5 });
  }

  private answerPrompt(): ChatPromptTemplate {
    return ChatPromptTemplate.fromTemplate(`
      You are a helpful parcel delivery assistant.
      Answer the question based only on the context below.
      If you don't know, say "I don't have that information."

      Context: {context}

      Question: {question}
    `);
  }

  private toSource(doc: Document): RagSource {
    return {
      type: doc.metadata.type,
      source: doc.metadata.source ?? doc.metadata.tracking_code,
      page: doc.metadata.loc?.pageNumber ?? null,
    };
  }
}
