/**
 * Ghost Key Manager (Web Version)
 *
 * This module handles client-side storage of the ghost_id derivation secret.
 * The secret NEVER leaves the device, ensuring true privacy.
 *
 * Privacy Model:
 * - User's ghost_id is derived from user_id + ghost_secret
 * - ghost_secret is stored ONLY on device (localStorage for web)
 * - Server NEVER knows the link between user_id and ghost_id
 * - If device is lost, user can recover using QR code backup
 */

const GHOST_SECRET_KEY = 'xenon_ghost_secret';
const GHOST_ID_CACHE_KEY = 'xenon_ghost_id_cache';
const PENDING_USER_ID_KEY = 'xenon_pending_user_id';

/**
 * Generate a cryptographically secure random secret
 */
function generateSecureRandom(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Derive ghost_id from user_id + secret (deterministic hash)
 */
async function deriveGhostId(userId: string, secret: string): Promise<string> {
  const data = userId + secret;
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(data));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  // Format as UUID v4 (for compatibility with Supabase)
  return `${hashHex.slice(0, 8)}-${hashHex.slice(8, 12)}-4${hashHex.slice(13, 16)}-${hashHex.slice(16, 20)}-${hashHex.slice(20, 32)}`;
}

/**
 * Store ghost secret in device storage
 */
export function storeGhostSecret(secret: string): void {
  localStorage.setItem(GHOST_SECRET_KEY, secret);
}

/**
 * Retrieve ghost secret from device storage
 */
export function getGhostSecret(): string | null {
  return localStorage.getItem(GHOST_SECRET_KEY);
}

/**
 * Initialize ghost identity for a user
 * Creates new secret if none exists, or uses existing one
 */
export async function initializeGhostIdentity(userId: string): Promise<string> {
  // Check if secret already exists
  let secret = getGhostSecret();

  if (!secret) {
    // Generate new secret and store it
    secret = generateSecureRandom();
    storeGhostSecret(secret);
    console.log('[GHOST] New ghost secret created and stored');
  }

  // Derive ghost_id from user_id + secret
  const ghostId = await deriveGhostId(userId, secret);

  // Cache ghost_id for quick access
  localStorage.setItem(GHOST_ID_CACHE_KEY, ghostId);

  return ghostId;
}

/**
 * Get cached ghost_id (fast path, no derivation needed)
 */
export function getCachedGhostId(): string | null {
  return localStorage.getItem(GHOST_ID_CACHE_KEY);
}

/**
 * Store pending user_id from QR code (to verify on login)
 */
export function storePendingUserId(userId: string): void {
  localStorage.setItem(PENDING_USER_ID_KEY, userId);
}

/**
 * Get pending user_id (from QR code import)
 */
export function getPendingUserId(): string | null {
  return localStorage.getItem(PENDING_USER_ID_KEY);
}

/**
 * Clear pending user_id after successful login
 */
export function clearPendingUserId(): void {
  localStorage.removeItem(PENDING_USER_ID_KEY);
}

/**
 * Import ghost secret from QR code
 * Used for account recovery or multi-device sync
 */
export function importGhostSecretFromQR(qrData: string): { userId: string } {
  try {
    const data = JSON.parse(qrData);

    if (!data.ghost_secret || !data.user_id) {
      throw new Error('Invalid QR code format');
    }

    // Store the imported secret
    storeGhostSecret(data.ghost_secret);

    // Store the expected user_id for verification on login
    storePendingUserId(data.user_id);

    console.log('[GHOST] Ghost secret imported from QR code, awaiting login verification');

    return { userId: data.user_id };
  } catch (error) {
    console.error('[GHOST] Failed to import from QR:', error);
    throw new Error('Invalid QR code');
  }
}

/**
 * Verify imported ghost secret matches the authenticated user
 * Call this after successful login to ensure the QR code was for this user
 */
export async function verifyImportedSecret(authenticatedUserId: string): Promise<{
  isValid: boolean;
  ghostId: string | null;
  error?: string;
}> {
  const pendingUserId = getPendingUserId();
  const secret = getGhostSecret();

  // No pending import - normal flow
  if (!pendingUserId) {
    return { isValid: true, ghostId: null };
  }

  // Verify user_id matches
  if (pendingUserId !== authenticatedUserId) {
    // Clear the invalid import
    clearPendingUserId();
    return {
      isValid: false,
      ghostId: null,
      error: `QR code was for a different account. Please scan the QR code for this account.`
    };
  }

  if (!secret) {
    clearPendingUserId();
    return {
      isValid: false,
      ghostId: null,
      error: 'Ghost secret not found. Please scan QR code again.'
    };
  }

  // Derive ghost_id using imported secret
  const ghostId = await deriveGhostId(authenticatedUserId, secret);

  // Cache it
  localStorage.setItem(GHOST_ID_CACHE_KEY, ghostId);

  // Clear pending state
  clearPendingUserId();

  console.log('[GHOST] Imported ghost identity verified and activated:', ghostId);

  return { isValid: true, ghostId };
}

/**
 * Export ghost secret as QR code data
 * Used for backup or multi-device sync
 */
export function exportGhostSecretForQR(userId: string): string {
  const secret = getGhostSecret();

  if (!secret) {
    throw new Error('No ghost secret found. Initialize identity first.');
  }

  // Create QR code payload
  const qrData = {
    ghost_secret: secret,
    user_id: userId,
    created_at: new Date().toISOString(),
  };

  return JSON.stringify(qrData);
}

/**
 * Clear ghost identity cache (for logout)
 * Preserves the ghost_secret so the same ghost_id is used on re-login
 */
export function clearGhostCache(): void {
  localStorage.removeItem(GHOST_ID_CACHE_KEY);
  console.log('[GHOST] Ghost identity cache cleared (secret preserved)');
}

/**
 * Fully clear ghost identity (for account reset or device wipe)
 * WARNING: This deletes the ghost_secret - the ghost_id cannot be recovered
 * unless the user has a QR backup!
 */
export function clearGhostIdentity(): void {
  localStorage.removeItem(GHOST_SECRET_KEY);
  localStorage.removeItem(GHOST_ID_CACHE_KEY);
  console.log('[GHOST] Ghost identity fully cleared (secret deleted)');
}
