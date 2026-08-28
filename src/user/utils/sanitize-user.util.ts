import { User } from '../entities/user.entity';
import { SafeUser } from '../types/safe-user.type';

export function sanitizeUser(user: User): SafeUser {
  const { password: _password, ...safeUser } = user;
  return safeUser;
}
