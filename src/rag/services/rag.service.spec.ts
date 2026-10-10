import { ServiceUnavailableException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Role } from '../../user/types/user.types';
import { buildRetrievalFilter, isSmallTalk, RagService } from './rag.service';

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
