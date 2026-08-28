import { Test, TestingModule } from '@nestjs/testing';
import { RagService } from '../services/rag.service';
import { RagController } from './rag.controller';

describe('RagController', () => {
  let controller: RagController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RagController],
      providers: [{ provide: RagService, useValue: { ask: jest.fn() } }],
    }).compile();

    controller = module.get<RagController>(RagController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
