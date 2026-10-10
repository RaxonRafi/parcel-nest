import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

/**
 * Lets `UserService` announce that an account lost access without knowing who
 * is listening.
 *
 * The realtime gateway needs to drop a blocked user's sockets, but
 * `RealtimeModule` imports `UserModule` for the handshake check, so a direct
 * call the other way would be a cycle. `UserService` publishes here and the
 * gateway subscribes.
 */
@Injectable()
export class UserEventsService {
  private readonly accessRevoked = new Subject<string>();

  /** Emits the id of a user who was just blocked or deleted. */
  get accessRevoked$(): Observable<string> {
    return this.accessRevoked.asObservable();
  }

  announceAccessRevoked(userId: string): void {
    this.accessRevoked.next(userId);
  }
}
