import * as Crypto from 'expo-crypto';

/**
 * Ghost Keys Service
 * 
 * Implements the Ghost ID derivation algorithm:
 * ghost_id = SHA256(user_id + ghost_secret)
 */

/**
 * Generate a new 32-byte ghost_secret
 */
export function generateGhostSecret(): string {
  const randomBytes = Crypto.getRandomBytes(32);
  return Array.from(randomBytes)
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Format a SHA256 hash as a UUID v4
 * 
 * @param hashHex - The 64-character SHA256 hex string
 * @returns A formatted UUID string
 */
export function formatAsUUID(hashHex: string): string {
  // hashHex = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2"
  // ghost_id = "a1b2c3d4-e5f6-4a7b-c9d0-e1f2a3b4c5d6"
  // Position 12 (index 12) is hardcoded to '4'
  
  return [
    hashHex.slice(0, 8),
    hashHex.slice(8, 12),
    `4${hashHex.slice(13, 16)}`,
    hashHex.slice(16, 20),
    hashHex.slice(20, 32),
  ].join('-');
}

/**
 * Derive a Ghost ID from a User ID and Secret
 * 
 * @param userId - The Supabase user UUID
 * @param ghostSecret - The 32-byte hex secret
 * @returns The derived Ghost ID (UUID format)
 */
export async function deriveGhostId(userId: string, ghostSecret: string): Promise<string> {
  const data = userId + ghostSecret;

  const hashHex = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    data
  );

  return formatAsUUID(hashHex);
}
