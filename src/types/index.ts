export type UserRole = 'user' | 'admin' | 'agent';

/**
 * Matches the Blink-1 `users` Firestore document structure exactly so both
 * apps share the same user records without duplication.
 */
export interface UserProfile {
  id: string;
  email: string;
  firstname: string;
  lastname: string;
  tel: string;
  role: UserRole;
  emailVerified: number;        // 0 = unverified, 1 = verified (Blink-1 convention)
  needsOtpVerification?: boolean;
  paymentstatus: string;        // 'False' default (Blink-1 field)
  last_login: string;
  createdAt: string;
  updatedAt: string;
  accountStatus?: string;       // 'active' | 'suspended'
  avatarUrl?: string | null;
  displayName?: string;         // virtual: firstname + ' ' + lastname
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
  planDuration: string;
  amount: number;
  currency: string;
  status: OrderStatus;
  paymentMethod: string;
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
  // WireGuard (VPNresellers)
  wgIp?: string;
  wgPrivateKey?: string;
  wgPublicKey?: string;
  // Internal — VPNresellers account ID for status checks
  vpnrAccountId?: number;
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
  resellProductId?: string;
}

export interface PaymentAccount {
  id: string;
  method: string;
  provider?: string;
  accountName: string;
  accountNumber: string;
  instructions: string;
  active: boolean;
}

export type TrialStatus = 'provisioning' | 'active' | 'expired' | 'failed';

export interface VpnTrial {
  id: string;
  userId: string;
  userEmail: string;
  userName: string;
  resellClientId?: number;
  resellServiceId?: number;
  credentials?: VpnCredentials;
  status: TrialStatus;
  expiresAt: string;       // ISO — now + 24 hours at creation
  createdAt: string;
  updatedAt: string;
}

export interface ResellProduct {
  id: number;
  name: string;
  description: string;
  price: string;
  category: string;
  type: string;
}
