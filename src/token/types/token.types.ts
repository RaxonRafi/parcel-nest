import { JwtPayload } from 'jsonwebtoken';
import { Role } from '../../user/types/user.types';

export interface AppJwtPayload extends JwtPayload {
  userId: string;
  email: string;
  role: Role;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/** Minimal shape the token service needs to mint a token for someone. */
export interface TokenSubject {
  id: string;
  email: string;
  role: Role;
}
