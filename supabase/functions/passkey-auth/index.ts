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
import { SignJWT, importJWK } from 'https://deno.land/x/jose@v5.2.0/index.ts'
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('GATEKEEPER_SECRET_KEY')!

// Challenge expiry time (5 minutes)
const CHALLENGE_EXPIRY_MS = 5 * 60 * 1000

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
    .select('user_id, public_key, counter')
    .eq('credential_id', credentialId)
    .eq('is_active', true)
    .single()

  if (credError || !credential) {
    // Don't reveal if credential exists or not
    return errorResponse('Authentication failed', 401, origin)
  }

  // Generate and store challenge in database
  const challenge = generateChallenge()
  const challengeKey = `${credentialId}:${Date.now()}`
  const expiresAt = new Date(Date.now() + CHALLENGE_EXPIRY_MS).toISOString()

  const { error: insertError } = await supabase
    .from('passkey_challenges')
    .insert({
      challenge_key: challengeKey,
      challenge: challenge,
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

  // Look up credential
  console.log('[PASSKEY-AUTH] Looking up credential_id:', credential_id)
  const { data: credential, error: credError } = await supabase
    .from('user_passkeys')
    .select('id, user_id, public_key, counter')
    .eq('credential_id', credential_id)
    .eq('is_active', true)
    .single()

  if (credError || !credential) {
    console.error('[PASSKEY-AUTH] Credential not found:', credential_id, credError)
    return errorResponse('Authentication failed - credential not found', 401, origin)
  }
  console.log('[PASSKEY-AUTH] Credential found, user_id:', credential.user_id)

  // Verify user matches
  if (credential.user_id !== storedChallenge.user_id) {
    console.error('[PASSKEY-AUTH] User mismatch:', credential.user_id, 'vs', storedChallenge.user_id)
    return errorResponse('Authentication failed - user mismatch', 401, origin)
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
      console.error('[PASSKEY-AUTH] Signature verification failed')
      // Log failed attempt
      await supabase.from('audit_logs').insert({
        user_id: credential.user_id,
        action: 'passkey_auth_failed',
        action_category: 'auth',
        metadata: { reason: 'invalid_signature' },
        success: false,
      })

      return errorResponse('Authentication failed - invalid signature', 401, origin)
    }
    console.log('[PASSKEY-AUTH] Signature verified successfully')
  } catch (verifyError) {
    console.error('[PASSKEY-AUTH] Signature verification exception:', verifyError)
    return errorResponse('Authentication failed - verification error', 401, origin)
  }

  // Update counter (replay protection)
  const newCounter = parseAuthenticatorData(authenticator_data).counter
  console.log('[PASSKEY-AUTH] Counter check: new=', newCounter, 'old=', credential.counter)

  // Counter check: newCounter must be > oldCounter
  // Exception: if both are 0, allow it (first auth after registration)
  // Some authenticators don't increment counter, so we also allow equal non-zero if it's close
  const isReplay = newCounter < credential.counter ||
    (newCounter === credential.counter && credential.counter > 0)

  if (isReplay) {
    // Possible replay attack
    console.error('[PASSKEY-AUTH] Replay detected! newCounter <= oldCounter')
    await supabase.from('audit_logs').insert({
      user_id: credential.user_id,
      action: 'passkey_replay_detected',
      action_category: 'security',
      metadata: { old_counter: credential.counter, new_counter: newCounter },
      success: false,
    })

    return errorResponse('Authentication failed - replay detected', 401, origin)
  }

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
    metadata: { tier, credential_id: credential_id.substring(0, 16) },
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

/**
 * Parse authenticator data to extract counter
 */
function parseAuthenticatorData(authDataB64: string): { counter: number } {
  const authData = base64urlToBytes(authDataB64)
  // Counter is bytes 33-36 (after rpIdHash[32] and flags[1])
  const counterBytes = authData.slice(33, 37)
  const counter = new DataView(counterBytes.buffer).getUint32(0, false) // big-endian
  return { counter }
}

/**
 * Convert DER-encoded ECDSA signature to raw format (r || s)
 * WebAuthn uses DER encoding but WebCrypto expects raw format
 */
function derToRaw(derSignature: Uint8Array): Uint8Array {
  // DER format: 0x30 [total-length] 0x02 [r-length] [r] 0x02 [s-length] [s]
  if (derSignature[0] !== 0x30) {
    // Not DER encoded, assume already raw
    return derSignature
  }

  let offset = 2 // Skip 0x30 and total length

  // Parse r
  if (derSignature[offset] !== 0x02) throw new Error('Invalid DER signature')
  offset++
  const rLength = derSignature[offset]
  offset++
  let r = derSignature.slice(offset, offset + rLength)
  offset += rLength

  // Parse s
  if (derSignature[offset] !== 0x02) throw new Error('Invalid DER signature')
  offset++
  const sLength = derSignature[offset]
  offset++
  let s = derSignature.slice(offset, offset + sLength)

  // Remove leading zeros if present (DER pads with 0x00 for positive numbers)
  if (r.length === 33 && r[0] === 0) r = r.slice(1)
  if (s.length === 33 && s[0] === 0) s = s.slice(1)

  // Pad to 32 bytes if needed
  if (r.length < 32) {
    const padded = new Uint8Array(32)
    padded.set(r, 32 - r.length)
    r = padded
  }
  if (s.length < 32) {
    const padded = new Uint8Array(32)
    padded.set(s, 32 - s.length)
    s = padded
  }

  // Concatenate r and s (64 bytes total for P-256)
  const raw = new Uint8Array(64)
  raw.set(r, 0)
  raw.set(s, 32)
  return raw
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
  // Decode inputs (handle base64url from WebAuthn)
  console.log('[PASSKEY-AUTH] Verifying signature...')
  console.log('[PASSKEY-AUTH] Public key (first 50 chars):', publicKeyB64.substring(0, 50))

  const publicKeyBytes = base64urlToBytes(publicKeyB64)
  const authenticatorData = base64urlToBytes(authenticatorDataB64)
  const clientDataJsonBytes = base64urlToBytes(clientDataJsonB64)
  const clientDataJson = new TextDecoder().decode(clientDataJsonBytes)
  const signatureDer = base64urlToBytes(signatureB64)

  // Convert DER signature to raw format for WebCrypto
  const signature = derToRaw(signatureDer)
  console.log('[PASSKEY-AUTH] Signature converted from DER, length:', signature.length)

  // Parse and verify client data
  const clientData = JSON.parse(clientDataJson)
  console.log('[PASSKEY-AUTH] Client data type:', clientData.type)
  console.log('[PASSKEY-AUTH] Client data challenge:', clientData.challenge)
  console.log('[PASSKEY-AUTH] Expected challenge:', expectedChallenge)

  if (clientData.type !== 'webauthn.get') {
    console.error('[PASSKEY-AUTH] Wrong client data type')
    return false
  }
  if (clientData.challenge !== expectedChallenge) {
    console.error('[PASSKEY-AUTH] Challenge mismatch')
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
