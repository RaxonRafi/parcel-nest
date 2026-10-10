import { Test, TestingModule } from '@nestjs/testing';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { RagService } from '../services/rag.service';
import { RagController } from './rag.controller';

describe('RagController', () => {
  let controller: RagController;

  beforeEach(async () => {
    const allow = { canActivate: () => true };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RagController],
      providers: [{ provide: RagService, useValue: { ask: jest.fn() } }],
    })
      // The routes are guarded now; stub them out so this stays a unit test of
      // the controller rather than of the auth stack.
      .overrideGuard(JwtAuthGuard)
      .useValue(allow)
      .overrideGuard(RolesGuard)
      .useValue(allow)
      .compile();

    controller = module.get<RagController>(RagController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // `ask` once lost its guard to a decorator mix-up and was publicly
  // callable; overriding guards above would hide that, so read the metadata.
  it.each(['ask', 'askStream'] as const)(
    'requires a signed-in user on %s',
    (handler) => {
      const guards = Reflect.getMetadata(
        '__guards__',
        RagController.prototype[handler],
      ) as unknown[] | undefined;

      expect(guards).toContain(JwtAuthGuard);
    },
  );
});
