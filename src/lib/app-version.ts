/**
 * ============================================================
 * APP VERSION — SINGLE SOURCE OF TRUTH
 * ============================================================
 *
 * Hardcoded version baked into the build. Used by VersionGate
 * to compare against the Firestore `appdata/version` document.
 *
 * To release a new version:
 *   1. Bump this value (e.g. 1.0.0 → 1.0.1)
 *   2. Build & deploy
 *   3. Go to Admin → Settings and deploy the new version number
 *      so all users auto-sync
 *
 * Versioning follows semver: MAJOR.MINOR.PATCH
 *   - PATCH: Bug fixes, small improvements
 *   - MINOR: New features, non-breaking changes
 *   - MAJOR: Breaking changes, major overhaul
 */
export const APP_VERSION = '1.1.0';

/**
 * Compare two semantic version strings.
 * Returns:
 *   1  if v1 > v2
 *   0  if v1 === v2
 *  -1  if v1 < v2
 */
export function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }
  return 0;
}

/**
 * Increment a semver version string.
 *   bumpVersion('1.0.0', 'patch') → '1.0.1'
 *   bumpVersion('1.0.9', 'minor') → '1.1.0'
 *   bumpVersion('1.1.0', 'major') → '2.0.0'
 */
export function bumpVersion(version: string, type: 'patch' | 'minor' | 'major'): string {
  const [major = 0, minor = 0, patch = 0] = version.split('.').map(Number);
  switch (type) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
  }
}
