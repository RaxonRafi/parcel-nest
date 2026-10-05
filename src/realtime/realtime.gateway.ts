import { Logger } from '@nestjs/common';
import {
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { TokenService } from '../token/services/token.service';
import { UserService } from '../user/services/user.service';
import { roleRoom, userRoom } from './realtime.types';

/**
 * Socket.IO entry point. Clients send their access token in the handshake
 * (`io(url, { auth: { token } })`) and are placed in a room per user and per
 * role; they never choose rooms themselves.
 *
 * CORS is configured on the adapter in `main.ts`, where the env is loaded.
 */
@WebSocketGateway()
export class RealtimeGateway implements OnGatewayInit {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly tokenService: TokenService,
    private readonly userService: UserService,
  ) {}

  afterInit(server: Server): void {
    // Middleware rather than `handleConnection`: a rejection here reaches the
    // client as `connect_error`, so it can refresh its token and retry.
    server.use((socket, next) => {
      this.authenticate(socket)
        .then(() => next())
        .catch(() => next(new Error('unauthorized')));
    });
    this.logger.log('Realtime gateway ready');
  }

  /** Same checks as `JwtAuthGuard`: valid token, existing user, not blocked. */
  private async authenticate(socket: Socket): Promise<void> {
    const token: unknown = socket.handshake.auth?.token;

    if (typeof token !== 'string' || !token) {
      throw new Error('missing token');
    }

    const payload = this.tokenService.verifyAccessToken(token);
    const user = await this.userService.findByEmail(payload.email);

    if (!user || this.userService.getSignInBlockReason(user)) {
      throw new Error('rejected');
    }

    await socket.join([userRoom(user.id), roleRoom(user.role)]);
  }
}
