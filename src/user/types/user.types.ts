export enum AuthProviderType {
  GOOGLE = 'google',
  CREDENTIALS = 'credentials',
}

export enum Role {
  ADMIN = 'ADMIN',
  SENDER = 'SENDER',
  RECEIVER = 'RECEIVER',
  DELIVERY_PERSONNEL = 'DELIVERY_PERSONNEL',
  PENDING_DELIVERY = 'PENDING_DELIVERY',
}

export enum IsActive {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  BLOCKED = 'BLOCKED',
}

export interface UserStats {
  totalUsers: number;
  activeUsers: number;
  blockedUsers: number;
}
