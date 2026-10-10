import { User } from '../entities/user.entity';

/** Columns that exist for the server's own bookkeeping. */
export type PrivateUserField = 'password' | 'failedLoginAttempts' | 'lockedUntil';

/**
 * A user with the password hash and lockout state stripped — the only shape
 * leaving the API.
 */
export type SafeUser = Omit<User, PrivateUserField>;
