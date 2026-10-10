import { open, readFile } from 'fs/promises';
import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PineconeStore } from '@langchain/pinecone';
import { Index, Pinecone } from '@pinecone-database/pinecone';
import { Document } from '@langchain/core/documents';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import {
  RunnableSequence,
  RunnablePassthrough,
} from '@langchain/core/runnables';
import { ChatGroq } from '@langchain/groq';
import { HuggingFaceInferenceEmbeddings } from '@langchain/community/embeddings/hf';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { extractText } from 'unpdf';
import { Role } from '../../user/types/user.types';
import {
  ParcelDocument,
  PdfIngestResult,
  PdfMetadata,
  RagAnswer,
  RagFilter,
  RagSource,
  RagStreamChunk,
  RagTurn,
  RagViewer,
} from '../types/rag.types';

/**
 * Greetings, thanks and the like. Retrieval is similarity search, so even
 * "hi" comes back with five unrelated parcels — skip it and let the model
 * answer conversationally instead.
 */
const SMALL_TALK =
  /^(hi+|hey+|hello+|yo|hola|salam|assalamu? ?alaikum|good (morning|afternoon|evening|night)|thanks?( you)?( so much| a lot)?|thank u|ty|ok(ay)?|cool|great|nice|bye|goodbye|see you|how are you|who are you|what can you do|help)( there| again)?[\s!.?,]*$/i;

export function isSmallTalk(message: string): boolean {
  return SMALL_TALK.test(message.trim());
}

/** Overridable with the GROQ_MODEL env var. */
const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-20b';

const REQUIRED_KEYS = [
  'PINECONE_API_KEY',
  'PINECONE_INDEX',
  'HUGGINGFACE_API_KEY',
  'GROQ_API_KEY',
] as const;

/** Every chunk of one PDF shares this id prefix. */
const pdfChunkPrefix = (source: string): string => `pdf-${source}-chunk-`;

/** Every parcel vector's id is this plus the parcel's uuid. */
const PARCEL_PREFIX = 'parcel-';

/**
 * What the assistant says when retrieval finds nothing. The same sentence the
 * prompt tells the model to use, so the client sees one wording either way.
 */
export const NO_INFORMATION = "I don't have that information.";

/** Every PDF starts with these bytes, whatever the upload claimed to be. */
const PDF_MAGIC = '%PDF-';

/**
 * A follow-up like "and when will it arrive?" names nothing to search for.
 * Retrieval is given the previous question as well, so the vector query still
 * points at the parcel or policy the conversation is about.
 */
export function retrievalQuery(question: string, history: RagTurn[]): string {
  const previous = [...history].reverse().find((turn) => turn.role === 'user');
  return previous ? `${previous.content}\n${question}` : question;
}

function formatHistory(history: RagTurn[]): string {
  if (history.length === 0) return '(none)';

  return history
    .map((turn) => `${turn.role === 'user' ? 'User' : 'Assistant'}: ${turn.content}`)
    .join('\n');
}

type MetadataFilter = Record<string, unknown>;

/**
 * What a question may be answered from.
 *
 * Policy PDFs are for everyone. Parcels are not: an admin sees all of them,
 * anyone else only the ones they sent, are receiving, or are carrying. The
 * restriction is applied in the vector query itself, so a parcel the viewer
 * has no part in is never retrieved and cannot leak into an answer.
 */
export function buildRetrievalFilter(
  filter: RagFilter,
  viewer: RagViewer,
): MetadataFilter | undefined {
  const pdfs: MetadataFilter = { type: { $eq: 'pdf' } };
  const parcels: MetadataFilter = { type: { $eq: 'parcel' } };

  if (viewer.role === Role.ADMIN) {
    if (filter === 'pdf') return pdfs;
    if (filter === 'parcel') return parcels;
    return undefined;
  }

  const ownParcels: MetadataFilter = {
    $and: [
      parcels,
      {
        $or: [
          { sender_id: { $eq: viewer.id } },
          { receiver_id: { $eq: viewer.id } },
          { courier_id: { $eq: viewer.id } },
        ],
      },
    ],
  };

  if (filter === 'pdf') return pdfs;
  if (filter === 'parcel') return ownParcels;
  return { $or: [pdfs, ownParcels] };
}

@Injectable()
export class RagService implements OnModuleInit {
  private readonly logger = new Logger(RagService.name);
  private pineconeIndex: Index | null = null;
  private vectorStore: PineconeStore | null = null;
  private embeddings!: HuggingFaceInferenceEmbeddings;
  private llm!: ChatGroq;

  constructor(private config: ConfigService) {}

  /**
   * Optional on purpose, like mail: without provider keys the assistant is
   * switched off and the rest of the API still boots. Parcel indexing becomes
   * a no-op and the ask routes answer 503.
   */
  async onModuleInit() {
    const missing = REQUIRED_KEYS.filter((key) => !this.config.get(key));

    if (missing.length) {
      this.logger.warn(
        `RAG is disabled — missing ${missing.join(', ')}. The assistant routes will answer 503.`,
      );
      return;
    }

    const pinecone = new Pinecone({
      apiKey: this.config.getOrThrow<string>('PINECONE_API_KEY'),
    });

    this.pineconeIndex = pinecone.Index(
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
      pineconeIndex: this.pineconeIndex,
      textKey: 'text',
    });

    this.logger.log('✅ RAG initialized (Groq + HuggingFace + Pinecone)');
  }

  get isEnabled(): boolean {
    return this.vectorStore !== null;
  }

  /** Call before a response starts streaming, while a 503 can still be sent. */
  assertAvailable(): void {
    this.store();
  }

  private store(): PineconeStore {
    if (!this.vectorStore) {
      throw new ServiceUnavailableException(
        'The assistant is not configured on this server',
      );
    }
    return this.vectorStore;
  }

  // ─── PDF Ingestion ────────────────────────────────────────────────────────

  /** The caller owns the temp file and removes it; this only reads it. */
  async ingestPDF(
    filePath: string,
    metadata: PdfMetadata,
  ): Promise<PdfIngestResult> {
    const store = this.store();
    await this.assertIsPdf(filePath);
    const rawDocs = await this.loadPdfPages(filePath);

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

    // Chunk ids are positional, so a shorter re-upload would overwrite the
    // first N and leave the old tail answering questions. Clear it first.
    await this.deletePDF(metadata.source);

    const ids = chunks.map((_, i) => `${pdfChunkPrefix(metadata.source)}${i}`);
    await store.addDocuments(taggedChunks, { ids });

    this.logger.log(
      `📄 Ingested "${metadata.source}" → ${chunks.length} chunks`,
    );
    return { chunksIndexed: chunks.length };
  }

  /**
   * The upload filter only sees the MIME type the client claimed, which is
   * whatever the client chose to send. The first bytes of the file are not.
   */
  private async assertIsPdf(filePath: string): Promise<void> {
    const handle = await open(filePath, 'r');

    try {
      const { buffer, bytesRead } = await handle.read(
        Buffer.alloc(PDF_MAGIC.length),
        0,
        PDF_MAGIC.length,
        0,
      );

      if (buffer.toString('latin1', 0, bytesRead) !== PDF_MAGIC) {
        throw new BadRequestException('That file is not a PDF');
      }
    } finally {
      await handle.close();
    }
  }

  /**
   * One document per page that has text.
   *
   * `unpdf` rather than LangChain's `PDFLoader`: that one goes through
   * pdf-parse, whose PDF.js build needs the native `@napi-rs/canvas` module at
   * import time. Vercel's bundle does not carry it, so every upload there
   * failed with "Failed to load pdf-parse".
   */
  private async loadPdfPages(filePath: string): Promise<Document[]> {
    const { text } = await extractText(
      new Uint8Array(await readFile(filePath)),
      { mergePages: false },
    );

    return text
      .map(
        (pageContent, i) =>
          new Document({
            pageContent,
            metadata: { loc: { pageNumber: i + 1 } },
          }),
      )
      .filter((doc) => doc.pageContent.trim().length > 0);
  }

  // ─── Delete PDF ───────────────────────────────────────────────────────────

  /**
   * Removes every chunk of one PDF.
   *
   * Serverless Pinecone indexes cannot delete by metadata filter but can list
   * ids by prefix; pod-based indexes are the other way round. Try the prefix
   * listing first and fall back to the filter.
   */
  async deletePDF(source: string): Promise<void> {
    const store = this.store();
    const index = this.pineconeIndex;

    try {
      if (!index) throw new Error('no index handle');

      let removed = 0;
      let paginationToken: string | undefined;
      do {
        const page = await index.listPaginated({
          prefix: pdfChunkPrefix(source),
          paginationToken,
        });
        const ids = (page.vectors ?? [])
          .map((vector) => vector.id)
          .filter((id): id is string => !!id);

        if (ids.length) {
          await index.deleteMany(ids);
          removed += ids.length;
        }
        paginationToken = page.pagination?.next;
      } while (paginationToken);

      this.logger.log(`🗑️ Deleted ${removed} chunks of "${source}"`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.debug(
        `Prefix delete unavailable (${message}) — deleting "${source}" by filter`,
      );
      await store.delete({
        filter: { source: { $eq: source }, type: { $eq: 'pdf' } },
      });
      this.logger.log(`🗑️ Deleted PDF "${source}" from Pinecone`);
    }
  }

  // ─── Parcel Indexing ──────────────────────────────────────────────────────

  async indexParcel(parcel: ParcelDocument): Promise<void> {
    await this.indexParcels([parcel]);
  }

  /**
   * Embeds and upserts a batch in one round trip each. Ids are derived from
   * the parcel, so indexing the same one again replaces its vector.
   */
  async indexParcels(parcels: ParcelDocument[]): Promise<void> {
    // Parcel writes call this on every change; with the assistant switched
    // off there is simply nothing to keep in sync.
    if (!this.vectorStore || !parcels.length) return;

    await this.vectorStore.addDocuments(
      parcels.map((parcel) => this.toParcelVector(parcel)),
      { ids: parcels.map((parcel) => `${PARCEL_PREFIX}${parcel.id}`) },
    );

    this.logger.log(
      parcels.length === 1
        ? `📦 Indexed parcel ${parcels[0].trackingCode}`
        : `📦 Indexed ${parcels.length} parcels`,
    );
  }

  private toParcelVector(parcel: ParcelDocument): Document {
    return new Document({
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
        // Who may be shown this parcel — see `buildRetrievalFilter`. Pinecone
        // rejects null metadata values, so an absent party is left out.
        ...(parcel.senderId ? { sender_id: parcel.senderId } : {}),
        ...(parcel.receiverId ? { receiver_id: parcel.receiverId } : {}),
        ...(parcel.courierId ? { courier_id: parcel.courierId } : {}),
      },
    });
  }

  async reindexParcel(parcel: ParcelDocument): Promise<void> {
    await this.indexParcel(parcel);
  }

  async deleteParcel(parcelId: string): Promise<void> {
    await this.store().delete({ ids: [`${PARCEL_PREFIX}${parcelId}`] });
  }

  /**
   * Drops every parcel vector whose parcel is not in `keep` — what a full
   * rebuild uses to clear out parcels that no longer exist. Returns how many
   * were removed.
   *
   * Listing ids by prefix is a serverless-index feature. On a pod-based index
   * it is unavailable, and there the stale vectors are left in place rather
   * than failing a rebuild that has otherwise succeeded.
   */
  async pruneParcelsExcept(keep: ReadonlySet<string>): Promise<number> {
    const index = this.pineconeIndex;
    if (!index) return 0;

    try {
      let removed = 0;
      let paginationToken: string | undefined;

      do {
        const page = await index.listPaginated({
          prefix: PARCEL_PREFIX,
          paginationToken,
        });
        const stale = (page.vectors ?? [])
          .map((vector) => vector.id)
          .filter(
            (id): id is string =>
              !!id && !keep.has(id.slice(PARCEL_PREFIX.length)),
          );

        if (stale.length) {
          await index.deleteMany(stale);
          removed += stale.length;
        }
        paginationToken = page.pagination?.next;
      } while (paginationToken);

      return removed;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Could not prune stale parcel vectors: ${message}`);
      return 0;
    }
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
    viewer: RagViewer,
    filter: RagFilter = 'all',
    history: RagTurn[] = [],
  ): AsyncGenerator<RagStreamChunk> {
    const sourceDocs = await this.retrieve(question, viewer, filter, history);

    yield {
      type: 'sources',
      sources: sourceDocs.map((d) => this.toSource(d)),
    };

    if (this.hasNothingToAnswerFrom(question, sourceDocs)) {
      yield { type: 'token', token: NO_INFORMATION };
      yield { type: 'done' };
      return;
    }

    const chain = this.answerChain(sourceDocs, history);

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

  async ask(
    question: string,
    viewer: RagViewer,
    filter: RagFilter = 'all',
    history: RagTurn[] = [],
  ): Promise<RagAnswer> {
    // Retrieved once and shared with the chain, as in `askStream`.
    const sourceDocs = await this.retrieve(question, viewer, filter, history);

    if (this.hasNothingToAnswerFrom(question, sourceDocs)) {
      return { answer: NO_INFORMATION, sources: [] };
    }

    const answer = await this.answerChain(sourceDocs, history).invoke(question);

    return { answer, sources: sourceDocs.map((d) => this.toSource(d)) };
  }

  /**
   * A real question that retrieved nothing has only one honest answer, and
   * the prompt already tells the model to give it. Saying it here skips a
   * completion that costs money to produce the same sentence — or, worse, to
   * produce something invented. Small talk also retrieves nothing, but it is
   * meant to reach the model.
   */
  private hasNothingToAnswerFrom(question: string, docs: Document[]): boolean {
    return docs.length === 0 && !isSmallTalk(question);
  }

  private answerChain(sourceDocs: Document[], history: RagTurn[]) {
    return RunnableSequence.from([
      {
        context: () => sourceDocs.map((d) => d.pageContent).join('\n\n'),
        history: () => formatHistory(history),
        question: new RunnablePassthrough(),
      },
      this.answerPrompt(),
      this.llm,
      new StringOutputParser(),
    ]);
  }

  /** Nothing is looked up for small talk, so it cites nothing either. */
  private async retrieve(
    question: string,
    viewer: RagViewer,
    filter: RagFilter,
    history: RagTurn[] = [],
  ): Promise<Document[]> {
    const store = this.store();
    if (isSmallTalk(question)) return [];

    // Shared by `ask` and `askStream` so the two cannot retrieve differently.
    const scope = buildRetrievalFilter(filter, viewer);
    const retriever = scope
      ? store.asRetriever({ k: 5, filter: scope })
      : store.asRetriever({ k: 5 });

    return retriever.invoke(retrievalQuery(question, history));
  }

  private answerPrompt(): ChatPromptTemplate {
    return ChatPromptTemplate.fromTemplate(`
      You are a helpful parcel delivery assistant.

      If the message is a greeting, thanks, or small talk rather than a
      question, reply in one short friendly sentence and offer to help with
      tracking a parcel or delivery questions. Do not mention the context.

      Otherwise, answer the question based only on the context below.
      If the context does not contain the answer, say
      "${NO_INFORMATION}"

      The conversation so far is only there to tell you what "it", "that
      parcel" and the like refer to. Never treat it as a source of facts.

      Context: {context}

      Conversation so far:
      {history}

      Message: {question}
    `);
  }

  private toSource(doc: Document): RagSource {
    const metadata = doc.metadata as {
      type: string;
      source?: string;
      tracking_code?: string;
      loc?: { pageNumber?: number };
    };

    return {
      type: metadata.type,
      source: metadata.source ?? metadata.tracking_code ?? '',
      page: metadata.loc?.pageNumber ?? null,
    };
  }
}
