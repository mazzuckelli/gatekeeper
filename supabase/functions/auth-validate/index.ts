/**
 * Auth Validate Endpoint
 *
 * PURPOSE: Validate user credentials and return a blind attestation to Dawg Tag.
 *
 * SECURITY:
 * - Dawg Tag receives ONLY an attestation (proof of auth, no user identity)
 * - Attestation contains NO user_id, NO email, NO identifying information
 * - Gatekeeper never knows which app the user is accessing
 *
 * REQUEST:
 * POST /auth-validate
 * {
 *   "email": "user@example.com",
 *   "password": "..."
 * }
 *
 * RESPONSE (success):
 * {
 *   "attestation": "jwt...",
 *   "tier": "free|standard|premium|enterprise"
 * }
 *
 * RESPONSE (error):
 * {
 *   "error": "Invalid credentials"
 * }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { SignJWT, importJWK } from 'https://deno.land/x/jose@v5.2.0/index.ts'
import { handleCors, jsonResponse, errorResponse, getCorsHeaders } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// Rate limit configuration
const MAX_ATTEMPTS_PER_MINUTE = 5
const MAX_ATTEMPTS_PER_HOUR = 20

Deno.serve(async (req) => {
  // Handle CORS preflight
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  const origin = req.headers.get('Origin')

  // Only allow POST
  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405, origin)
  }

  try {
    const { email, password } = await req.json()

    if (!email || !password) {
      return errorResponse('Email and password are required', 400, origin)
    }

    // Get client IP for rate limiting
    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
                     req.headers.get('x-real-ip') ||
                     'unknown'

    // Create service client for rate limiting checks
    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    // Check rate limits
    const rateLimitKey = `auth:${clientIp}:${email.toLowerCase()}`
    const { data: rateLimit } = await serviceClient
      .from('rate_limits')
      .select('count, window_start')
      .eq('identifier', rateLimitKey)
      .eq('action', 'auth_validate')
      .gte('window_start', new Date(Date.now() - 60000).toISOString()) // Last minute
      .single()

    if (rateLimit && rateLimit.count >= MAX_ATTEMPTS_PER_MINUTE) {
      // Log rate limit hit
      await serviceClient.from('audit_logs').insert({
        action: 'auth_rate_limited',
        action_category: 'security',
        ip_address: clientIp,
        metadata: { email: email.toLowerCase(), reason: 'minute_limit' },
        success: false,
        error_message: 'Rate limit exceeded'
      })

      return errorResponse('Too many attempts. Please wait a moment.', 429, origin)
    }

    // Increment rate limit counter
    await serviceClient.rpc('increment_rate_limit', {
      p_identifier: rateLimitKey,
      p_action: 'auth_validate'
    }).catch(() => {
      // If RPC doesn't exist, insert/update manually
      return serviceClient.from('rate_limits').upsert({
        identifier: rateLimitKey,
        action: 'auth_validate',
        count: (rateLimit?.count || 0) + 1,
        window_start: rateLimit?.window_start || new Date().toISOString()
      }, { onConflict: 'identifier,action,window_start' })
    })

    // Create anonymous client for authentication
    const anonClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!)

    // Attempt authentication
    const { data: authData, error: authError } = await anonClient.auth.signInWithPassword({
      email,
      password
    })

    if (authError || !authData.user) {
      // Log failed attempt
      await serviceClient.from('audit_logs').insert({
        action: 'auth_failed',
        action_category: 'auth',
        ip_address: clientIp,
        metadata: { email: email.toLowerCase() },
        success: false,
        error_message: 'Invalid credentials'
      })

      // Return generic error (don't reveal if email exists)
      return errorResponse('Invalid credentials', 401, origin)
    }

    const userId = authData.user.id

    // Get user's subscription tier
    const { data: profile } = await serviceClient
      .from('user_profiles')
      .select('subscription_tier, subscription_status')
      .eq('id', userId)
      .single()

    const tier = (profile?.subscription_status === 'active')
      ? (profile?.subscription_tier || 'free')
      : 'free'

    // Log successful auth
    await serviceClient.from('audit_logs').insert({
      user_id: userId,
      action: 'auth_validated',
      action_category: 'auth',
      ip_address: clientIp,
      metadata: { tier },
      success: true
    })

    // Update last_seen_at
    await serviceClient
      .from('user_profiles')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id', userId)

    // Check if user has a registered passkey (for biometric login on future visits)
    // We return the credential_id so Dawg Tag can store it locally
    const { data: passkeys } = await serviceClient
      .from('user_passkeys')
      .select('credential_id')
      .eq('user_id', userId)
      .eq('is_active', true)
      .limit(1)

    const credentialId = passkeys?.[0]?.credential_id || null

    // ------------------------------------------------------------------
    // Generate blind attestation (NO user_id, NO email, NO identifying info)
    // ------------------------------------------------------------------
    const attestationKeyJson = Deno.env.get('ATTESTATION_SIGNING_KEY')
    if (!attestationKeyJson) {
      console.error('[AUTH-VALIDATE] ATTESTATION_SIGNING_KEY not configured')
      return errorResponse('Server configuration error', 500, origin)
    }

    let attestation: string
    try {
      const attestationKey = JSON.parse(attestationKeyJson)
      const privateKey = await importJWK(attestationKey, 'ES256')
      const now = Math.floor(Date.now() / 1000)

      // Attestation for Dawg Tag (5 minutes)
      // Contains NO user_id, NO email - just proof that someone authenticated
      attestation = await new SignJWT({
        type: 'attestation',
        valid: true,
        auth_level: 'password',
      })
        .setProtectedHeader({ alg: 'ES256', typ: 'JWT' })
        .setIssuer('gatekeeper')
        .setAudience('ghost-auth')
        .setIssuedAt(now)
        .setExpirationTime(now + 300)
        .setJti(crypto.randomUUID())
        .sign(privateKey)

      console.log('[AUTH-VALIDATE] Generated attestation')
    } catch (err) {
      console.error('[AUTH-VALIDATE] Failed to generate attestation:', err)
      return errorResponse('Failed to generate attestation', 500, origin)
    }

    // Return attestation, tier, and credential_id to Dawg Tag
    // NO user_id, NO email - just blind proof of authentication
    // credential_id allows biometric login on future visits
    return jsonResponse({
      attestation: attestation,
      tier: tier,
      credential_id: credentialId
    }, 200, origin)

  } catch (error) {
    console.error('Auth validate error:', error)
    return errorResponse('Internal server error', 500, origin)
  }
})
