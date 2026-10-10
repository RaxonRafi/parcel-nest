import { INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AddressInfo } from 'net';
import { io, Socket } from 'socket.io-client';
import { ParcelStatus } from '../parcel/types/parcel.types';
import { TokenService } from '../token/services/token.service';
import { UserEventsService } from '../user/services/user-events.service';
import { UserService } from '../user/services/user.service';
import { Role } from '../user/types/user.types';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeService } from './realtime.service';
import { NOTIFICATION_EVENT, RealtimeNotification } from './realtime.types';

const USERS: Record<string, { id: string; role: Role; blocked?: boolean }> = {
  'sender-token': { id: 'sender-1', role: Role.SENDER },
  'admin-token': { id: 'admin-1', role: Role.ADMIN },
  'blocked-token': { id: 'blocked-1', role: Role.SENDER, blocked: true },
};

describe('RealtimeGateway', () => {
  let app: INestApplication;
  let realtime: RealtimeService;
  let userEvents: UserEventsService;
  let url: string;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        RealtimeGateway,
        RealtimeService,
        UserEventsService,
        {
          provide: TokenService,
          useValue: {
            verifyAccessToken: (token: string) => {
              if (!USERS[token]) throw new UnauthorizedException();
              return { email: token };
            },
          },
        },
        {
          provide: UserService,
          useValue: {
            findByEmail: (email: string) => Promise.resolve(USERS[email]),
            getSignInBlockReason: (user: { blocked?: boolean }) =>
              user.blocked ? 'User is blocked' : null,
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.listen(0);
    realtime = app.get(RealtimeService);
    userEvents = app.get(UserEventsService);
    const server = app.getHttpServer() as { address(): AddressInfo };
    const { port } = server.address();
    url = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    sockets.forEach((socket) => socket.close());
    await app.close();
  });

  function connect(token?: string): Promise<Socket> {
    const socket = io(url, {
      auth: token ? { token } : {},
      transports: ['websocket'],
      reconnection: false,
    });
    sockets.push(socket);
    return new Promise((resolve, reject) => {
      socket.once('connect', () => resolve(socket));
      socket.once('connect_error', reject);
    });
  }

  const nextNotification = (socket: Socket) =>
    new Promise<RealtimeNotification>((resolve) =>
      socket.once(NOTIFICATION_EVENT, resolve),
    );

  const payload = {
    type: 'parcel.status' as const,
    title: 'Parcel delivered',
    message: 'TRK-1 is now delivered',
    trackingId: 'TRK-1',
    status: ParcelStatus.DELIVERED,
  };

  it('rejects a handshake without a valid token', async () => {
    await expect(connect()).rejects.toThrow('unauthorized');
    await expect(connect('nonsense')).rejects.toThrow('unauthorized');
  });

  it('rejects a blocked user', async () => {
    await expect(connect('blocked-token')).rejects.toThrow('unauthorized');
  });

  it('delivers to the targeted user and role, and skips the actor', async () => {
    const sender = await connect('sender-token');
    const admin = await connect('admin-token');

    const forSender = nextNotification(sender);
    const adminGot = jest.fn();
    admin.on(NOTIFICATION_EVENT, adminGot);

    // The admin made the change: the sender hears about it, the admin does not.
    realtime.notify(
      { userIds: ['sender-1'], roles: [Role.ADMIN], exceptUserId: 'admin-1' },
      payload,
    );

    await expect(forSender).resolves.toMatchObject(payload);
    expect(adminGot).not.toHaveBeenCalled();

    const forAdmin = nextNotification(admin);
    realtime.notify({ roles: [Role.ADMIN] }, payload);
    const received = await forAdmin;
    expect(received.id).toEqual(expect.any(String));
    expect(Number.isNaN(Date.parse(received.createdAt))).toBe(false);
  });

  it('drops the sockets of a user who is blocked while connected', async () => {
    const sender = await connect('sender-token');
    const admin = await connect('admin-token');
    const dropped = new Promise<string>((resolve) =>
      sender.once('disconnect', resolve),
    );

    userEvents.announceAccessRevoked('sender-1');

    await expect(dropped).resolves.toBe('io server disconnect');
    expect(admin.connected).toBe(true);
  });
});
