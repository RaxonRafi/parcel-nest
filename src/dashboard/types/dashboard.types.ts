export interface DashboardStats {
  totalUsers: number;
  activeUsers: number;
  blockedUsers: number;
  totalParcels: number;
  parcelsByStatus: Record<string, number>;
  blockedParcels: number;
}

export interface DailyCount {
  /** ISO date, `YYYY-MM-DD`. */
  date: string;
  created: number;
  delivered: number;
}

export interface StatusTiming {
  status: string;
  /** Mean hours a parcel sits in this status before moving on. */
  averageHours: number | null;
  sampleSize: number;
}

export interface CourierThroughput {
  courierId: string;
  courierName: string;
  active: number;
  delivered: number;
  /** Mean hours from assignment to delivery. */
  averageDeliveryHours: number | null;
}

export interface RevenueSummary {
  deliveryFeesBooked: number;
  deliveryFeesDelivered: number;
  codOutstanding: number;
  codCollected: number;
}

export interface DashboardTrends {
  rangeDays: number;
  daily: DailyCount[];
  statusTimings: StatusTiming[];
  courierThroughput: CourierThroughput[];
  revenue: RevenueSummary;
  /** Mean hours from parcel creation to delivery, over the range. */
  averageFulfilmentHours: number | null;
}
