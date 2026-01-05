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
 * 4. Server verifies and returns user_id + tier
 *
 * ENDPOINTS:
 * - GET: Request authentication challenge
 * - POST: Verify signed assertion
 *
 * SECURITY:
 * - Dawg Tag receives user_id, computes ghost_id locally, discards user_id
 * - Gatekeeper never knows which app the user is accessing
 * - Gatekeeper never knows the resulting ghost_id
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// Challenge expiry time (5 minutes)
const CHALLENGE_EXPIRY_MS = 5 * 60 * 1000

// In-memory challenge store (would use Redis in production)
const challengeStore = new Map<string, { challenge: string; userId: string; expires: number }>()

/**
 * Generate a cryptographically secure challenge
 */
function generateChallenge(): string {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

/**
 * Clean up expired challenges
 */
function cleanupExpiredChallenges() {
  const now = Date.now()
  for (const [key, value] of challengeStore.entries()) {
    if (value.expires < now) {
      challengeStore.delete(key)
    }
  }
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  const origin = req.headers.get('Origin')
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  // Clean up expired challenges periodically
  cleanupExpiredChallenges()

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
    .select('user_id, public_key, counter')
    .eq('credential_id', credentialId)
    .eq('is_active', true)
    .single()

  if (credError || !credential) {
    // Don't reveal if credential exists or not
    return errorResponse('Authentication failed', 401, origin)
  }

  // Generate and store challenge
  const challenge = generateChallenge()
  const challengeKey = `${credentialId}:${Date.now()}`

  challengeStore.set(challengeKey, {
    challenge,
    userId: credential.user_id,
    expires: Date.now() + CHALLENGE_EXPIRY_MS,
  })

  // Get client IP for rate limiting
  const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'

  // Increment rate limit
  await supabase.rpc('increment_rate_limit', {
    p_identifier: `passkey:${clientIp}`,
    p_action: 'passkey_challenge',
  }).catch(() => {})

  return jsonResponse({
    challenge,
    challenge_key: challengeKey,
    timeout: CHALLENGE_EXPIRY_MS,
    rp_id: new URL(SUPABASE_URL).hostname,
  }, 200, origin)
}

/**
 * POST: Verify signed assertion
 * Body: { challenge_key, credential_id, authenticator_data, client_data_json, signature }
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

  const {
    challenge_key,
    credential_id,
    authenticator_data,
    client_data_json,
    signature,
  } = body

  if (!challenge_key || !credential_id || !authenticator_data || !client_data_json || !signature) {
    return errorResponse('Missing required fields', 400, origin)
  }

  // Retrieve and validate challenge
  const storedChallenge = challengeStore.get(challenge_key)
  if (!storedChallenge) {
    return errorResponse('Challenge expired or invalid', 401, origin)
  }

  // Remove challenge (one-time use)
  challengeStore.delete(challenge_key)

  // Check expiry
  if (storedChallenge.expires < Date.now()) {
    return errorResponse('Challenge expired', 401, origin)
  }

  // Look up credential
  const { data: credential, error: credError } = await supabase
    .from('user_passkeys')
    .select('id, user_id, public_key, counter')
    .eq('credential_id', credential_id)
    .eq('is_active', true)
    .single()

  if (credError || !credential) {
    return errorResponse('Authentication failed', 401, origin)
  }

  // Verify user matches
  if (credential.user_id !== storedChallenge.userId) {
    return errorResponse('Authentication failed', 401, origin)
  }

  // Verify the signature
  // Note: Full WebAuthn verification is complex - this is simplified
  // In production, use a proper WebAuthn library
  try {
    const isValid = await verifyWebAuthnSignature(
      credential.public_key,
      authenticator_data,
      client_data_json,
      signature,
      storedChallenge.challenge
    )

    if (!isValid) {
      // Log failed attempt
      await supabase.from('audit_logs').insert({
        user_id: credential.user_id,
        action: 'passkey_auth_failed',
        action_category: 'auth',
        metadata: { reason: 'invalid_signature' },
        success: false,
      })

      return errorResponse('Authentication failed', 401, origin)
    }
  } catch (verifyError) {
    console.error('[PASSKEY-AUTH] Verification error:', verifyError)
    return errorResponse('Authentication failed', 401, origin)
  }

  // Update counter (replay protection)
  const newCounter = parseAuthenticatorData(authenticator_data).counter
  if (newCounter <= credential.counter) {
    // Possible replay attack
    await supabase.from('audit_logs').insert({
      user_id: credential.user_id,
      action: 'passkey_replay_detected',
      action_category: 'security',
      metadata: { old_counter: credential.counter, new_counter: newCounter },
      success: false,
    })

    return errorResponse('Authentication failed', 401, origin)
  }

  // Update counter and last used
  await supabase
    .from('user_passkeys')
    .update({
      counter: newCounter,
      last_used_at: new Date().toISOString(),
    })
    .eq('id', credential.id)

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
    metadata: { tier, credential_id: credential_id.substring(0, 16) },
    success: true,
  })

  // Update last_seen_at
  await supabase
    .from('user_profiles')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('id', credential.user_id)

  // Return user_id and tier to Dawg Tag
  // CRITICAL: Dawg Tag must use this transiently and discard
  return jsonResponse({
    user_id: credential.user_id,
    tier: tier,
  }, 200, origin)
}

/**
 * Parse authenticator data to extract counter
 */
function parseAuthenticatorData(authDataB64: string): { counter: number } {
  const authData = Uint8Array.from(atob(authDataB64), c => c.charCodeAt(0))
  // Counter is bytes 33-36 (after rpIdHash[32] and flags[1])
  const counterBytes = authData.slice(33, 37)
  const counter = new DataView(counterBytes.buffer).getUint32(0, false) // big-endian
  return { counter }
}

/**
 * Verify WebAuthn signature
 * Note: This is a simplified version. Production should use a proper library.
 */
async function verifyWebAuthnSignature(
  publicKeyB64: string,
  authenticatorDataB64: string,
  clientDataJsonB64: string,
  signatureB64: string,
  expectedChallenge: string
): Promise<boolean> {
  // Decode inputs
  const publicKeyBytes = Uint8Array.from(atob(publicKeyB64), c => c.charCodeAt(0))
  const authenticatorData = Uint8Array.from(atob(authenticatorDataB64), c => c.charCodeAt(0))
  const clientDataJson = atob(clientDataJsonB64)
  const signature = Uint8Array.from(atob(signatureB64), c => c.charCodeAt(0))

  // Parse and verify client data
  const clientData = JSON.parse(clientDataJson)
  if (clientData.type !== 'webauthn.get') {
    return false
  }
  if (clientData.challenge !== expectedChallenge) {
    return false
  }

  // Hash client data JSON
  const clientDataHash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(clientDataJson)
  )

  // Concatenate authenticator data and client data hash
  const signedData = new Uint8Array(authenticatorData.length + 32)
  signedData.set(authenticatorData, 0)
  signedData.set(new Uint8Array(clientDataHash), authenticatorData.length)

  // Import public key and verify
  try {
    const key = await crypto.subtle.importKey(
      'spki',
      publicKeyBytes,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    )

    return await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      signature,
      signedData
    )
  } catch {
    return false
  }
}
