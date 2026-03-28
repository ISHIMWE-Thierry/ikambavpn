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
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage, COLLECTIONS } from './firebase';
import type { UserProfile, VpnOrder, PaymentAccount, VpnPlan, OrderStatus } from '../types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString();
}

function tsToString(ts: Timestamp | string | undefined): string {
  if (!ts) return '';
  if (typeof ts === 'string') return ts;
  return ts.toDate().toISOString();
}

// ── Users ─────────────────────────────────────────────────────────────────────

export async function getUser(uid: string): Promise<UserProfile | null> {
  const snap = await getDoc(doc(db, COLLECTIONS.USERS, uid));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as UserProfile;
}

export async function createUser(uid: string, data: Omit<UserProfile, 'id' | 'createdAt' | 'updatedAt'>): Promise<void> {
  const ts = now();
  await setDoc(doc(db, COLLECTIONS.USERS, uid), {
    ...data,
    role: data.role ?? 'user',
    createdAt: ts,
    updatedAt: ts,
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
  const q = query(
    collection(db, COLLECTIONS.ORDERS),
    where('userId', '==', userId),
    orderBy('createdAt', 'desc')
  );
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
  const storageRef = ref(storage, `payment_proofs/${orderId}/${file.name}`);
  await uploadBytes(storageRef, file);
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

// Re-export serverTimestamp for convenience
export { serverTimestamp };
