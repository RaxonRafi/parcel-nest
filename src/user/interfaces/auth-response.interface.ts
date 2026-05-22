import { User } from '../user.entity';

export type SafeUser = Omit<User, 'password'>;

export interface AuthResponse {
  user: SafeUser;
  accessToken: string;
  refreshToken: string;
}

export interface AccessTokenResponse {
  accessToken: string;
}
