import { Passkey } from 'react-native-passkey';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { supabase } from './supabase';

const CREDENTIAL_ID_KEY = 'gatekeeper_passkey_credential_id';

/**
 * Gatekeeper Production-Grade Passkey Manager
 */

// Robust Base64URL implementation for React Native (No btoa/TextEncoder needed)
const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function toBase64URL(bytes: Uint8Array): string {
  let base64 = '';
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    base64 += chars[bytes[i] >> 2];
    base64 += chars[((bytes[i] & 3) << 4) | (bytes[i + 1] >> 4)];
    base64 += chars[((bytes[i + 1] & 15) << 2) | (bytes[i + 2] >> 6)];
    base64 += chars[bytes[i + 2] & 63];
  }
  
  // Clean up padding and convert to URL-safe
  return base64
    .substring(0, Math.ceil((len * 8) / 6))
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function stringToUint8Array(str: string): Uint8Array {
  const arr = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) arr[i] = str.charCodeAt(i);
  return arr;
}

export async function registerPasskey(email: string): Promise<{ success: boolean; error?: string }> {
  try {
    const isSupported = await Passkey.isSupported();
    if (!isSupported) return { success: false, error: 'Passkeys not supported' };

    const challenge = toBase64URL(Crypto.getRandomBytes(32));
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    // Log full auth token
    const { data: { session } } = await supabase.auth.getSession();
    console.log('[Passkey] Full auth token:', session?.access_token);

    const rpId = 'gatekeeper-nine.vercel.app';

    const request = {
      challenge,
      rp: { name: 'Gatekeeper', id: rpId },
      user: {
        id: toBase64URL(stringToUint8Array(user.id)),
        name: email,
        displayName: email,
      },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'discouraged' },
    };

    console.log('[Passkey] Full request:', JSON.stringify(request, null, 2));
    console.log('[Passkey] User ID (raw):', user.id);
    console.log('[Passkey] User ID (encoded):', toBase64URL(stringToUint8Array(user.id)));

    const credential = await Passkey.create(request);
    if (!credential) return { success: false, error: 'Cancelled' };

    // Save credential_id locally for future authentication
    await SecureStore.setItemAsync(CREDENTIAL_ID_KEY, credential.id);
    console.log('[Passkey] Saved credential_id locally:', credential.id);

    // Use fetch directly to have full control over headers
    const functionUrl = `${process.env.EXPO_PUBLIC_GATEKEEPER_URL}/functions/v1/passkey-register`;
    console.log('[Passkey] Calling passkey-register at:', functionUrl);

    // Send attestation_object to server - the server extracts the public key from it
    // (react-native-passkey does not provide the public key directly)
    const registerResponse = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session?.access_token}`,
        'apikey': process.env.EXPO_PUBLIC_GATEKEEPER_PUBLISHABLE_KEY || '',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        credential_id: credential.id,
        attestation_object: credential.response.attestationObject,
        device_name: `${Platform.OS} - Device Key`,
        authenticator_type: 'platform',
      }),
    });

    if (!registerResponse.ok) {
      const errorText = await registerResponse.text();
      console.error('[Passkey] Registration failed:', registerResponse.status, errorText);
      throw new Error(`Registration failed: ${errorText}`);
    }

    const serverError = null;

    if (serverError) throw serverError;
    return { success: true };
  } catch (error: any) {
    console.error('[Passkey] Registration error:', error);
    return { success: false, error: error.message };
  }
}

export async function authenticateWithPasskey(): Promise<{ success: boolean; error?: string }> {
  try {
    // Get stored credential_id
    const credentialId = await SecureStore.getItemAsync(CREDENTIAL_ID_KEY);
    if (!credentialId) {
      return { success: false, error: 'No passkey registered on this device' };
    }

    console.log('[Passkey] Using stored credential_id:', credentialId);

    // Request challenge from server
    const functionUrl = `${process.env.EXPO_PUBLIC_GATEKEEPER_URL}/functions/v1/passkey-auth?credential_id=${encodeURIComponent(credentialId)}`;
    const challengeResponse = await fetch(functionUrl, {
      method: 'GET',
      headers: {
        'apikey': process.env.EXPO_PUBLIC_GATEKEEPER_PUBLISHABLE_KEY || '',
        'Content-Type': 'application/json',
      },
    });

    if (!challengeResponse.ok) {
      const errorText = await challengeResponse.text();
      throw new Error(`Challenge request failed: ${errorText}`);
    }

    const challengeData = await challengeResponse.json();

    // Prompt for fingerprint and get signed assertion
    console.log('[Passkey] Requesting assertion with challenge:', challengeData.challenge);
    const assertion = await Passkey.get({
      challenge: challengeData.challenge,
      rpId: 'gatekeeper-nine.vercel.app',
      userVerification: 'preferred',
      allowCredentials: [{ id: credentialId, type: 'public-key' }],
    });
    console.log('[Passkey] Got assertion:', assertion ? 'yes' : 'no');

    if (!assertion) return { success: false, error: 'Cancelled' };

    // Verify with server
    const verifyUrl = `${process.env.EXPO_PUBLIC_GATEKEEPER_URL}/functions/v1/passkey-auth`;
    const verifyResponse = await fetch(verifyUrl, {
      method: 'POST',
      headers: {
        'apikey': process.env.EXPO_PUBLIC_GATEKEEPER_PUBLISHABLE_KEY || '',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        challenge_key: challengeData.challenge_key,
        credential_id: assertion.id,
        authenticator_data: assertion.response.authenticatorData,
        client_data_json: assertion.response.clientDataJSON,
        signature: assertion.response.signature,
      }),
    });

    if (!verifyResponse.ok) {
      const errorText = await verifyResponse.text();
      throw new Error(`Verification failed: ${errorText}`);
    }

    const authData = await verifyResponse.json();
    console.log('[Passkey] Auth successful, user_id:', authData?.user_id);

    // ------------------------------------------------------------------
    // Call mint-session to get Supabase tokens
    // ------------------------------------------------------------------
    const mintUrl = `${process.env.EXPO_PUBLIC_GATEKEEPER_URL}/functions/v1/mint-session`;
    console.log('[Passkey] Calling mint-session...');

    const mintResponse = await fetch(mintUrl, {
      method: 'POST',
      headers: {
        'apikey': process.env.EXPO_PUBLIC_GATEKEEPER_PUBLISHABLE_KEY || '',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        verification_token: authData.verification_token,
        user_id: authData.user_id,
      }),
    });

    if (!mintResponse.ok) {
      const errorText = await mintResponse.text();
      throw new Error(`Session minting failed: ${errorText}`);
    }

    const sessionData = await mintResponse.json();
    console.log('[Passkey] Session minted, setting session...');

    // Set the session in Supabase client
    const { error: setSessionError } = await supabase.auth.setSession({
      access_token: sessionData.access_token,
      refresh_token: sessionData.refresh_token,
    });

    if (setSessionError) {
      throw new Error(`Failed to set session: ${setSessionError.message}`);
    }

    console.log('[Passkey] Session set successfully');
    return { success: true };
  } catch (error: any) {
    console.error('[Passkey] Auth error:', error);
    return { success: false, error: error.message };
  }
}

// Check if device has a registered passkey
export async function hasStoredPasskey(): Promise<boolean> {
  const credentialId = await SecureStore.getItemAsync(CREDENTIAL_ID_KEY);
  return !!credentialId;
}

// Clear stored passkey (for logout or reset)
export async function clearStoredPasskey(): Promise<void> {
  await SecureStore.deleteItemAsync(CREDENTIAL_ID_KEY);
}
