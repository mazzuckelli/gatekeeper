/**
 * Passkey Authentication Endpoint
 *
 * PURPOSE: Authenticate users via WebAuthn passkeys and return user_id to Dawg Tag.
 *
 * This is an alternative to email/password auth via auth-validate.
 * Both endpoints serve the same purpose: authenticate user, return user_id + tier.
 *
 * FLOW:
 * 1. Client requests challenge (GET with credential_id)
 * 2. Client signs challenge with passkey
 * 3. Client sends signed assertion (POST)
 * 4. Server verifies using @simplewebauthn/server and returns user_id + tier
 *
 * ENDPOINTS:
 * - GET: Request authentication challenge
 * - POST: Verify signed assertion
 *
 * SECURITY:
 * - Dawg Tag receives user_id, computes ghost_id locally, discards user_id
 * - Gatekeeper never knows which app the user is accessing
 * - Gatekeeper never knows the resulting ghost_id
 * - Full WebAuthn verification using battle-tested @simplewebauthn/server library
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { SignJWT, importJWK } from 'https://deno.land/x/jose@v5.2.0/index.ts'
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts'
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from 'jsr:@simplewebauthn/server'
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
} from 'jsr:@simplewebauthn/types'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('GATEKEEPER_SECRET_KEY')!

// Challenge expiry time (5 minutes)
const CHALLENGE_EXPIRY_MS = 5 * 60 * 1000

// Relying Party configuration
// IMPORTANT: This must match what the client uses during registration
// Mobile app uses 'gatekeeper-nine.vercel.app', web app uses window.location.hostname
const RP_ID = 'gatekeeper-nine.vercel.app'
const RP_NAME = 'Gatekeeper'

// Expected origins for WebAuthn
// - Web/iOS: https://gatekeeper-nine.vercel.app
// - Android: android:apk-key-hash:<base64url of SHA256 cert fingerprint>
// SHA256 fingerprint from assetlinks.json: 52:88:BF:97:26:03:DA:44:20:87:C4:3E:84:F1:B7:8F:28:A3:D0:09:F9:9F:D7:BC:C8:A9:F1:6D:D7:3C:CD:F9
const EXPECTED_ORIGINS = [
  'https://gatekeeper-nine.vercel.app',
  'android:apk-key-hash:Uoi_lyYD2kQgh8Q-hPG3jyij0An5n9e8yKnxbdc8zfk',
]

/**
 * Decode base64url to Uint8Array
 * Handles both base64url (from WebAuthn) and standard base64
 */
function base64urlToBytes(base64url: string): Uint8Array {
  // Convert base64url to standard base64
  let base64 = base64url
    .replace(/-/g, '+')
    .replace(/_/g, '/')

  // Add padding if needed
  while (base64.length % 4 !== 0) {
    base64 += '='
  }

  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/**
 * Encode Uint8Array to base64url string
 */
function bytesToBase64url(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

/**
 * Clean up expired challenges from database
 */
async function cleanupExpiredChallenges(supabase: ReturnType<typeof createClient>) {
  try {
    await supabase.from('passkey_challenges').delete().lt('expires_at', new Date().toISOString())
  } catch {
    // Ignore cleanup errors
  }
}

Deno.serve(async (req) => {
  console.log('[PASSKEY-AUTH] Request:', req.method, req.url)

  // Handle CORS preflight
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  const origin = req.headers.get('Origin')

  // Debug: Check if secrets are loaded
  console.log('[PASSKEY-AUTH] SUPABASE_URL:', SUPABASE_URL ? 'set' : 'MISSING')
  console.log('[PASSKEY-AUTH] GATEKEEPER_SECRET_KEY:', SUPABASE_SERVICE_KEY ? 'set' : 'MISSING')

  if (!SUPABASE_SERVICE_KEY) {
    console.error('[PASSKEY-AUTH] GATEKEEPER_SECRET_KEY is not set!')
    return errorResponse('Server configuration error', 500, origin)
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  // Clean up expired challenges periodically
  await cleanupExpiredChallenges(supabase)

  try {
    if (req.method === 'GET') {
      // Request challenge for authentication
      return await handleGetChallenge(supabase, req, origin)
    } else if (req.method === 'POST') {
      // Verify signed assertion
      return await handleVerifyAssertion(supabase, req, origin)
    } else {
      return errorResponse('Method not allowed', 405, origin)
    }
  } catch (error) {
    console.error('[PASSKEY-AUTH] Error:', error)
    return errorResponse('Internal server error', 500, origin)
  }
})

/**
 * GET: Request authentication challenge
 * Query params: credential_id (base64url encoded)
 */
async function handleGetChallenge(
  supabase: ReturnType<typeof createClient>,
  req: Request,
  origin: string | null
) {
  const url = new URL(req.url)
  const credentialId = url.searchParams.get('credential_id')

  if (!credentialId) {
    return errorResponse('credential_id is required', 400, origin)
  }

  // Look up the credential to get the user
  const { data: credential, error: credError } = await supabase
    .from('user_passkeys')
    .select('user_id, public_key, counter, transports')
    .eq('credential_id', credentialId)
    .eq('is_active', true)
    .single()

  if (credError || !credential) {
    // Don't reveal if credential exists or not
    return errorResponse('Authentication failed', 401, origin)
  }

  // Generate authentication options using @simplewebauthn/server
  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: 'preferred',
    timeout: CHALLENGE_EXPIRY_MS,
    allowCredentials: [{
      id: credentialId,
      transports: (credential.transports || ['internal', 'hybrid']) as AuthenticatorTransportFuture[],
    }],
  })

  // Store challenge in database for verification
  const challengeKey = `${credentialId}:${Date.now()}`
  const expiresAt = new Date(Date.now() + CHALLENGE_EXPIRY_MS).toISOString()

  const { error: insertError } = await supabase
    .from('passkey_challenges')
    .insert({
      challenge_key: challengeKey,
      challenge: options.challenge,
      user_id: credential.user_id,
      expires_at: expiresAt,
    })

  if (insertError) {
    console.error('[PASSKEY-AUTH] Failed to store challenge:', insertError)
    return errorResponse('Failed to generate challenge', 500, origin)
  }

  // Get client IP for rate limiting (optional, don't fail if rate limit fails)
  try {
    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
    await supabase.rpc('increment_rate_limit', {
      p_identifier: `passkey:${clientIp}`,
      p_action: 'passkey_challenge',
    })
  } catch {
    // Ignore rate limit errors
  }

  return jsonResponse({
    challenge: options.challenge,
    challenge_key: challengeKey,
    timeout: CHALLENGE_EXPIRY_MS,
    rp_id: RP_ID,
    // Include full options for clients that want them
    options: options,
  }, 200, origin)
}

/**
 * POST: Verify signed assertion
 * Body: { challenge_key, credential_id, authenticator_data, client_data_json, signature, user_handle? }
 * OR: { challenge_key, response } where response is AuthenticationResponseJSON
 */
async function handleVerifyAssertion(
  supabase: ReturnType<typeof createClient>,
  req: Request,
  origin: string | null
) {
  let body
  try {
    body = await req.json()
  } catch {
    return errorResponse('Invalid JSON body', 400, origin)
  }

  const { challenge_key } = body

  if (!challenge_key) {
    return errorResponse('Missing challenge_key', 400, origin)
  }

  // Retrieve challenge from database
  console.log('[PASSKEY-AUTH] Looking up challenge_key:', challenge_key)
  const { data: storedChallenge, error: fetchError } = await supabase
    .from('passkey_challenges')
    .select('challenge, user_id, expires_at')
    .eq('challenge_key', challenge_key)
    .single()

  if (fetchError || !storedChallenge) {
    console.error('[PASSKEY-AUTH] Challenge not found:', challenge_key, fetchError)
    return errorResponse('Challenge expired or invalid', 401, origin)
  }
  console.log('[PASSKEY-AUTH] Challenge found for user:', storedChallenge.user_id)

  // Remove challenge immediately (one-time use)
  await supabase.from('passkey_challenges').delete().eq('challenge_key', challenge_key)

  // Check expiry
  if (new Date(storedChallenge.expires_at) < new Date()) {
    return errorResponse('Challenge expired', 401, origin)
  }

  // Build AuthenticationResponseJSON from body
  // Support both new format (response object) and legacy format (flat fields)
  let authResponse: AuthenticationResponseJSON
  let credentialId: string

  if (body.response) {
    // New format: { challenge_key, response: AuthenticationResponseJSON }
    authResponse = body.response
    credentialId = authResponse.id
  } else {
    // Legacy format: { challenge_key, credential_id, authenticator_data, client_data_json, signature }
    const { credential_id, authenticator_data, client_data_json, signature, user_handle } = body

    if (!credential_id || !authenticator_data || !client_data_json || !signature) {
      return errorResponse('Missing required fields', 400, origin)
    }

    credentialId = credential_id

    // Convert legacy base64 fields to base64url for AuthenticationResponseJSON
    authResponse = {
      id: credential_id,
      rawId: credential_id,
      type: 'public-key',
      response: {
        authenticatorData: authenticator_data
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=/g, ''),
        clientDataJSON: client_data_json
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=/g, ''),
        signature: signature
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=/g, ''),
        userHandle: user_handle || undefined,
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    }
  }

  // Look up credential
  console.log('[PASSKEY-AUTH] Looking up credential_id:', credentialId)
  const { data: credential, error: credError } = await supabase
    .from('user_passkeys')
    .select('id, user_id, public_key, counter, transports')
    .eq('credential_id', credentialId)
    .eq('is_active', true)
    .single()

  if (credError || !credential) {
    console.error('[PASSKEY-AUTH] Credential not found:', credentialId, credError)
    return errorResponse('Authentication failed - credential not found', 401, origin)
  }
  console.log('[PASSKEY-AUTH] Credential found, user_id:', credential.user_id)

  // Verify user matches
  if (credential.user_id !== storedChallenge.user_id) {
    console.error('[PASSKEY-AUTH] User mismatch:', credential.user_id, 'vs', storedChallenge.user_id)
    return errorResponse('Authentication failed - user mismatch', 401, origin)
  }

  // Verify the assertion using @simplewebauthn/server
  let verification
  try {
    // Decode public key from base64 to Uint8Array
    const publicKeyBytes = base64urlToBytes(
      credential.public_key
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '')
    )

    verification = await verifyAuthenticationResponse({
      response: authResponse,
      expectedChallenge: storedChallenge.challenge,
      expectedOrigin: EXPECTED_ORIGINS,
      expectedRPID: RP_ID,
      credential: {
        id: credentialId,
        publicKey: publicKeyBytes,
        counter: credential.counter || 0,
        transports: (credential.transports || ['internal']) as AuthenticatorTransportFuture[],
      },
    })

    if (!verification.verified) {
      console.error('[PASSKEY-AUTH] Verification failed')
      // Log failed attempt
      await supabase.from('audit_logs').insert({
        user_id: credential.user_id,
        action: 'passkey_auth_failed',
        action_category: 'auth',
        metadata: { reason: 'verification_failed' },
        success: false,
      })

      return errorResponse('Authentication failed - verification failed', 401, origin)
    }
    console.log('[PASSKEY-AUTH] Signature verified successfully using @simplewebauthn/server')
  } catch (verifyError) {
    console.error('[PASSKEY-AUTH] Verification exception:', verifyError)
    // Log failed attempt
    await supabase.from('audit_logs').insert({
      user_id: credential.user_id,
      action: 'passkey_auth_failed',
      action_category: 'auth',
      metadata: { reason: 'verification_exception', error: String(verifyError) },
      success: false,
    })

    return errorResponse('Authentication failed - verification error', 401, origin)
  }

  // Update counter (replay protection handled by simplewebauthn)
  const newCounter = verification.authenticationInfo.newCounter
  console.log('[PASSKEY-AUTH] Counter update: old=', credential.counter, 'new=', newCounter)

  // Update counter and last used
  await supabase
    .from('user_passkeys')
    .update({
      counter: newCounter,
      last_used_at: new Date().toISOString(),
    })
    .eq('id', credential.id)

  // ------------------------------------------------------------------
  // Generate verification_token for mint-session
  // ------------------------------------------------------------------
  const attestationKeyJson = Deno.env.get('ATTESTATION_SIGNING_KEY')
  if (!attestationKeyJson) {
    console.error('[PASSKEY-AUTH] ATTESTATION_SIGNING_KEY not configured')
    return errorResponse('Server configuration error', 500, origin)
  }

  let verificationToken: string
  let attestation: string
  try {
    const attestationKey = JSON.parse(attestationKeyJson)
    const privateKey = await importJWK(attestationKey, 'ES256')
    const now = Math.floor(Date.now() / 1000)

    // Verification token for mint-session (30 seconds, single use)
    verificationToken = await new SignJWT({
      type: 'passkey_verified',
    })
      .setProtectedHeader({ alg: 'ES256', typ: 'JWT' })
      .setIssuer('gatekeeper-passkey')
      .setAudience('mint-session')
      .setSubject(credential.user_id)
      .setIssuedAt(now)
      .setExpirationTime(now + 30)
      .setJti(crypto.randomUUID())
      .sign(privateKey)

    // Attestation for Dawg Tag flow (5 minutes)
    attestation = await new SignJWT({
      type: 'attestation',
      valid: true,
      auth_level: 'biometric',
    })
      .setProtectedHeader({ alg: 'ES256', typ: 'JWT' })
      .setIssuer('gatekeeper')
      .setAudience('ghost-auth')
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .setJti(crypto.randomUUID())
      .sign(privateKey)

    console.log('[PASSKEY-AUTH] Generated verification token and attestation')
  } catch (err) {
    console.error('[PASSKEY-AUTH] Failed to generate tokens:', err)
    return errorResponse('Failed to generate tokens', 500, origin)
  }

  // Get user's subscription tier
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('subscription_tier, subscription_status')
    .eq('id', credential.user_id)
    .single()

  const tier = (profile?.subscription_status === 'active')
    ? (profile?.subscription_tier || 'free')
    : 'free'

  // Log successful auth
  const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null
  await supabase.from('audit_logs').insert({
    user_id: credential.user_id,
    action: 'passkey_authenticated',
    action_category: 'auth',
    ip_address: clientIp,
    metadata: { tier, credential_id: credentialId.substring(0, 16) },
    success: true,
  })

  // Update last_seen_at
  await supabase
    .from('user_profiles')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('id', credential.user_id)

  // Return tokens and user info
  // - verification_token: for mint-session to create Supabase session
  // - attestation: for Dawg Tag flow (no user_id)
  // - user_id: for Gatekeeper mobile app to call mint-session
  return jsonResponse({
    user_id: credential.user_id,
    tier: tier,
    verification_token: verificationToken,
    attestation: attestation,
  }, 200, origin)
}

