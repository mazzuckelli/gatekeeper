import { http, HttpResponse } from 'msw';

const GATEKEEPER_URL = process.env.EXPO_PUBLIC_GATEKEEPER_URL || 'https://test.supabase.co';

// Mock data
const mockUser = {
  id: 'test-user-id-123',
  email: 'test@example.com',
  created_at: '2024-01-01T00:00:00Z',
};

const mockSession = {
  access_token: 'mock-access-token-xyz',
  refresh_token: 'mock-refresh-token-xyz',
  expires_in: 3600,
  token_type: 'bearer',
  user: mockUser,
};

const mockChallenge = 'dGVzdC1jaGFsbGVuZ2UtYmFzZTY0';
const mockChallengeKey = 'challenge-key-123';

export const handlers = [
  // Passkey Registration - GET options
  http.get(`${GATEKEEPER_URL}/functions/v1/passkey-register`, ({ request }) => {
    const url = new URL(request.url);
    const action = url.searchParams.get('action');

    if (action === 'options') {
      return HttpResponse.json({
        options: {
          challenge: mockChallenge,
          rp: {
            name: 'Gatekeeper',
            id: 'gatekeeper-nine.vercel.app',
          },
          user: {
            id: 'dXNlci1pZC1iYXNlNjQ',
            name: mockUser.email,
            displayName: mockUser.email,
          },
          pubKeyCredParams: [
            { type: 'public-key', alg: -7 },
            { type: 'public-key', alg: -257 },
          ],
          authenticatorSelection: {
            authenticatorAttachment: 'platform',
            userVerification: 'preferred',
            residentKey: 'preferred',
          },
          timeout: 60000,
          attestation: 'none',
        },
        challenge_key: mockChallengeKey,
      });
    }

    return HttpResponse.json({ error: 'Invalid action' }, { status: 400 });
  }),

  // Passkey Registration - POST
  http.post(`${GATEKEEPER_URL}/functions/v1/passkey-register`, async ({ request }) => {
    const body = await request.json() as any;

    if (!body.challenge_key || !body.response) {
      return HttpResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    return HttpResponse.json({
      success: true,
      credential_id: body.response.id,
    });
  }),

  // Passkey Registration - DELETE
  http.delete(`${GATEKEEPER_URL}/functions/v1/passkey-register`, () => {
    return HttpResponse.json({ success: true });
  }),

  // Passkey Authentication - GET challenge
  http.get(`${GATEKEEPER_URL}/functions/v1/passkey-auth`, ({ request }) => {
    const url = new URL(request.url);
    const credentialId = url.searchParams.get('credential_id');

    if (!credentialId) {
      return HttpResponse.json(
        { error: 'credential_id required' },
        { status: 400 }
      );
    }

    return HttpResponse.json({
      challenge: mockChallenge,
      challenge_key: mockChallengeKey,
      rp_id: 'gatekeeper-nine.vercel.app',
    });
  }),

  // Passkey Authentication - POST verify
  http.post(`${GATEKEEPER_URL}/functions/v1/passkey-auth`, async ({ request }) => {
    const body = await request.json() as any;

    if (!body.challenge_key || !body.response) {
      return HttpResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    return HttpResponse.json({
      verification_token: 'mock-verification-token',
      user_id: mockUser.id,
    });
  }),

  // Mint Session
  http.post(`${GATEKEEPER_URL}/functions/v1/mint-session`, async ({ request }) => {
    const body = await request.json() as any;

    if (!body.verification_token || !body.user_id) {
      return HttpResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    return HttpResponse.json({
      access_token: mockSession.access_token,
      refresh_token: mockSession.refresh_token,
    });
  }),

  // Issue Attestation
  http.post(`${GATEKEEPER_URL}/functions/v1/issue-attestation`, ({ request }) => {
    const authHeader = request.headers.get('Authorization');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return HttpResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    return HttpResponse.json({
      attestation: 'mock-attestation-token-base64',
      expires_in: 300,
    });
  }),

  // Supabase Auth - Sign In
  http.post(`${GATEKEEPER_URL}/auth/v1/token`, async ({ request }) => {
    const url = new URL(request.url);
    const grantType = url.searchParams.get('grant_type');

    if (grantType === 'password') {
      const body = await request.json() as any;

      if (body.email === 'test@example.com' && body.password === 'correctpassword') {
        return HttpResponse.json(mockSession);
      }

      return HttpResponse.json(
        { error: 'Invalid login credentials' },
        { status: 400 }
      );
    }

    if (grantType === 'refresh_token') {
      return HttpResponse.json(mockSession);
    }

    return HttpResponse.json(mockSession);
  }),

  // Supabase Auth - Sign Up
  http.post(`${GATEKEEPER_URL}/auth/v1/signup`, async ({ request }) => {
    const body = await request.json() as any;

    if (!body.email || !body.password) {
      return HttpResponse.json(
        { error: 'Email and password required' },
        { status: 400 }
      );
    }

    if (body.email === 'existing@example.com') {
      return HttpResponse.json(
        { error: 'User already registered' },
        { status: 400 }
      );
    }

    return HttpResponse.json({
      ...mockSession,
      user: { ...mockUser, email: body.email },
    });
  }),

  // Supabase Auth - Get User
  http.get(`${GATEKEEPER_URL}/auth/v1/user`, ({ request }) => {
    const authHeader = request.headers.get('Authorization');

    if (!authHeader) {
      return HttpResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    return HttpResponse.json(mockUser);
  }),

  // Supabase Auth - Sign Out
  http.post(`${GATEKEEPER_URL}/auth/v1/logout`, () => {
    return HttpResponse.json({});
  }),

  // Supabase Database - User Profiles
  http.get(`${GATEKEEPER_URL}/rest/v1/user_profiles`, ({ request }) => {
    const url = new URL(request.url);
    const userId = url.searchParams.get('id');

    return HttpResponse.json([
      {
        id: userId || mockUser.id,
        display_name: 'Test User',
        timezone: 'America/New_York',
        subscription_tier: 'free',
        updated_at: '2024-01-01T00:00:00Z',
      },
    ]);
  }),

  http.post(`${GATEKEEPER_URL}/rest/v1/user_profiles`, async ({ request }) => {
    const body = await request.json();
    return HttpResponse.json(body, { status: 201 });
  }),

  http.patch(`${GATEKEEPER_URL}/rest/v1/user_profiles`, async ({ request }) => {
    const body = await request.json();
    return HttpResponse.json(body);
  }),
];

// Error simulation handlers for testing error paths
export const errorHandlers = {
  networkError: http.get('*', () => {
    return HttpResponse.error();
  }),

  serverError: http.post(`${GATEKEEPER_URL}/functions/v1/passkey-register`, () => {
    return HttpResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }),

  unauthorized: http.get(`${GATEKEEPER_URL}/functions/v1/passkey-register`, () => {
    return HttpResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }),

  rateLimited: http.post(`${GATEKEEPER_URL}/functions/v1/passkey-auth`, () => {
    return HttpResponse.json(
      { error: 'Too many requests' },
      { status: 429 }
    );
  }),
};
