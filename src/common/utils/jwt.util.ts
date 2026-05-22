import jwt, { JwtPayload, SignOptions } from 'jsonwebtoken';
import { Role } from '../../user/user.interface';

export interface AppJwtPayload extends JwtPayload {
  userId: string;
  email: string;
  role: Role;
}

export const generateToken = (
  payload: AppJwtPayload,
  secret: string,
  expiresIn: string,
): string => {
  return jwt.sign(payload, secret, {
    expiresIn,
  } as SignOptions);
};

export const verifyToken = (
  token: string,
  secret: string,
): string | JwtPayload => {
  return jwt.verify(token, secret);
};

export function extractBearerToken(authorization?: string): string | undefined {
  if (!authorization) return undefined;
  return authorization.startsWith('Bearer ')
    ? authorization.slice(7)
    : authorization;
}
