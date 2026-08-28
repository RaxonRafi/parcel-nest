import { Test, TestingModule } from '@nestjs/testing';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserService } from '../services/user.service';
import { QueryUsersDto } from '../dto/query-users.dto';
import { UserController } from './user.controller';

describe('UserController', () => {
  let controller: UserController;
  const userService = {
    getAllUsers: jest.fn().mockResolvedValue([]),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserController],
      providers: [{ provide: UserService, useValue: userService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<UserController>(UserController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('passes the pagination query through to the service', async () => {
    const query = Object.assign(new QueryUsersDto(), { page: 2, limit: 50 });

    await controller.getAllUsers(query);

    expect(userService.getAllUsers).toHaveBeenCalledWith(query);
  });
});
