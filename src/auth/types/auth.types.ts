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

/** Where a sign-in came from — stored so the user can recognise the device. */
export interface SessionContext {
  userAgent?: string;
  ip?: string;
}

/** One signed-in device, as listed by `GET /api/auth/sessions`. */
export interface SessionSummary {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: Date;
  expiresAt: Date;
  /** True for the session the request itself belongs to, when that is known. */
  current: boolean;
}
