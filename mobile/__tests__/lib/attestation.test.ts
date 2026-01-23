import {
  issueAttestation,
  buildCallbackUrl,
  buildCancelledCallbackUrl,
} from '../../src/lib/attestation';
import { Session } from '@supabase/supabase-js';

// Mock supabase
jest.mock('../../src/lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: jest.fn(),
    },
  },
}));

import { supabase } from '../../src/lib/supabase';

describe('attestation.ts', () => {
  const mockSession: Session = {
    access_token: 'test-access-token',
    refresh_token: 'test-refresh-token',
    expires_in: 3600,
    expires_at: Date.now() / 1000 + 3600,
    token_type: 'bearer',
    user: {
      id: 'user-123',
      email: 'test@example.com',
      aud: 'authenticated',
      created_at: '2024-01-01T00:00:00Z',
      app_metadata: {},
      user_metadata: {},
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('issueAttestation()', () => {
    it('returns attestation and expires_in on success', async () => {
      (supabase.functions.invoke as jest.Mock).mockResolvedValue({
        data: {
          attestation: 'signed-jwt-attestation',
          expires_in: 300,
        },
        error: null,
      });

      const result = await issueAttestation(mockSession);

      expect(result.attestation).toBe('signed-jwt-attestation');
      expect(result.expires_in).toBe(300);
    });

    it('passes Authorization header with session token', async () => {
      (supabase.functions.invoke as jest.Mock).mockResolvedValue({
        data: { attestation: 'test', expires_in: 300 },
        error: null,
      });

      await issueAttestation(mockSession);

      expect(supabase.functions.invoke).toHaveBeenCalledWith('issue-attestation', {
        headers: {
          Authorization: 'Bearer test-access-token',
        },
      });
    });

    it('throws error when function invocation fails', async () => {
      (supabase.functions.invoke as jest.Mock).mockResolvedValue({
        data: null,
        error: { message: 'Unauthorized' },
      });

      await expect(issueAttestation(mockSession)).rejects.toThrow('Attestation failed: Unauthorized');
    });

    it('throws error when no attestation returned', async () => {
      (supabase.functions.invoke as jest.Mock).mockResolvedValue({
        data: { expires_in: 300 },
        error: null,
      });

      await expect(issueAttestation(mockSession)).rejects.toThrow('No attestation returned from server');
    });

    it('throws error when data is null', async () => {
      (supabase.functions.invoke as jest.Mock).mockResolvedValue({
        data: null,
        error: null,
      });

      await expect(issueAttestation(mockSession)).rejects.toThrow('No attestation returned from server');
    });

    it('throws error when attestation is empty string', async () => {
      (supabase.functions.invoke as jest.Mock).mockResolvedValue({
        data: { attestation: '', expires_in: 300 },
        error: null,
      });

      await expect(issueAttestation(mockSession)).rejects.toThrow('No attestation returned from server');
    });
  });

  describe('buildCallbackUrl()', () => {
    it('appends attestation and status to callback URL', () => {
      const result = buildCallbackUrl('dawgtag://callback', 'jwt-token-123');

      expect(result).toBe('dawgtag://callback?attestation=jwt-token-123&status=success');
    });

    it('preserves existing query parameters', () => {
      const result = buildCallbackUrl('dawgtag://callback?existing=param', 'jwt-token');

      expect(result).toContain('existing=param');
      expect(result).toContain('attestation=jwt-token');
      expect(result).toContain('status=success');
    });

    it('handles HTTPS callback URLs', () => {
      const result = buildCallbackUrl('https://app.example.com/auth/callback', 'jwt-token');

      expect(result).toBe('https://app.example.com/auth/callback?attestation=jwt-token&status=success');
    });

    it('URL-encodes special characters in attestation', () => {
      const attestationWithSpecialChars = 'token+with/special=chars';
      const result = buildCallbackUrl('dawgtag://callback', attestationWithSpecialChars);

      // URL encoding converts + to %2B, / to %2F, = to %3D
      expect(result).toContain('attestation=token%2Bwith%2Fspecial%3Dchars');
    });

    it('handles callback URL with path', () => {
      const result = buildCallbackUrl('dawgtag://auth/success/complete', 'jwt-token');

      expect(result).toBe('dawgtag://auth/success/complete?attestation=jwt-token&status=success');
    });
  });

  describe('buildCancelledCallbackUrl()', () => {
    it('appends cancelled status to callback URL', () => {
      const result = buildCancelledCallbackUrl('dawgtag://callback');

      expect(result).toBe('dawgtag://callback?status=cancelled');
    });

    it('preserves existing query parameters', () => {
      const result = buildCancelledCallbackUrl('dawgtag://callback?existing=param');

      expect(result).toContain('existing=param');
      expect(result).toContain('status=cancelled');
    });

    it('does not include attestation parameter', () => {
      const result = buildCancelledCallbackUrl('dawgtag://callback');

      expect(result).not.toContain('attestation');
    });

    it('handles HTTPS callback URLs', () => {
      const result = buildCancelledCallbackUrl('https://app.example.com/auth/callback');

      expect(result).toBe('https://app.example.com/auth/callback?status=cancelled');
    });
  });
});
