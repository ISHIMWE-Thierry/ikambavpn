export type UserRole = 'user' | 'admin';

export interface UserProfile {
  id: string;
  email: string | null;
  fullName: string | null;
  phoneNumber: string | null;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
}

export type OrderStatus =
  | 'pending_payment'
  | 'payment_submitted'
  | 'active'
  | 'expired'
  | 'cancelled';

export interface VpnOrder {
  id: string;
  userId: string;
  userEmail: string | null;
  userName: string | null;
  planId: string;
  planName: string;
  planDuration: string;       // e.g. "1 Month", "3 Months"
  amount: number;             // in USD
  currency: string;
  status: OrderStatus;
  paymentMethod: string;      // e.g. "Mobile Money", "Bank Transfer"
  paymentProofUrl?: string;
  activatedAt?: string;
  expiresAt?: string;
  credentials?: VpnCredentials;
  createdAt: string;
  updatedAt: string;
}

export interface VpnCredentials {
  username?: string;
  password?: string;
  serverAddress?: string;
  configFile?: string;
  notes?: string;
}

export interface VpnPlan {
  id: string;
  name: string;
  description: string;
  duration: string;
  price: number;
  currency: string;
  features: string[];
  popular?: boolean;
  resellProductId?: string;   // ID from ResellPortal
}

export interface PaymentAccount {
  id: string;
  method: string;             // e.g. "Mobile Money", "Bank Transfer"
  provider?: string;          // e.g. "MTN", "Airtel"
  accountName: string;
  accountNumber: string;
  instructions: string;
  active: boolean;
}

export interface ResellProduct {
  id: number;
  name: string;
  description: string;
  price: string;
  category: string;
  type: string;
}
