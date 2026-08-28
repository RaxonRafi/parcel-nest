import { Request } from 'express';
import { User } from '../../user/entities/user.entity';

/**
 * Express request after `JwtAuthGuard` has resolved and attached the caller.
 */
export type RequestWithUser = Request & { user: User };
