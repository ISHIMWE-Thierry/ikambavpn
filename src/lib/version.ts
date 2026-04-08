/**
 * App build number — increment this whenever you push a release that
 * users MUST update to (breaking change, critical fix, new required flow).
 *
 * Admin sets minBuildNumber in Firestore (app_config/vpn).
 * If APP_BUILD < minBuildNumber → user sees forced refresh screen.
 *
 * How to force a refresh for all users:
 *   1. Increment APP_BUILD here
 *   2. Deploy
 *   3. Go to /admin/settings → set Min build number to the new value
 */
export const APP_BUILD = 2;
