import { User } from '../entities/user.entity';

/** A user with the password hash stripped — the only shape leaving the API. */
export type SafeUser = Omit<User, 'password'>;
