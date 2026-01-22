import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { decode as decodeCbor } from 'https://esm.sh/cbor-x@1.5.4'
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts'
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
} from 'jsr:@simplewebauthn/server'
import type {
  RegistrationResponseJSON,
  AuthenticatorTransportFuture,
} from 'jsr:@simplewebauthn/types'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const GATEKEEPER_PUBLISHABLE_KEY = Deno.env.get('GATEKEEPER_PUBLISHABLE_KEY')!
const GATEKEEPER_SECRET_KEY = Deno.env.get('GATEKEEPER_SECRET_KEY')!

// Relying Party configuration
// IMPORTANT: Must match what mobile app uses in passkey.ts
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

// Challenge expiry time (5 minutes)
const CHALLENGE_EXPIRY_MS = 5 * 60 * 1000

/**
 * Decode base64url to Uint8Array
 */
function base64urlToBytes(base64url: string): Uint8Array {
  let base64 = base64url
    .replace(/-/g, '+')
    .replace(/_/g, '/')
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
 * Extract public key from attestation object
 * The attestation object is CBOR encoded and contains authData which has the public key
 */
function extractPublicKeyFromAttestation(attestationObjectB64: string): string {
  const attestationObject = base64urlToBytes(attestationObjectB64)
  const decoded = decodeCbor(attestationObject) as { authData: Uint8Array }

  const authData = decoded.authData
  // authData structure:
  // - rpIdHash: 32 bytes
  // - flags: 1 byte
  // - signCount: 4 bytes
  // - attestedCredentialData (if AT flag set):
  //   - aaguid: 16 bytes
  //   - credentialIdLength: 2 bytes (big endian)
  //   - credentialId: credentialIdLength bytes
  //   - credentialPublicKey: remaining bytes (COSE encoded)

  const flags = authData[32]
  const hasAttestedCredentialData = (flags & 0x40) !== 0

  if (!hasAttestedCredentialData) {
    throw new Error('No attested credential data in authenticator data')
  }

  // Skip to credentialIdLength (32 + 1 + 4 + 16 = 53)
  const credIdLenOffset = 53
  const credentialIdLength = (authData[credIdLenOffset] << 8) | authData[credIdLenOffset + 1]

  // Public key starts after credential ID
  const publicKeyOffset = credIdLenOffset + 2 + credentialIdLength
  const publicKeyBytes = authData.slice(publicKeyOffset)

  // The public key is COSE encoded - we need to convert it to SPKI format for WebCrypto
  // Note: cbor-x returns a plain object, not a Map. Negative keys become string properties.
  const coseKey = decodeCbor(publicKeyBytes) as Record<string, unknown>

  // COSE key for EC2 (P-256):
  // 1 (kty) = 2 (EC2)
  // 3 (alg) = -7 (ES256)
  // -1 (crv) = 1 (P-256)
  // -2 (x) = x coordinate (32 bytes)
  // -3 (y) = y coordinate (32 bytes)

  const x = coseKey['-2'] as Uint8Array
  const y = coseKey['-3'] as Uint8Array

  if (!x || !y) {
    throw new Error('Missing x or y coordinate in COSE key')
  }

  // Build SPKI format for P-256 public key
  // SPKI = SEQUENCE { algorithm SEQUENCE { oid, namedCurve }, publicKey BIT STRING }
  const spkiPrefix = new Uint8Array([
    0x30, 0x59, // SEQUENCE, 89 bytes
    0x30, 0x13, // SEQUENCE, 19 bytes (algorithm)
    0x06, 0x07, // OID, 7 bytes
    0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, // 1.2.840.10045.2.1 (ecPublicKey)
    0x06, 0x08, // OID, 8 bytes
    0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, // 1.2.840.10045.3.1.7 (prime256v1/P-256)
    0x03, 0x42, // BIT STRING, 66 bytes
    0x00, // no unused bits
    0x04, // uncompressed point
  ])

  const spki = new Uint8Array(spkiPrefix.length + 64)
  spki.set(spkiPrefix, 0)
  spki.set(x, spkiPrefix.length)
  spki.set(y, spkiPrefix.length + 32)

  // Return as base64
  return btoa(String.fromCharCode(...spki))
}

Deno.serve(async (req) => {
  console.log(`[PASSKEY-REGISTER] Incoming ${req.method} request`)

  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  const origin = req.headers.get('Origin')

  try {
    const authHeader = req.headers.get('Authorization')
    console.log('[PASSKEY-REGISTER] Authorization header:', authHeader ? authHeader.substring(0, 30) + '...' : 'MISSING')

    if (!authHeader) {
      console.error('[PASSKEY-REGISTER] Missing Authorization header')
      return errorResponse('Missing Auth Header', 401, origin)
    }

    // 1. Verify the User Session
    const supabaseUser = createClient(SUPABASE_URL, GATEKEEPER_PUBLISHABLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error: authError } = await supabaseUser.auth.getUser()

    if (authError || !user) {
      console.error('[PASSKEY-REGISTER] Auth failed:', authError?.message)
      return errorResponse('Unauthorized', 401, origin)
    }
    console.log(`[PASSKEY-REGISTER] Authenticated user: ${user.id}`)

    // 2. Initialize Admin Client for DB
    const supabaseAdmin = createClient(SUPABASE_URL, GATEKEEPER_SECRET_KEY)

    // GET: List passkeys or get registration options
    if (req.method === 'GET') {
      const url = new URL(req.url)
      const action = url.searchParams.get('action')

      if (action === 'options') {
        // Generate registration options using @simplewebauthn/server
        console.log('[PASSKEY-REGISTER] Generating registration options...')

        // Get existing credentials to exclude
        const { data: existingCredentials } = await supabaseAdmin
          .from('user_passkeys')
          .select('credential_id')
          .eq('user_id', user.id)
          .eq('is_active', true)

        const options = await generateRegistrationOptions({
          rpName: RP_NAME,
          rpID: RP_ID,
          userName: user.email || user.id,
          userDisplayName: user.email?.split('@')[0] || 'User',
          userID: new TextEncoder().encode(user.id),
          attestationType: 'none',
          authenticatorSelection: {
            userVerification: 'preferred',
            residentKey: 'preferred',
          },
          timeout: CHALLENGE_EXPIRY_MS,
          excludeCredentials: existingCredentials?.map(c => ({
            id: c.credential_id,
          })) || [],
        })

        // Store challenge for verification
        const { error: insertError } = await supabaseAdmin
          .from('passkey_challenges')
          .insert({
            challenge_key: `reg:${user.id}:${Date.now()}`,
            challenge: options.challenge,
            user_id: user.id,
            expires_at: new Date(Date.now() + CHALLENGE_EXPIRY_MS).toISOString(),
          })

        if (insertError) {
          console.error('[PASSKEY-REGISTER] Failed to store challenge:', insertError)
          return errorResponse('Failed to generate options', 500, origin)
        }

        return jsonResponse({
          options,
          challenge_key: `reg:${user.id}:${Date.now()}`,
        }, 200, origin)
      }

      // Default: List passkeys
      console.log('[PASSKEY-REGISTER] Fetching keys...')
      const { data, error } = await supabaseAdmin
        .from('user_passkeys')
        .select('id, credential_id, device_name, authenticator_type, created_at, last_used_at, is_active')
        .eq('user_id', user.id)
        .eq('is_active', true)

      if (error) {
        console.error('[PASSKEY-REGISTER] Database error (List):', error.message)
        return errorResponse(`DB Error: ${error.message}`, 500, origin)
      }
      return jsonResponse({ passkeys: data }, 200, origin)
    }

    // POST: Register new passkey
    if (req.method === 'POST') {
      const body = await req.json()
      console.log('[PASSKEY-REGISTER] Registering new key...')

      // Support both new format (response object) and legacy format (flat fields)
      if (body.response && body.challenge_key) {
        // New format: Full WebAuthn verification using @simplewebauthn/server
        console.log('[PASSKEY-REGISTER] Using @simplewebauthn/server verification')

        // Retrieve stored challenge
        const { data: storedChallenge, error: fetchError } = await supabaseAdmin
          .from('passkey_challenges')
          .select('challenge, user_id, expires_at')
          .eq('challenge_key', body.challenge_key)
          .single()

        if (fetchError || !storedChallenge) {
          console.error('[PASSKEY-REGISTER] Challenge not found')
          return errorResponse('Challenge expired or invalid', 401, origin)
        }

        // Delete challenge (one-time use)
        await supabaseAdmin
          .from('passkey_challenges')
          .delete()
          .eq('challenge_key', body.challenge_key)

        // Check expiry
        if (new Date(storedChallenge.expires_at) < new Date()) {
          return errorResponse('Challenge expired', 401, origin)
        }

        // Verify user matches
        if (storedChallenge.user_id !== user.id) {
          return errorResponse('User mismatch', 401, origin)
        }

        // Verify registration response
        let verification
        try {
          verification = await verifyRegistrationResponse({
            response: body.response as RegistrationResponseJSON,
            expectedChallenge: storedChallenge.challenge,
            expectedOrigin: EXPECTED_ORIGINS,
            expectedRPID: RP_ID,
          })

          if (!verification.verified || !verification.registrationInfo) {
            console.error('[PASSKEY-REGISTER] Verification failed')
            return errorResponse('Registration verification failed', 401, origin)
          }
          console.log('[PASSKEY-REGISTER] Verification successful using @simplewebauthn/server')
        } catch (verifyError) {
          console.error('[PASSKEY-REGISTER] Verification exception:', verifyError)
          return errorResponse('Registration verification error', 401, origin)
        }

        const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo

        // Convert public key to base64 for storage
        const publicKeyB64 = btoa(String.fromCharCode(...credential.publicKey))

        // Store the credential
        const { data, error } = await supabaseAdmin
          .from('user_passkeys')
          .upsert({
            user_id: user.id,
            credential_id: credential.id,
            public_key: publicKeyB64,
            device_name: body.device_name || 'Device',
            authenticator_type: credentialDeviceType,
            transports: credential.transports || ['internal'],
            is_active: true,
            counter: credential.counter,
            backed_up: credentialBackedUp,
          }, {
            onConflict: 'credential_id',
          })
          .select()

        if (error) {
          console.error('[PASSKEY-REGISTER] Database error:', error.message)
          return errorResponse(`DB Error: ${error.message}`, 500, origin)
        }

        // Log successful registration
        await supabaseAdmin.from('audit_logs').insert({
          user_id: user.id,
          action: 'passkey_registered',
          action_category: 'auth',
          metadata: {
            credential_id: credential.id.substring(0, 16),
            device_type: credentialDeviceType,
            backed_up: credentialBackedUp,
          },
          success: true,
        })

        console.log('[PASSKEY-REGISTER] Registration successful')
        return jsonResponse({ success: true, data }, 201, origin)
      }

      // Legacy format: Direct credential registration (for backwards compatibility)
      console.log('[PASSKEY-REGISTER] Using legacy registration format')

      // Validate required field
      if (!body.attestation_object) {
        return errorResponse('attestation_object is required', 400, origin)
      }

      // Extract public key from attestation object
      // This is the authoritative source - it contains the COSE-encoded public key
      // which we convert to SPKI format for use with WebCrypto verification
      let publicKey: string
      try {
        publicKey = extractPublicKeyFromAttestation(body.attestation_object)
        console.log('[PASSKEY-REGISTER] Extracted public key from attestation (SPKI format)')
      } catch (err: any) {
        console.error('[PASSKEY-REGISTER] Failed to extract public key:', err.message)
        return errorResponse(`Failed to extract public key: ${err.message}`, 400, origin)
      }

      const { data, error } = await supabaseAdmin
        .from('user_passkeys')
        .upsert({
          user_id: user.id,
          credential_id: body.credential_id,
          public_key: publicKey,
          device_name: body.device_name || 'Mobile Device',
          authenticator_type: body.authenticator_type || 'platform',
          transports: body.transports || ['internal'],
          is_active: true,
          counter: 0,
        }, {
          onConflict: 'credential_id',
        })
        .select()

      if (error) {
        console.error('[PASSKEY-REGISTER] Database error (Upsert):', error.message)
        return errorResponse(`DB Error: ${error.message}`, 500, origin)
      }

      console.log('[PASSKEY-REGISTER] Registration successful (legacy)')
      return jsonResponse({ success: true, data }, 201, origin)
    }

    // DELETE: Remove a passkey
    if (req.method === 'DELETE') {
      const body = await req.json()
      const passkeyId = body.passkey_id

      if (!passkeyId) {
        return errorResponse('Missing passkey_id', 400, origin)
      }

      // Soft delete (set is_active = false)
      const { error } = await supabaseAdmin
        .from('user_passkeys')
        .update({ is_active: false })
        .eq('id', passkeyId)
        .eq('user_id', user.id)

      if (error) {
        console.error('[PASSKEY-REGISTER] Delete error:', error.message)
        return errorResponse(`Delete failed: ${error.message}`, 500, origin)
      }

      // Log deletion
      await supabaseAdmin.from('audit_logs').insert({
        user_id: user.id,
        action: 'passkey_deleted',
        action_category: 'auth',
        metadata: { passkey_id: passkeyId },
        success: true,
      })

      return jsonResponse({ success: true }, 200, origin)
    }

    return errorResponse('Method not allowed', 405, origin)
  } catch (err: any) {
    console.error('[PASSKEY-REGISTER] Uncaught exception:', err.message)
    return errorResponse(err.message, 500, origin)
  }
})
