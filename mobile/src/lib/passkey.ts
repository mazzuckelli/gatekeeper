import { Passkey } from 'react-native-passkey';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import { supabase } from './supabase';

/**
 * Gatekeeper Production-Grade Passkey Manager
 */

function toBase64URL(buffer: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...buffer));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export async function registerPasskey(email: string): Promise<{ success: boolean; error?: string }> {
  try {
    const isSupported = await Passkey.isSupported();
    if (!isSupported) return { success: false, error: 'Passkeys not supported' };

    const challenge = toBase64URL(Crypto.getRandomBytes(32));
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    // Use the actual Supabase project domain as the RP ID
    const rpId = 'sgjulzvgcyotebbexfue.supabase.co';

    const request = {
      challenge,
      rp: {
        name: 'Gatekeeper',
        id: rpId, 
      },
      user: {
        id: toBase64URL(new TextEncoder().encode(user.id)),
        name: email,
        displayName: email,
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
      },
    };

    const credential = await Passkey.create(request);
    if (!credential) return { success: false, error: 'Cancelled' };

    const { error: serverError } = await supabase.functions.invoke('passkey-register', {
      body: {
        credential_id: credential.id,
        public_key: credential.rawId,
        device_name: `${Platform.OS} - Device Key`,
        authenticator_type: 'platform',
      }
    });

    if (serverError) throw serverError;
    return { success: true };
  } catch (error: any) {
    console.error('[Passkey] Registration error:', error);
    return { success: false, error: error.message };
  }
}

export async function authenticateWithPasskey(): Promise<{ success: boolean; error?: string }> {
  try {
    const { data: challengeData, error: challengeError } = await supabase.functions.invoke('passkey-auth', {
      method: 'GET'
    });
    if (challengeError) throw challengeError;

    const rpId = 'sgjulzvgcyotebbexfue.supabase.co';

    const assertion = await Passkey.get({
      challenge: challengeData.challenge,
      rpId: rpId,
      userVerification: 'required',
    });

    if (!assertion) return { success: false, error: 'Cancelled' };

    const { error: verifyError } = await supabase.functions.invoke('passkey-auth', {
      body: {
        challenge_key: challengeData.challenge_key,
        credential_id: assertion.id,
        authenticator_data: assertion.response.authenticatorData,
        client_data_json: assertion.response.clientDataJSON,
        signature: assertion.response.signature,
      }
    });

    if (verifyError) throw verifyError;
    return { success: true };
  } catch (error: any) {
    console.error('[Passkey] Auth error:', error);
    return { success: false, error: error.message };
  }
}
