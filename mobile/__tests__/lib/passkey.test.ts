import { Passkey } from 'react-native-passkey';
import * as SecureStore from 'expo-secure-store';

// Import the functions we're testing
// Note: We need to mock supabase before importing
jest.mock('../../src/lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: jest.fn(),
      getSession: jest.fn(),
      setSession: jest.fn(),
    },
  },
}));

import {
  registerPasskey,
  authenticateWithPasskey,
  hasStoredPasskey,
  clearStoredPasskey,
} from '../../src/lib/passkey';
import { supabase } from '../../src/lib/supabase';

const GATEKEEPER_URL = process.env.EXPO_PUBLIC_GATEKEEPER_URL || 'https://test.supabase.co';

// Helper to create fetch mock responses
const mockFetchResponse = (data: unknown, status = 200) => {
  const body = typeof data === 'string' ? data : JSON.stringify(data);
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(body),
  } as Response);
};

describe('passkey.ts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockReset();

    // Default successful API responses
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('passkey-register') && !url.includes('?')) {
        // POST to register
        return mockFetchResponse({ success: true });
      }
      if (url.includes('passkey-register')) {
        // GET options
        return mockFetchResponse({
          options: {
            challenge: 'dGVzdC1jaGFsbGVuZ2U',
            rp: { name: 'Gatekeeper', id: 'gatekeeper.app' },
            user: { id: 'dXNlci0xMjM', name: 'test@example.com', displayName: 'Test User' },
            pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
            authenticatorSelection: { userVerification: 'required' },
            timeout: 60000,
          },
          challenge_key: 'challenge-key-123',
        });
      }
      if (url.includes('passkey-auth') && !url.includes('?')) {
        // POST verification
        return mockFetchResponse({
          auth_token: 'auth-token-123',
          verified: true,
        });
      }
      if (url.includes('passkey-auth')) {
        // GET challenge
        return mockFetchResponse({
          challenge: 'dGVzdC1jaGFsbGVuZ2U',
          challenge_key: 'challenge-key-123',
          rp_id: 'gatekeeper.app',
        });
      }
      if (url.includes('mint-session')) {
        return mockFetchResponse({
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
        });
      }
      return mockFetchResponse({ error: 'Unknown endpoint' }, 404);
    });
  });

  describe('base64ToBase64url conversion', () => {
    it('handles base64 strings correctly during registration', async () => {
      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'user-123', email: 'test@example.com' } },
      });
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: { access_token: 'token-123' } },
      });
      (Passkey.isSupported as jest.Mock).mockResolvedValue(true);
      (Passkey.create as jest.Mock).mockResolvedValue({
        id: 'credential-id',
        response: {
          clientDataJSON: 'eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIiwiY2hhbGxlbmdlIjoiYWJjKy8vPT0ifQ==',
          attestationObject: 'o2NmbXRkbm9uZWdhdHRTdG10+/==',
        },
      });

      const result = await registerPasskey('test@example.com');

      expect(result.success).toBe(true);
    });
  });

  describe('registerPasskey()', () => {
    it('returns error when device does not support passkeys', async () => {
      (Passkey.isSupported as jest.Mock).mockResolvedValue(false);

      const result = await registerPasskey('test@example.com');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Passkeys not supported on this device');
    });

    it('returns error when user is not authenticated', async () => {
      (Passkey.isSupported as jest.Mock).mockResolvedValue(true);
      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: null },
      });

      const result = await registerPasskey('test@example.com');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Not authenticated');
    });

    it('returns error when session is missing', async () => {
      (Passkey.isSupported as jest.Mock).mockResolvedValue(true);
      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'user-123' } },
      });
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: null },
      });

      const result = await registerPasskey('test@example.com');

      expect(result.success).toBe(false);
      expect(result.error).toBe('No active session');
    });

    it('returns error when user cancels passkey creation', async () => {
      (Passkey.isSupported as jest.Mock).mockResolvedValue(true);
      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'user-123' } },
      });
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: { access_token: 'token-123' } },
      });
      (Passkey.create as jest.Mock).mockResolvedValue(null);

      const result = await registerPasskey('test@example.com');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Passkey creation cancelled');
    });

    it('stores credential_id in SecureStore on successful registration', async () => {
      (Passkey.isSupported as jest.Mock).mockResolvedValue(true);
      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'user-123', email: 'test@example.com' } },
      });
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: { access_token: 'token-123' } },
      });
      (Passkey.create as jest.Mock).mockResolvedValue({
        id: 'new-credential-id-456',
        response: {
          clientDataJSON: 'eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIn0',
          attestationObject: 'o2NmbXRkbm9uZQ',
        },
      });

      const result = await registerPasskey('test@example.com');

      expect(result.success).toBe(true);
      expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
        'gatekeeper_passkey_credential_id',
        'new-credential-id-456'
      );
    });

    it('returns error when server rejects registration', async () => {
      (Passkey.isSupported as jest.Mock).mockResolvedValue(true);
      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'user-123', email: 'test@example.com' } },
      });
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: { access_token: 'token-123' } },
      });
      (Passkey.create as jest.Mock).mockResolvedValue({
        id: 'credential-id',
        response: {
          clientDataJSON: 'eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIn0',
          attestationObject: 'o2NmbXRkbm9uZQ',
        },
      });

      // Override to return error on POST
      (global.fetch as jest.Mock).mockImplementation((url: string, options?: RequestInit) => {
        if (url.includes('passkey-register') && options?.method === 'POST') {
          return mockFetchResponse({ error: 'Invalid attestation' }, 400);
        }
        return mockFetchResponse({
          options: {
            challenge: 'dGVzdC1jaGFsbGVuZ2U',
            rp: { name: 'Gatekeeper', id: 'gatekeeper.app' },
            user: { id: 'dXNlci0xMjM', name: 'test@example.com', displayName: 'Test User' },
            pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
            authenticatorSelection: { userVerification: 'required' },
            timeout: 60000,
          },
          challenge_key: 'challenge-key-123',
        });
      });

      const result = await registerPasskey('test@example.com');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Registration failed');
    });

    it('returns error when GET options fails', async () => {
      // Suppress console.error for this test
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      (Passkey.isSupported as jest.Mock).mockResolvedValue(true);
      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'user-123', email: 'test@example.com' } },
      });
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: { access_token: 'token-123' } },
      });

      // Mock GET options to fail
      (global.fetch as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('passkey-register')) {
          return mockFetchResponse('Server error', 500);
        }
        return mockFetchResponse({});
      });

      const result = await registerPasskey('test@example.com');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to get registration options');
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('calls correct API endpoints in order', async () => {
      const apiCalls: string[] = [];

      (global.fetch as jest.Mock).mockImplementation((url: string, options?: RequestInit) => {
        if (url.includes('passkey-register')) {
          if (options?.method === 'POST') {
            apiCalls.push('POST register');
            return mockFetchResponse({ success: true });
          }
          apiCalls.push('GET options');
          return mockFetchResponse({
            options: {
              challenge: 'dGVzdC1jaGFsbGVuZ2U',
              rp: { name: 'Gatekeeper', id: 'gatekeeper.app' },
              user: { id: 'dXNlci0xMjM', name: 'test@example.com', displayName: 'Test User' },
              pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
              authenticatorSelection: { userVerification: 'required' },
              timeout: 60000,
            },
            challenge_key: 'challenge-key-123',
          });
        }
        return mockFetchResponse({});
      });

      (Passkey.isSupported as jest.Mock).mockResolvedValue(true);
      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'user-123', email: 'test@example.com' } },
      });
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: { access_token: 'token-123' } },
      });
      (Passkey.create as jest.Mock).mockResolvedValue({
        id: 'credential-id',
        response: {
          clientDataJSON: 'eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIn0',
          attestationObject: 'o2NmbXRkbm9uZQ',
        },
      });

      await registerPasskey('test@example.com');

      expect(apiCalls).toEqual(['GET options', 'POST register']);
    });
  });

  describe('authenticateWithPasskey()', () => {
    it('returns error when no stored credential exists', async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);

      const result = await authenticateWithPasskey();

      expect(result.success).toBe(false);
      expect(result.error).toBe('No passkey registered on this device');
    });

    it('fetches challenge from correct endpoint with credential_id', async () => {
      let challengeUrl = '';

      (global.fetch as jest.Mock).mockImplementation((url: string) => {
        // Only capture the challenge URL (first fetch with credential_id)
        if (url.includes('passkey-auth') && url.includes('credential_id')) {
          challengeUrl = url;
          return mockFetchResponse({
            challenge: 'dGVzdC1jaGFsbGVuZ2U',
            challenge_key: 'key-123',
            rp_id: 'gatekeeper.app',
          });
        }
        if (url.includes('passkey-auth')) {
          return mockFetchResponse({ verified: true, auth_token: 'token' });
        }
        if (url.includes('mint-session')) {
          return mockFetchResponse({
            access_token: 'access-token',
            refresh_token: 'refresh-token',
          });
        }
        return mockFetchResponse({});
      });

      (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('stored-credential-id');
      (Passkey.get as jest.Mock).mockResolvedValue({
        id: 'stored-credential-id',
        response: {
          clientDataJSON: 'eyJ0eXBlIjoid2ViYXV0aG4uZ2V0In0',
          authenticatorData: 'dGVzdC1hdXRoLWRhdGE',
          signature: 'dGVzdC1zaWduYXR1cmU',
          userHandle: 'dGVzdC11c2VyLWhhbmRsZQ',
        },
      });
      (supabase.auth.setSession as jest.Mock).mockResolvedValue({ error: null });

      await authenticateWithPasskey();

      expect(challengeUrl).toContain('credential_id=stored-credential-id');
    });

    it('returns error when user cancels authentication', async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('stored-credential-id');
      (Passkey.get as jest.Mock).mockResolvedValue(null);

      const result = await authenticateWithPasskey();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Authentication cancelled');
    });

    it('calls mint-session after successful verification', async () => {
      let mintSessionCalled = false;

      (global.fetch as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('mint-session')) {
          mintSessionCalled = true;
          return mockFetchResponse({
            access_token: 'new-access-token',
            refresh_token: 'new-refresh-token',
          });
        }
        if (url.includes('passkey-auth') && url.includes('credential_id')) {
          return mockFetchResponse({
            challenge: 'dGVzdC1jaGFsbGVuZ2U',
            challenge_key: 'key-123',
            rp_id: 'gatekeeper.app',
          });
        }
        if (url.includes('passkey-auth')) {
          return mockFetchResponse({ verified: true, auth_token: 'token' });
        }
        return mockFetchResponse({});
      });

      (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('stored-credential-id');
      (Passkey.get as jest.Mock).mockResolvedValue({
        id: 'stored-credential-id',
        response: {
          clientDataJSON: 'eyJ0eXBlIjoid2ViYXV0aG4uZ2V0In0',
          authenticatorData: 'dGVzdC1hdXRoLWRhdGE',
          signature: 'dGVzdC1zaWduYXR1cmU',
          userHandle: 'dGVzdC11c2VyLWhhbmRsZQ',
        },
      });
      (supabase.auth.setSession as jest.Mock).mockResolvedValue({ error: null });

      await authenticateWithPasskey();

      expect(mintSessionCalled).toBe(true);
    });

    it('sets Supabase session on successful authentication', async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('stored-credential-id');
      (Passkey.get as jest.Mock).mockResolvedValue({
        id: 'stored-credential-id',
        response: {
          clientDataJSON: 'eyJ0eXBlIjoid2ViYXV0aG4uZ2V0In0',
          authenticatorData: 'dGVzdC1hdXRoLWRhdGE',
          signature: 'dGVzdC1zaWduYXR1cmU',
          userHandle: 'dGVzdC11c2VyLWhhbmRsZQ',
        },
      });
      (supabase.auth.setSession as jest.Mock).mockResolvedValue({ error: null });

      const result = await authenticateWithPasskey();

      expect(result.success).toBe(true);
      expect(supabase.auth.setSession).toHaveBeenCalledWith({
        access_token: expect.any(String),
        refresh_token: expect.any(String),
      });
    });

    it('returns error when verification fails', async () => {
      (global.fetch as jest.Mock).mockImplementation((url: string, options?: RequestInit) => {
        if (url.includes('passkey-auth') && options?.method === 'POST') {
          return mockFetchResponse({ error: 'Invalid signature' }, 400);
        }
        if (url.includes('passkey-auth')) {
          return mockFetchResponse({
            challenge: 'dGVzdC1jaGFsbGVuZ2U',
            challenge_key: 'key-123',
            rp_id: 'gatekeeper.app',
          });
        }
        return mockFetchResponse({});
      });

      (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('stored-credential-id');
      (Passkey.get as jest.Mock).mockResolvedValue({
        id: 'stored-credential-id',
        response: {
          clientDataJSON: 'eyJ0eXBlIjoid2ViYXV0aG4uZ2V0In0',
          authenticatorData: 'dGVzdC1hdXRoLWRhdGE',
          signature: 'dGVzdC1zaWduYXR1cmU',
          userHandle: 'dGVzdC11c2VyLWhhbmRsZQ',
        },
      });

      const result = await authenticateWithPasskey();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Verification failed');
    });

    it('returns error when GET challenge fails', async () => {
      (global.fetch as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('passkey-auth') && url.includes('credential_id')) {
          return mockFetchResponse('Server unavailable', 503);
        }
        return mockFetchResponse({});
      });

      (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('stored-credential-id');

      const result = await authenticateWithPasskey();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Challenge request failed');
    });

    it('returns error when setSession fails', async () => {
      (global.fetch as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('mint-session')) {
          return mockFetchResponse({
            access_token: 'new-access-token',
            refresh_token: 'new-refresh-token',
          });
        }
        if (url.includes('passkey-auth') && url.includes('credential_id')) {
          return mockFetchResponse({
            challenge: 'dGVzdC1jaGFsbGVuZ2U',
            challenge_key: 'key-123',
            rp_id: 'gatekeeper.app',
          });
        }
        if (url.includes('passkey-auth')) {
          return mockFetchResponse({ verified: true, auth_token: 'token' });
        }
        return mockFetchResponse({});
      });

      (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('stored-credential-id');
      (Passkey.get as jest.Mock).mockResolvedValue({
        id: 'stored-credential-id',
        response: {
          clientDataJSON: 'eyJ0eXBlIjoid2ViYXV0aG4uZ2V0In0',
          authenticatorData: 'dGVzdC1hdXRoLWRhdGE',
          signature: 'dGVzdC1zaWduYXR1cmU',
          userHandle: 'dGVzdC11c2VyLWhhbmRsZQ',
        },
      });

      // Make setSession return an error
      (supabase.auth.setSession as jest.Mock).mockResolvedValue({
        error: { message: 'Invalid token format' },
      });

      const result = await authenticateWithPasskey();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to set session');
    });

    it('returns error when session minting fails', async () => {
      (global.fetch as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('mint-session')) {
          return mockFetchResponse({ error: 'Token expired' }, 400);
        }
        if (url.includes('passkey-auth') && url.includes('credential_id')) {
          return mockFetchResponse({
            challenge: 'dGVzdC1jaGFsbGVuZ2U',
            challenge_key: 'key-123',
            rp_id: 'gatekeeper.app',
          });
        }
        if (url.includes('passkey-auth')) {
          return mockFetchResponse({ verified: true, auth_token: 'token' });
        }
        return mockFetchResponse({});
      });

      (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('stored-credential-id');
      (Passkey.get as jest.Mock).mockResolvedValue({
        id: 'stored-credential-id',
        response: {
          clientDataJSON: 'eyJ0eXBlIjoid2ViYXV0aG4uZ2V0In0',
          authenticatorData: 'dGVzdC1hdXRoLWRhdGE',
          signature: 'dGVzdC1zaWduYXR1cmU',
          userHandle: 'dGVzdC11c2VyLWhhbmRsZQ',
        },
      });

      const result = await authenticateWithPasskey();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Session minting failed');
    });
  });

  describe('hasStoredPasskey()', () => {
    it('returns true when credential exists in SecureStore', async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('existing-credential-id');

      const result = await hasStoredPasskey();

      expect(result).toBe(true);
      expect(SecureStore.getItemAsync).toHaveBeenCalledWith('gatekeeper_passkey_credential_id');
    });

    it('returns false when no credential in SecureStore', async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);

      const result = await hasStoredPasskey();

      expect(result).toBe(false);
    });

    it('returns false when credential is empty string', async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('');

      const result = await hasStoredPasskey();

      expect(result).toBe(false);
    });
  });

  describe('clearStoredPasskey()', () => {
    it('removes credential from SecureStore', async () => {
      await clearStoredPasskey();

      expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('gatekeeper_passkey_credential_id');
    });
  });
});
