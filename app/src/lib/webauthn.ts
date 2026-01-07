/**
 * WebAuthn Helper Library
 *
 * Browser-side WebAuthn API helpers for passkey registration and authentication.
 */

import { supabase } from './supabase';

// Gatekeeper edge function URL
const GATEKEEPER_URL = import.meta.env.VITE_GATEKEEPER_URL;

/**
 * Check if WebAuthn is supported in this browser
 */
export function isWebAuthnSupported(): boolean {
  return (
    window.PublicKeyCredential !== undefined &&
    typeof window.PublicKeyCredential === 'function'
  );
}

/**
 * Check if platform authenticator (biometric) is available
 */
export async function isPlatformAuthenticatorAvailable(): Promise<boolean> {
  if (!isWebAuthnSupported()) return false;

  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/**
 * Convert ArrayBuffer to base64url string
 */
function bufferToBase64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * Convert base64url string to ArrayBuffer
 */
function base64urlToBuffer(base64url: string): ArrayBuffer {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(base64 + padding);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Convert ArrayBuffer to base64 string (standard)
 */
function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Generate a random challenge
 */
function generateChallenge(): Uint8Array {
  const challenge = new Uint8Array(32);
  crypto.getRandomValues(challenge);
  return challenge;
}

/**
 * Register a new passkey for the current user
 *
 * @param userId - User ID from Supabase auth
 * @param userEmail - User's email for display
 * @param deviceName - Optional name for this device
 */
export async function registerPasskey(
  userId: string,
  userEmail: string,
  deviceName?: string
): Promise<{ success: boolean; error?: string }> {
  if (!isWebAuthnSupported()) {
    return { success: false, error: 'WebAuthn is not supported in this browser' };
  }

  try {
    // Generate registration options
    const challenge = generateChallenge();

    const rpId = window.location.hostname;
    const rpName = 'Gatekeeper';

    const publicKeyCredentialCreationOptions: PublicKeyCredentialCreationOptions = {
      challenge: challenge,
      rp: {
        name: rpName,
        id: rpId,
      },
      user: {
        id: new TextEncoder().encode(userId),
        name: userEmail,
        displayName: userEmail.split('@')[0],
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },   // ES256
        { type: 'public-key', alg: -257 }, // RS256
      ],
      authenticatorSelection: {
        // Don't restrict to platform - let browser/device decide
        // This allows both Face ID/Touch ID AND security keys
        userVerification: 'preferred', // Changed from 'required' to avoid mobile issues
        residentKey: 'preferred',
      },
      timeout: 120000, // Increased timeout for slow biometric prompts
      attestation: 'none',
    };

    // Create credential
    const credential = await navigator.credentials.create({
      publicKey: publicKeyCredentialCreationOptions,
    }) as PublicKeyCredential;

    if (!credential) {
      return { success: false, error: 'Failed to create credential' };
    }

    const response = credential.response as AuthenticatorAttestationResponse;

    // Extract public key from attestation
    const publicKeyBytes = response.getPublicKey();
    if (!publicKeyBytes) {
      return { success: false, error: 'Failed to get public key' };
    }

    // Get the access token for API call
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      return { success: false, error: 'Not authenticated' };
    }

    // Determine authenticator type
    const authenticatorType = response.getTransports?.()?.includes('internal')
      ? 'platform'
      : 'cross-platform';

    // Register with Gatekeeper
    const registerResponse = await fetch(`${GATEKEEPER_URL}/functions/v1/passkey-register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        credential_id: bufferToBase64url(credential.rawId),
        public_key: bufferToBase64(publicKeyBytes),
        device_name: deviceName || getDeviceName(),
        authenticator_type: authenticatorType,
        transports: response.getTransports?.() || ['internal'],
      }),
    });

    if (!registerResponse.ok) {
      const errorData = await registerResponse.json().catch(() => ({}));
      return {
        success: false,
        error: errorData.error || `Registration failed: ${registerResponse.status}`
      };
    }

    return { success: true };
  } catch (error: any) {
    console.error('[WebAuthn] Registration error:', error);

    // Handle specific WebAuthn errors
    if (error.name === 'NotAllowedError') {
      return { success: false, error: 'Registration was cancelled or not allowed' };
    }
    if (error.name === 'SecurityError') {
      return { success: false, error: 'Security error - ensure you are on HTTPS' };
    }

    return { success: false, error: error.message || 'Registration failed' };
  }
}

/**
 * Authenticate with a registered passkey
 *
 * @param credentialId - Optional specific credential to use
 * @returns User ID and tier on success
 */
export async function authenticateWithPasskey(
  credentialId?: string
): Promise<{ success: boolean; userId?: string; tier?: string; error?: string }> {
  if (!isWebAuthnSupported()) {
    return { success: false, error: 'WebAuthn is not supported in this browser' };
  }

  try {
    // If we have a specific credential ID, get challenge from server
    let serverChallenge: string | undefined;
    let challengeKey: string | undefined;

    if (credentialId) {
      const challengeResponse = await fetch(
        `${GATEKEEPER_URL}/functions/v1/passkey-auth?credential_id=${encodeURIComponent(credentialId)}`
      );

      if (!challengeResponse.ok) {
        return { success: false, error: 'Failed to get authentication challenge' };
      }

      const challengeData = await challengeResponse.json();
      serverChallenge = challengeData.challenge;
      challengeKey = challengeData.challenge_key;
    }

    // Prepare authentication options
    const rpId = window.location.hostname;

    const publicKeyCredentialRequestOptions: PublicKeyCredentialRequestOptions = {
      challenge: serverChallenge
        ? base64urlToBuffer(serverChallenge)
        : generateChallenge(),
      rpId: rpId,
      userVerification: 'preferred', // Changed from 'required' to avoid mobile issues
      timeout: 120000, // Increased timeout
      allowCredentials: credentialId ? [{
        type: 'public-key',
        id: base64urlToBuffer(credentialId),
        transports: ['internal', 'hybrid'],
      }] : undefined,
    };

    // Get credential
    const credential = await navigator.credentials.get({
      publicKey: publicKeyCredentialRequestOptions,
    }) as PublicKeyCredential;

    if (!credential) {
      return { success: false, error: 'Authentication cancelled' };
    }

    const response = credential.response as AuthenticatorAssertionResponse;

    // If we don't have a server challenge yet, get one now with the credential ID
    if (!serverChallenge) {
      const credId = bufferToBase64url(credential.rawId);
      const challengeResponse = await fetch(
        `${GATEKEEPER_URL}/functions/v1/passkey-auth?credential_id=${encodeURIComponent(credId)}`
      );

      if (!challengeResponse.ok) {
        return { success: false, error: 'Passkey not registered' };
      }

      const challengeData = await challengeResponse.json();
      serverChallenge = challengeData.challenge;
      challengeKey = challengeData.challenge_key;

      // Need to re-authenticate with the server's challenge
      // This is a limitation - for now we'll proceed and let server validate
    }

    // Verify with server
    const verifyResponse = await fetch(`${GATEKEEPER_URL}/functions/v1/passkey-auth`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        challenge_key: challengeKey,
        credential_id: bufferToBase64url(credential.rawId),
        authenticator_data: bufferToBase64(response.authenticatorData),
        client_data_json: bufferToBase64(response.clientDataJSON),
        signature: bufferToBase64(response.signature),
      }),
    });

    if (!verifyResponse.ok) {
      const errorData = await verifyResponse.json().catch(() => ({}));
      return {
        success: false,
        error: errorData.error || 'Authentication failed'
      };
    }

    const result = await verifyResponse.json();
    return {
      success: true,
      userId: result.user_id,
      tier: result.tier,
    };
  } catch (error: any) {
    console.error('[WebAuthn] Authentication error:', error);

    if (error.name === 'NotAllowedError') {
      return { success: false, error: 'Authentication was cancelled' };
    }

    return { success: false, error: error.message || 'Authentication failed' };
  }
}

/**
 * Get list of user's registered passkeys
 */
export async function listPasskeys(): Promise<{
  success: boolean;
  passkeys?: Array<{
    id: string;
    credential_id: string;
    device_name: string;
    authenticator_type: string;
    created_at: string;
    last_used_at: string | null;
    is_active: boolean;
  }>;
  error?: string;
}> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      return { success: false, error: 'Not authenticated' };
    }

    const response = await fetch(`${GATEKEEPER_URL}/functions/v1/passkey-register`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
      },
    });

    if (!response.ok) {
      return { success: false, error: 'Failed to fetch passkeys' };
    }

    const data = await response.json();
    return { success: true, passkeys: data.passkeys };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Delete a passkey
 */
export async function deletePasskey(passkeyId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      return { success: false, error: 'Not authenticated' };
    }

    const response = await fetch(`${GATEKEEPER_URL}/functions/v1/passkey-register`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ passkey_id: passkeyId }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return { success: false, error: errorData.error || 'Failed to delete passkey' };
    }

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Get a friendly device name
 */
function getDeviceName(): string {
  const ua = navigator.userAgent;

  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android Device';
  if (/Mac/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows PC';
  if (/Linux/.test(ua)) return 'Linux PC';

  return 'Unknown Device';
}
