/**
 * Auth Validate Endpoint
 *
 * PURPOSE: Validate user credentials and return user_id to Dawg Tag.
 *
 * This is the ONLY endpoint that returns user_id, and it should ONLY
 * be called by Dawg Tag. The user_id is used transiently in Dawg Tag's
 * RAM to compute ghost_id, then immediately discarded.
 *
 * SECURITY:
 * - Dawg Tag receives user_id, computes ghost_id locally, discards user_id
 * - Gatekeeper never knows which app the user is accessing
 * - Gatekeeper never knows the resulting ghost_id
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
 *   "user_id": "uuid",
 *   "tier": "free|standard|premium|enterprise"
 * }
 *
 * RESPONSE (error):
 * {
 *   "error": "Invalid credentials"
 * }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
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

    // Return user_id and tier to Dawg Tag
    // CRITICAL: Dawg Tag must use this transiently and discard
    return jsonResponse({
      user_id: userId,
      tier: tier
    }, 200, origin)

  } catch (error) {
    console.error('Auth validate error:', error)
    return errorResponse('Internal server error', 500, origin)
  }
})
