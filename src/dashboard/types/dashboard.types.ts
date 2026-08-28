export interface DashboardStats {
  totalUsers: number;
  activeUsers: number;
  blockedUsers: number;
  totalParcels: number;
  parcelsByStatus: Record<string, number>;
  blockedParcels: number;
}
