import { User } from '../entities/user.entity';
import { PrivateUserField, SafeUser } from '../types/safe-user.type';

export const PRIVATE_USER_FIELDS: readonly PrivateUserField[] = [
  'password',
  'failedLoginAttempts',
  'lockedUntil',
];

export function sanitizeUser(user: User): SafeUser {
  const {
    password: _password,
    failedLoginAttempts: _failedLoginAttempts,
    lockedUntil: _lockedUntil,
    ...safeUser
  } = user;
  return safeUser;
}

/**
 * The same scrub, in place, for a user hanging off another entity (a parcel's
 * sender, a log's author) where a copy would break the relation.
 */
export function stripPrivateUserFields(user?: User | null): void {
  if (!user) return;

  for (const field of PRIVATE_USER_FIELDS) {
    delete (user as Partial<User>)[field];
  }
}
