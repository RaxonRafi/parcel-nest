import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { isSmallTalk, RagService } from './rag.service';

describe('RagService', () => {
  let service: RagService;

  beforeEach(async () => {
    // compile() does not run onModuleInit, so no live Pinecone/Groq call here.
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RagService,
        { provide: ConfigService, useValue: { getOrThrow: jest.fn() } },
      ],
    }).compile();

    service = module.get<RagService>(RagService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
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
