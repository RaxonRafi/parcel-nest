import {
  BadRequestException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Role } from '../../user/types/user.types';
import {
  buildRetrievalFilter,
  isSmallTalk,
  NO_INFORMATION,
  RagService,
  retrievalQuery,
} from './rag.service';

describe('RagService', () => {
  let service: RagService;

  beforeEach(async () => {
    // compile() does not run onModuleInit, so no live Pinecone/Groq call here.
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RagService,
        {
          provide: ConfigService,
          useValue: { get: jest.fn(), getOrThrow: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<RagService>(RagService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('without provider keys', () => {
    const viewer = { id: 'user-1', role: Role.SENDER };

    beforeEach(async () => {
      await service.onModuleInit();
    });

    it('boots switched off instead of throwing', () => {
      expect(service.isEnabled).toBe(false);
    });

    it('lets parcel writes go through by skipping the index', async () => {
      await expect(
        service.indexParcel({
          id: 'p-1',
          trackingCode: 'TRK-1',
          status: 'PENDING',
          origin: 'Dhaka',
          destination: 'Sylhet',
          recipientName: 'Jane',
          updatedAt: new Date().toISOString(),
        }),
      ).resolves.toBeUndefined();
    });

    it('answers 503 on ask', async () => {
      await expect(service.ask('where is it?', viewer)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(() => service.assertAvailable()).toThrow(
        ServiceUnavailableException,
      );
    });
  });
});

describe('RagService — parcel indexing', () => {
  const parcel = (id: string, parties: Record<string, string> = {}) => ({
    id,
    trackingCode: `TRK-${id}`,
    status: 'PENDING',
    origin: 'Dhaka',
    destination: 'Sylhet',
    recipientName: 'Jane',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...parties,
  });

  it('upserts a batch in one call, keyed by parcel and tagged with its parties', async () => {
    const service = new RagService({} as ConfigService);
    const addDocuments = jest.fn();
    (service as unknown as { vectorStore: unknown }).vectorStore = {
      addDocuments,
    };

    await service.indexParcels([
      parcel('a', { senderId: 's-1', receiverId: 'r-1', courierId: 'c-1' }),
      parcel('b', { senderId: 's-2' }),
    ]);

    expect(addDocuments).toHaveBeenCalledTimes(1);
    const [docs, options] = addDocuments.mock.calls[0] as [
      { metadata: Record<string, unknown> }[],
      { ids: string[] },
    ];
    expect(options.ids).toEqual(['parcel-a', 'parcel-b']);
    expect(docs[0].metadata).toMatchObject({
      type: 'parcel',
      sender_id: 's-1',
      receiver_id: 'r-1',
      courier_id: 'c-1',
    });
    // Pinecone rejects null metadata, so an absent party has no key at all.
    expect(docs[1].metadata).not.toHaveProperty('receiver_id');
    expect(docs[1].metadata).not.toHaveProperty('courier_id');
  });
});

/** A service switched on, with the providers replaced by stubs. */
function enabledService() {
  const service = new RagService({} as ConfigService);
  const retrieve = jest.fn().mockResolvedValue([]);
  const index = { listPaginated: jest.fn(), deleteMany: jest.fn() };
  const internals = service as unknown as {
    vectorStore: unknown;
    pineconeIndex: unknown;
    llm: unknown;
  };

  internals.vectorStore = {
    asRetriever: () => ({ invoke: retrieve }),
    addDocuments: jest.fn(),
    delete: jest.fn(),
  };
  internals.pineconeIndex = index;
  // Reaching the model in these tests would be the bug under test.
  internals.llm = {
    invoke: () => {
      throw new Error('the model must not be called');
    },
  };

  return { service, retrieve, index };
}

describe('RagService — asking', () => {
  const viewer = { id: 'user-1', role: Role.SENDER };

  it('answers "no information" itself when retrieval finds nothing', async () => {
    const { service } = enabledService();

    await expect(
      service.ask('Where is TRK-DOES-NOT-EXIST?', viewer),
    ).resolves.toEqual({ answer: NO_INFORMATION, sources: [] });
  });

  it('streams the same answer as one token, then finishes', async () => {
    const { service } = enabledService();
    const chunks: unknown[] = [];

    for await (const chunk of service.askStream('Where is it?', viewer)) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { type: 'sources', sources: [] },
      { type: 'token', token: NO_INFORMATION },
      { type: 'done' },
    ]);
  });

  it('searches with the previous question too, so a follow-up finds its subject', async () => {
    const { service, retrieve } = enabledService();

    await service.ask('and when will it arrive?', viewer, 'all', [
      { role: 'user', content: 'Where is TRK-7K2M9QX4T1VB?' },
      { role: 'assistant', content: 'It is in transit.' },
    ]);

    expect(retrieve).toHaveBeenCalledWith(
      'Where is TRK-7K2M9QX4T1VB?\nand when will it arrive?',
    );
  });
});

describe('retrievalQuery', () => {
  it('is just the question when there is no history', () => {
    expect(retrievalQuery('Where is it?', [])).toBe('Where is it?');
  });

  it('uses the most recent thing the user asked, not what the assistant said', () => {
    expect(
      retrievalQuery('and the fee?', [
        { role: 'user', content: 'first question' },
        { role: 'assistant', content: 'first answer' },
        { role: 'user', content: 'second question' },
        { role: 'assistant', content: 'second answer' },
      ]),
    ).toBe('second question\nand the fee?');
  });
});

describe('RagService — uploads', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'rag-spec-'));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('refuses a file that only claims to be a PDF', async () => {
    const { service } = enabledService();
    const fake = join(dir, 'invoice.pdf');
    await writeFile(fake, '<html><script>alert(1)</script></html>');

    await expect(
      service.ingestPDF(fake, { source: 'invoice.pdf', category: 'general' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses an empty file', async () => {
    const { service } = enabledService();
    const empty = join(dir, 'empty.pdf');
    await writeFile(empty, '');

    await expect(
      service.ingestPDF(empty, { source: 'empty.pdf', category: 'general' }),
    ).rejects.toThrow('That file is not a PDF');
  });
});

describe('RagService — pruning stale parcels', () => {
  it('deletes the vectors whose parcel is gone and keeps the rest', async () => {
    const { service, index } = enabledService();
    index.listPaginated
      .mockResolvedValueOnce({
        vectors: [{ id: 'parcel-a' }, { id: 'parcel-gone-1' }],
        pagination: { next: 'page-2' },
      })
      .mockResolvedValueOnce({
        vectors: [{ id: 'parcel-gone-2' }, { id: 'parcel-b' }],
      });

    await expect(
      service.pruneParcelsExcept(new Set(['a', 'b'])),
    ).resolves.toBe(2);

    expect(index.listPaginated).toHaveBeenNthCalledWith(2, {
      prefix: 'parcel-',
      paginationToken: 'page-2',
    });
    expect(index.deleteMany.mock.calls).toEqual([
      [['parcel-gone-1']],
      [['parcel-gone-2']],
    ]);
  });

  it('gives up quietly on an index that cannot list by prefix', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { service, index } = enabledService();
    index.listPaginated.mockRejectedValue(new Error('not supported'));

    await expect(service.pruneParcelsExcept(new Set())).resolves.toBe(0);
    expect(index.deleteMany).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('buildRetrievalFilter', () => {
  const admin = { id: 'admin-1', role: Role.ADMIN };
  const sender = { id: 'user-1', role: Role.SENDER };
  const ownership = {
    $or: [
      { sender_id: { $eq: 'user-1' } },
      { receiver_id: { $eq: 'user-1' } },
      { courier_id: { $eq: 'user-1' } },
    ],
  };

  it('leaves an admin unrestricted', () => {
    expect(buildRetrievalFilter('all', admin)).toBeUndefined();
    expect(buildRetrievalFilter('parcel', admin)).toEqual({
      type: { $eq: 'parcel' },
    });
  });

  it('limits everyone else to parcels they are a party to', () => {
    expect(buildRetrievalFilter('parcel', sender)).toEqual({
      $and: [{ type: { $eq: 'parcel' } }, ownership],
    });
  });

  it('keeps policy PDFs open while still scoping parcels', () => {
    expect(buildRetrievalFilter('all', sender)).toEqual({
      $or: [
        { type: { $eq: 'pdf' } },
        { $and: [{ type: { $eq: 'parcel' } }, ownership] },
      ],
    });
    expect(buildRetrievalFilter('pdf', sender)).toEqual({
      type: { $eq: 'pdf' },
    });
  });
});

describe('isSmallTalk', () => {
  it.each([
    'hi',
    'Hi!',
    'hello there',
    'Thanks',
    'thank you so much',
    'good morning',
    'ok',
  ])('treats %p as conversation', (message) => {
    expect(isSmallTalk(message)).toBe(true);
  });

  it.each([
    'hi, where is TRK-MTD6TOM9M5XYRL?',
    'what is the status of my parcel',
    'help me track a parcel',
    'ok so what is the refund policy',
  ])('retrieves for %p', (message) => {
    expect(isSmallTalk(message)).toBe(false);
  });
});
