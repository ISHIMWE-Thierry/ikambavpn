import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  addDoc,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage, COLLECTIONS } from './firebase';
import type { UserProfile, VpnOrder, PaymentAccount, VpnPlan, OrderStatus, VpnTrial, TrialStatus } from '../types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString();
}

function tsToString(ts: Timestamp | string | undefined): string {
  if (!ts) return '';
  if (typeof ts === 'string') return ts;
  return ts.toDate().toISOString();
}

// ── Users (shared `users` collection — same structure as Blink-1) ─────────────

/**
 * Read a user doc and normalise phone from any Blink-1 field variant.
 */
export async function getUser(uid: string): Promise<UserProfile | null> {
  const snap = await getDoc(doc(db, COLLECTIONS.USERS, uid));
  if (!snap.exists()) return null;
  const d = snap.data();
  // Blink-1 stores phone under multiple field names — normalise to `tel`
  const tel: string =
    d.tel || d.phone || d.phoneNumber || d.userphone || d.userPhone || d.mobile || d.contact || '';
  return {
    id: snap.id,
    email: d.email || '',
    firstname: d.firstname || d.displayName?.split(' ')[0] || '',
    lastname: d.lastname || d.displayName?.split(' ').slice(1).join(' ') || '',
    tel,
    role: d.role || 'user',
    emailVerified: typeof d.emailVerified === 'number' ? d.emailVerified : (d.emailVerified ? 1 : 0),
    needsOtpVerification: d.needsOtpVerification ?? false,
    paymentstatus: d.paymentstatus || 'False',
    last_login: d.last_login || d.lastLoginAt || d.createdAt || '',
    createdAt: d.createdAt || '',
    updatedAt: d.updatedAt || '',
    accountStatus: d.accountStatus || 'active',
    avatarUrl: d.avatarUrl || null,
    displayName: [d.firstname || '', d.lastname || ''].filter(Boolean).join(' ') ||
      d.displayName || d.email || '',
  } as UserProfile;
}

/**
 * Create a new user doc using Blink-1's exact field structure so both apps
 * share the same user records without format mismatch.
 */
export async function createUser(
  uid: string,
  data: { email: string; firstname: string; lastname: string; tel: string; avatarUrl?: string }
): Promise<void> {
  const ts = now();
  await setDoc(doc(db, COLLECTIONS.USERS, uid), {
    email: data.email,
    firstname: data.firstname,
    lastname: data.lastname,
    tel: data.tel,
    displayName: `${data.firstname} ${data.lastname}`.trim(),
    role: 'user',
    emailVerified: 0,
    needsOtpVerification: false,
    paymentstatus: 'False',
    accountStatus: 'active',
    last_login: ts,
    createdAt: ts,
    updatedAt: ts,
    avatarUrl: data.avatarUrl || null,
    loginCount: 1,
  });
}

/**
 * Update last_login timestamp for returning users.
 */
export async function updateUserLogin(uid: string): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.USERS, uid), {
    last_login: now(),
    updatedAt: now(),
  });
}

export async function updateUser(uid: string, data: Partial<UserProfile>): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.USERS, uid), {
    ...data,
    updatedAt: now(),
  });
}

// ── Orders ────────────────────────────────────────────────────────────────────

export async function createOrder(data: Omit<VpnOrder, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
  const ts = now();
  const ref = await addDoc(collection(db, COLLECTIONS.ORDERS), {
    ...data,
    createdAt: ts,
    updatedAt: ts,
  });
  return ref.id;
}

export async function getOrder(orderId: string): Promise<VpnOrder | null> {
  const snap = await getDoc(doc(db, COLLECTIONS.ORDERS, orderId));
  if (!snap.exists()) return null;
  const d = snap.data();
  return {
    id: snap.id,
    ...d,
    createdAt: tsToString(d.createdAt),
    updatedAt: tsToString(d.updatedAt),
    activatedAt: tsToString(d.activatedAt),
    expiresAt: tsToString(d.expiresAt),
  } as VpnOrder;
}

export async function getUserOrders(userId: string): Promise<VpnOrder[]> {
  const mapDoc = (d: import('firebase/firestore').QueryDocumentSnapshot) => {
    const data = d.data();
    return {
      id: d.id,
      ...data,
      createdAt: tsToString(data.createdAt),
      updatedAt: tsToString(data.updatedAt),
      activatedAt: tsToString(data.activatedAt),
      expiresAt: tsToString(data.expiresAt),
    } as VpnOrder;
  };

  try {
    // Primary query — requires composite index (userId ASC, createdAt DESC)
    const q = query(
      collection(db, COLLECTIONS.ORDERS),
      where('userId', '==', userId),
      orderBy('createdAt', 'desc')
    );
    const snap = await getDocs(q);
    return snap.docs.map(mapDoc);
  } catch (err) {
    // Fallback: if composite index is still building, query without orderBy
    console.warn('getUserOrders: composite index may still be building, using fallback query', err);
    const fallback = query(
      collection(db, COLLECTIONS.ORDERS),
      where('userId', '==', userId)
    );
    const snap = await getDocs(fallback);
    // Manually sort by createdAt desc
    const results = snap.docs.map(mapDoc);
    results.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    return results;
  }
}

export async function getAllOrders(): Promise<VpnOrder[]> {
  const q = query(collection(db, COLLECTIONS.ORDERS), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      ...data,
      createdAt: tsToString(data.createdAt),
      updatedAt: tsToString(data.updatedAt),
      activatedAt: tsToString(data.activatedAt),
      expiresAt: tsToString(data.expiresAt),
    } as VpnOrder;
  });
}

export async function updateOrderStatus(
  orderId: string,
  status: OrderStatus,
  extra?: Partial<VpnOrder>
): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.ORDERS, orderId), {
    status,
    ...extra,
    updatedAt: now(),
  });
}

// ── Payment proof upload ───────────────────────────────────────────────────────

export async function uploadPaymentProof(orderId: string, file: File): Promise<string> {
  // Sanitize filename: remove special chars, preserve extension
  const ext = file.name.split('.').pop() || 'jpg';
  const safeName = `proof_${Date.now()}.${ext}`;
  const storageRef = ref(storage, `payment_proofs/${orderId}/${safeName}`);

  // Set proper content type for the upload
  const metadata = { contentType: file.type || 'image/jpeg' };
  await uploadBytes(storageRef, file, metadata);
  return getDownloadURL(storageRef);
}

// ── Payment accounts (admin-configured) ───────────────────────────────────────

export async function getPaymentAccounts(): Promise<PaymentAccount[]> {
  const snap = await getDocs(
    query(collection(db, COLLECTIONS.PAYMENT_ACCOUNTS), where('active', '==', true))
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as PaymentAccount));
}

export async function savePaymentAccount(
  data: Omit<PaymentAccount, 'id'>
): Promise<string> {
  const ref = await addDoc(collection(db, COLLECTIONS.PAYMENT_ACCOUNTS), data);
  return ref.id;
}

export async function updatePaymentAccount(id: string, data: Partial<PaymentAccount>): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.PAYMENT_ACCOUNTS, id), data);
}

// ── Plans (Firestore-stored, admin-editable) ───────────────────────────────────

export async function getPlans(): Promise<VpnPlan[]> {
  const snap = await getDocs(collection(db, COLLECTIONS.PLANS));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as VpnPlan));
}

export async function savePlan(data: Omit<VpnPlan, 'id'>): Promise<string> {
  const ref = await addDoc(collection(db, COLLECTIONS.PLANS), data);
  return ref.id;
}

export async function updatePlan(id: string, data: Partial<VpnPlan>): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.PLANS, id), data);
}

// ── All users (admin) ─────────────────────────────────────────────────────────

export async function getAllUsers(): Promise<UserProfile[]> {
  const snap = await getDocs(collection(db, COLLECTIONS.USERS));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as UserProfile));
}

// ── App settings (shared with Blink-1 via same Firebase project) ─────────────
// Reads from the same `appdata/appSettings` document that Blink-1 uses,
// so admins only need to manage payment account details in one place.

export interface AppPaymentSettings {
  depositAccountName: string;
  depositAccountNumber: string;
  depositBankName: string;
  depositInstructions: string;
}

const PAYMENT_FALLBACK: AppPaymentSettings = {
  depositAccountName: 'Thierry Ishimwe',
  depositAccountNumber: '+79099049277',
  depositBankName: 'Sberbank',
  depositInstructions: 'Send to our Sberbank number and upload a screenshot of the confirmation.',
};

export async function getAppSettings(): Promise<AppPaymentSettings> {
  try {
    // Try the named appSettings doc first
    const snap = await getDoc(doc(db, 'appdata', 'appSettings'));
    if (snap.exists()) {
      const d = snap.data();
      return {
        depositAccountName: d.depositAccountName || PAYMENT_FALLBACK.depositAccountName,
        depositAccountNumber: d.depositAccountNumber || PAYMENT_FALLBACK.depositAccountNumber,
        depositBankName: d.depositBankName || PAYMENT_FALLBACK.depositBankName,
        depositInstructions: d.depositInstructions || PAYMENT_FALLBACK.depositInstructions,
      };
    }
    // Fall back to first doc in appdata collection (Blink-1 sometimes stores it there)
    const colSnap = await getDocs(collection(db, 'appdata'));
    if (!colSnap.empty) {
      const d = colSnap.docs[0].data();
      return {
        depositAccountName: d.depositAccountName || PAYMENT_FALLBACK.depositAccountName,
        depositAccountNumber: d.depositAccountNumber || PAYMENT_FALLBACK.depositAccountNumber,
        depositBankName: d.depositBankName || PAYMENT_FALLBACK.depositBankName,
        depositInstructions: d.depositInstructions || PAYMENT_FALLBACK.depositInstructions,
      };
    }
  } catch {
    // Silent fallback
  }
  return PAYMENT_FALLBACK;
}

// ── Trials ────────────────────────────────────────────────────────────────────

const TRIAL_DURATION_HOURS = 1; // 1-hour free trial

export async function getUserTrial(userId: string): Promise<VpnTrial | null> {
  try {
    // Primary query — requires composite index (userId ASC, createdAt DESC)
    const q = query(
      collection(db, COLLECTIONS.TRIALS),
      where('userId', '==', userId),
      orderBy('createdAt', 'desc'),
      limit(1)
    );
    const snap = await getDocs(q);
    if (snap.empty) return null;
    const d = snap.docs[0].data();
    return { id: snap.docs[0].id, ...d } as VpnTrial;
  } catch (err) {
    // Fallback: if the composite index is still building, query without orderBy
    console.warn('getUserTrial: composite index may still be building, using fallback query', err);
    const fallback = query(
      collection(db, COLLECTIONS.TRIALS),
      where('userId', '==', userId)
    );
    const snap = await getDocs(fallback);
    if (snap.empty) return null;
    // Manually pick the most recent by createdAt
    let latest = snap.docs[0];
    for (const d of snap.docs) {
      const dCreated = d.data().createdAt || '';
      const lCreated = latest.data().createdAt || '';
      if (dCreated > lCreated) latest = d;
    }
    return { id: latest.id, ...latest.data() } as VpnTrial;
  }
}

export async function createTrial(
  userId: string,
  data: {
    userEmail: string;
    userName: string;
    resellClientId?: number;
    resellServiceId?: number;
    credentials?: VpnTrial['credentials'];
    status: TrialStatus;
  }
): Promise<string> {
  const ts = now();
  const expiresAt = new Date(Date.now() + TRIAL_DURATION_HOURS * 60 * 60 * 1000).toISOString();
  const ref = await addDoc(collection(db, COLLECTIONS.TRIALS), {
    ...data,
    userId,
    expiresAt,
    createdAt: ts,
    updatedAt: ts,
  });
  return ref.id;
}

export async function updateTrial(trialId: string, data: Partial<VpnTrial>): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.TRIALS, trialId), {
    ...data,
    updatedAt: now(),
  });
}

export async function getAllTrials(): Promise<VpnTrial[]> {
  const q = query(collection(db, COLLECTIONS.TRIALS), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as VpnTrial));
}

// ── App config (version gating) ───────────────────────────────────────────────

export interface AppConfig {
  minBuildNumber: number;       // Users below this build are force-refreshed
  maintenanceMode: boolean;     // Show maintenance screen to all users
  maintenanceMessage: string;   // Custom message shown during maintenance
  // Semver version control (like Blink-1)
  version?: string;             // Current deployed version e.g. "1.2.0"
  versionDeployedAt?: number;   // Epoch ms when version was deployed
  versionMessage?: string;      // Message shown to users in update banner
  versionForceRefresh?: boolean;// If true, force immediate refresh
  versionMinimum?: string;      // Block users below this version
  versionUpdatedBy?: string;    // Admin email who deployed
}

const APP_CONFIG_DOC = doc(db, 'app_config', 'vpn');

export async function getAppConfig(): Promise<AppConfig> {
  const snap = await getDoc(APP_CONFIG_DOC);
  if (!snap.exists()) {
    return { minBuildNumber: 1, maintenanceMode: false, maintenanceMessage: '' };
  }
  const d = snap.data();
  return {
    minBuildNumber: d.minBuildNumber ?? 1,
    maintenanceMode: d.maintenanceMode ?? false,
    maintenanceMessage: d.maintenanceMessage ?? '',
  };
}

export async function setAppConfig(data: Partial<AppConfig>): Promise<void> {
  await setDoc(APP_CONFIG_DOC, { ...data, updatedAt: now() }, { merge: true });
}

// Re-export serverTimestamp for convenience
export { serverTimestamp };
