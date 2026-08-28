import { SafeUser } from '../../user/types/safe-user.type';

export interface AuthResponse {
  user: SafeUser;
  accessToken: string;
  refreshToken: string;
}

export interface AccessTokenResponse {
  accessToken: string;
}

export interface MessageResponse {
  message: string;
}
