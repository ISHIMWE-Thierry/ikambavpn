/**
 * RevenueCat Web Billing — Subscription payment integration
 *
 * Flow:
 *  1.  Configure Purchases SDK with API key + Firebase user ID
 *  2.  Fetch offerings (packages configured in RC dashboard)
 *  3.  Call purchase() with the selected package → opens Stripe checkout
 *  4.  On success, RC returns CustomerInfo with active entitlements
 *
 * Prerequisites (RevenueCat dashboard):
 *  - Stripe account connected
 *  - Web Billing app created → get API key (rcb_… or rcb_sb_…)
 *  - Products, offerings, packages created
 *  - Entitlements linked to products
 */

import { Purchases, type CustomerInfo, type Offering, type Package, LogLevel } from '@revenuecat/purchases-js';

// ── Configuration ─────────────────────────────────────────────────────────────

const RC_API_KEY = import.meta.env.VITE_REVENUECAT_API_KEY as string;

/**
 * Initialize (or reconfigure) RevenueCat for the given user.
 * Must be called once the user is authenticated.
 *
 * @param firebaseUid  The Firebase Auth UID (used as appUserId in RevenueCat)
 */
export function initRevenueCat(firebaseUid: string): void {
  if (!RC_API_KEY) {
    console.warn('[RevenueCat] No API key configured (VITE_REVENUECAT_API_KEY)');
    return;
  }

  if (Purchases.isConfigured()) {
    // Already configured — switch user if different
    const current = Purchases.getSharedInstance();
    if (current.getAppUserId() !== firebaseUid) {
      current.changeUser(firebaseUid).catch((err) =>
        console.error('[RevenueCat] changeUser failed:', err),
      );
    }
    return;
  }

  Purchases.setLogLevel(LogLevel.Debug);
  Purchases.configure({ apiKey: RC_API_KEY, appUserId: firebaseUid });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Check whether RevenueCat SDK is configured and ready */
export function isRevenueCatReady(): boolean {
  return !!RC_API_KEY && Purchases.isConfigured();
}

/** Get the singleton instance. Throws if not configured. */
function getInstance(): Purchases {
  return Purchases.getSharedInstance();
}

// ── Offerings ─────────────────────────────────────────────────────────────────

/**
 * Fetch the current offering (the one marked "current" in RC dashboard).
 * Returns null if none are configured.
 */
export async function getCurrentOffering(): Promise<Offering | null> {
  const offerings = await getInstance().getOfferings();
  return offerings.current ?? null;
}

/**
 * Fetch all offerings.
 */
export async function getAllOfferings() {
  return getInstance().getOfferings();
}

// ── Purchase ──────────────────────────────────────────────────────────────────

/**
 * Start a purchase for the given package.
 * Opens the RevenueCat / Stripe checkout UI inline or as a modal.
 *
 * @param rcPackage   The package to purchase (from an offering)
 * @param email       Customer email (optional — RC will ask if not provided)
 * @param htmlTarget  DOM element to mount the checkout in (optional — modal if omitted)
 * @returns           CustomerInfo after successful purchase
 */
export async function purchasePackage(
  rcPackage: Package,
  email?: string,
  htmlTarget?: HTMLElement,
): Promise<CustomerInfo> {
  const result = await getInstance().purchase({
    rcPackage,
    customerEmail: email,
    htmlTarget,
  });
  return result.customerInfo;
}

// ── Customer Info & Entitlements ──────────────────────────────────────────────

/**
 * Get the latest customer info (entitlements, subscriptions, etc.)
 */
export async function getCustomerInfo(): Promise<CustomerInfo> {
  return getInstance().getCustomerInfo();
}

/**
 * Check whether the user is entitled to a specific entitlement.
 *
 * @param entitlementId  The entitlement identifier (configured in RC dashboard)
 */
export async function isEntitled(entitlementId: string): Promise<boolean> {
  return getInstance().isEntitledTo(entitlementId);
}

/**
 * Check whether the user has any active VPN entitlement.
 * Uses the "vpn_access" entitlement by default.
 */
export async function hasActiveVpnEntitlement(
  entitlementId = 'vpn_access',
): Promise<boolean> {
  try {
    if (!isRevenueCatReady()) return false;
    return await isEntitled(entitlementId);
  } catch {
    return false;
  }
}

// ── Teardown ──────────────────────────────────────────────────────────────────

/**
 * Close the Purchases instance (e.g. on logout).
 */
export function closeRevenueCat(): void {
  if (Purchases.isConfigured()) {
    Purchases.getSharedInstance().close();
  }
}
