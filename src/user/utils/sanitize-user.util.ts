import { User } from '../user.entity';
import { SafeUser } from '../interfaces/auth-response.interface';

export function sanitizeUser(user: User): SafeUser {
  const { password: _password, ...safeUser } = user;
  return safeUser;
}
