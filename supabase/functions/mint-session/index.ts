import { SignJWT, jwtVerify, importJWK } from 'https://deno.land/x/jose@v5.2.0/index.ts'
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts'

/**
 * Mint Session Endpoint
 *
 * PURPOSE: Mint Supabase-compatible JWT tokens after successful passkey verification.
 *
 * FLOW:
 * 1. Receive verification_token from passkey-auth (proves fingerprint just verified)
 * 2. Validate verification_token (signed by ATTESTATION_SIGNING_KEY, short-lived)
 * 3. Mint access_token and refresh_token using GATEKEEPER_JWT_PRIVATE_KEY
 * 4. Return tokens to client for supabase.auth.setSession()
 *
 * SECURITY:
 * - verification_token is single-use and expires in 30 seconds
 * - Only accepts tokens signed by our attestation key
 * - Minted JWTs are signed with the key rotated into Supabase's JWKS
 */

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!

Deno.serve(async (req) => {
  console.log('[MINT-SESSION] Request:', req.method)

  // Handle CORS preflight
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  const origin = req.headers.get('Origin')

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405, origin)
  }

  try {
    const body = await req.json()
    const { verification_token, user_id } = body

    if (!verification_token || !user_id) {
      return errorResponse('Missing verification_token or user_id', 400, origin)
    }

    // ------------------------------------------------------------------
    // 1. Verify the verification_token from passkey-auth
    // ------------------------------------------------------------------
    const attestationKeyJson = Deno.env.get('ATTESTATION_SIGNING_KEY')
    if (!attestationKeyJson) {
      console.error('[MINT-SESSION] ATTESTATION_SIGNING_KEY not configured')
      return errorResponse('Server configuration error', 500, origin)
    }

    let verifiedUserId: string
    try {
      console.log('[MINT-SESSION] Parsing attestation key...')
      const attestationKey = JSON.parse(attestationKeyJson)
      console.log('[MINT-SESSION] Key type:', attestationKey.kty, 'crv:', attestationKey.crv, 'has d:', !!attestationKey.d)

      // Extract only the public key components (remove private key 'd' parameter)
      const { d: _privateKey, ...publicKeyOnly } = attestationKey
      console.log('[MINT-SESSION] Importing public key for verification...')
      const publicKey = await importJWK(publicKeyOnly, 'ES256')
      console.log('[MINT-SESSION] Public key imported successfully')

      console.log('[MINT-SESSION] Verifying token (first 50 chars):', verification_token.substring(0, 50))
      const { payload } = await jwtVerify(verification_token, publicKey, {
        issuer: 'gatekeeper-passkey',
        audience: 'mint-session',
      })
      console.log('[MINT-SESSION] Token verified, payload type:', payload.type)

      if (payload.type !== 'passkey_verified') {
        throw new Error('Invalid token type: ' + payload.type)
      }

      verifiedUserId = payload.sub as string
      if (verifiedUserId !== user_id) {
        console.error('[MINT-SESSION] User ID mismatch:', verifiedUserId, 'vs', user_id)
        return errorResponse('User ID mismatch', 401, origin)
      }

      console.log('[MINT-SESSION] Verification token valid for user:', verifiedUserId)
    } catch (err: any) {
      console.error('[MINT-SESSION] Verification token invalid:', err.message || err)
      console.error('[MINT-SESSION] Full error:', JSON.stringify(err, Object.getOwnPropertyNames(err)))
      return errorResponse('Invalid verification token', 401, origin)
    }

    // ------------------------------------------------------------------
    // 2. Load the JWT signing key
    // ------------------------------------------------------------------
    const privateKeyJson = Deno.env.get('GATEKEEPER_JWT_PRIVATE_KEY')
    if (!privateKeyJson) {
      console.error('[MINT-SESSION] GATEKEEPER_JWT_PRIVATE_KEY not configured')
      return errorResponse('Server configuration error', 500, origin)
    }

    let privateKey
    let keyData
    try {
      keyData = JSON.parse(privateKeyJson)
      privateKey = await importJWK(keyData, 'ES256')
    } catch (err) {
      console.error('[MINT-SESSION] Failed to parse JWT private key:', err)
      return errorResponse('Server configuration error', 500, origin)
    }

    // ------------------------------------------------------------------
    // 3. Mint access token
    // ------------------------------------------------------------------
    const now = Math.floor(Date.now() / 1000)
    const accessExpiresIn = 3600 // 1 hour

    const accessToken = await new SignJWT({
      role: 'authenticated',
      aal: 'aal1',
    })
      .setProtectedHeader({ alg: 'ES256', typ: 'JWT', kid: keyData.kid })
      .setIssuer(`${SUPABASE_URL}/auth/v1`)
      .setAudience('authenticated')
      .setSubject(verifiedUserId)
      .setIssuedAt(now)
      .setExpirationTime(now + accessExpiresIn)
      .sign(privateKey)

    // ------------------------------------------------------------------
    // 4. Mint refresh token
    // ------------------------------------------------------------------
    const refreshExpiresIn = 604800 // 7 days

    const refreshToken = await new SignJWT({
      role: 'authenticated',
      type: 'refresh',
    })
      .setProtectedHeader({ alg: 'ES256', typ: 'JWT', kid: keyData.kid })
      .setIssuer(`${SUPABASE_URL}/auth/v1`)
      .setAudience('authenticated')
      .setSubject(verifiedUserId)
      .setIssuedAt(now)
      .setExpirationTime(now + refreshExpiresIn)
      .sign(privateKey)

    console.log('[MINT-SESSION] Tokens minted for user:', verifiedUserId)

    // ------------------------------------------------------------------
    // 5. Return tokens
    // ------------------------------------------------------------------
    return jsonResponse({
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: 'bearer',
      expires_in: accessExpiresIn,
      user: {
        id: verifiedUserId,
      },
    }, 200, origin)

  } catch (err) {
    console.error('[MINT-SESSION] Error:', err)
    return errorResponse('Internal server error', 500, origin)
  }
})
