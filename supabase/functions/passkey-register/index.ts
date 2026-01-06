/**
 * Passkey Registration Endpoint
 *
 * PURPOSE: Register a new WebAuthn passkey for an authenticated user.
 *
 * This enables biometric authentication for future logins.
 * User must be authenticated via email/password first (Bearer token required).
 *
 * FLOW:
 * 1. User logs in with email/password via auth-validate
 * 2. User's device generates WebAuthn credential
 * 3. Device sends credential to this endpoint
 * 4. We store the public key in user_passkeys table
 * 5. Future logins can use passkey-auth
 *
 * ENDPOINTS:
 * - POST: Register a new passkey
 * - GET: List user's registered passkeys
 * - DELETE: Remove a passkey
 *
 * SECURITY:
 * - Requires valid Bearer token (user must be logged in)
 * - Validates credential format
 * - Prevents duplicate credential IDs
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

Deno.serve(async (req) => {
  // Handle CORS preflight
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  const origin = req.headers.get('Origin')

  try {
    // Get and verify authorization token
    const authHeader = req.headers.get('Authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return errorResponse('Authorization required', 401, origin)
    }

    const token = authHeader.slice(7)

    // Create client with user's token to verify identity
    const supabaseUser = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    })

    // Verify token and get user
    const { data: { user }, error: authError } = await supabaseUser.auth.getUser()

    if (authError || !user) {
      return errorResponse('Invalid or expired token', 401, origin)
    }

    // Use service role client for database operations
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    if (req.method === 'GET') {
      return await handleListPasskeys(supabase, user.id, origin)
    } else if (req.method === 'POST') {
      return await handleRegisterPasskey(supabase, user.id, req, origin)
    } else if (req.method === 'DELETE') {
      return await handleDeletePasskey(supabase, user.id, req, origin)
    } else {
      return errorResponse('Method not allowed', 405, origin)
    }
  } catch (error) {
    console.error('[PASSKEY-REGISTER] Error:', error)
    return errorResponse('Internal server error', 500, origin)
  }
})

/**
 * GET: List user's registered passkeys
 */
async function handleListPasskeys(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  origin: string | null
) {
  const { data: passkeys, error } = await supabase
    .from('user_passkeys')
    .select('id, credential_id, device_name, authenticator_type, created_at, last_used_at, is_active')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[PASSKEY-REGISTER] List error:', error)
    return errorResponse('Failed to list passkeys', 500, origin)
  }

  return jsonResponse({
    passkeys: passkeys.map(p => ({
      id: p.id,
      credential_id: p.credential_id.substring(0, 16) + '...', // Truncate for display
      device_name: p.device_name,
      authenticator_type: p.authenticator_type,
      created_at: p.created_at,
      last_used_at: p.last_used_at,
      is_active: p.is_active,
    })),
  }, 200, origin)
}

/**
 * POST: Register a new passkey
 * Body: {
 *   credential_id: string (base64url),
 *   public_key: string (base64, SPKI format),
 *   device_name?: string,
 *   authenticator_type?: 'platform' | 'cross-platform',
 *   transports?: string[]
 * }
 */
async function handleRegisterPasskey(
  supabase: ReturnType<typeof createClient>,
  userId: string,
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
    credential_id,
    public_key,
    device_name,
    authenticator_type,
    transports,
  } = body

  // Validate required fields
  if (!credential_id || !public_key) {
    return errorResponse('credential_id and public_key are required', 400, origin)
  }

  // Validate credential_id format (base64url)
  if (!/^[A-Za-z0-9_-]+$/.test(credential_id)) {
    return errorResponse('Invalid credential_id format', 400, origin)
  }

  // Validate public_key format (base64)
  try {
    atob(public_key)
  } catch {
    return errorResponse('Invalid public_key format (must be base64)', 400, origin)
  }

  // Validate authenticator_type if provided
  if (authenticator_type && !['platform', 'cross-platform'].includes(authenticator_type)) {
    return errorResponse('Invalid authenticator_type', 400, origin)
  }

  // Check if credential_id already exists (globally unique)
  const { data: existing } = await supabase
    .from('user_passkeys')
    .select('id')
    .eq('credential_id', credential_id)
    .single()

  if (existing) {
    return errorResponse('Credential already registered', 409, origin)
  }

  // Insert new passkey
  const { data: passkey, error: insertError } = await supabase
    .from('user_passkeys')
    .insert({
      user_id: userId,
      credential_id,
      public_key,
      device_name: device_name || 'Unknown Device',
      authenticator_type: authenticator_type || 'platform',
      transports: transports || ['internal'],
      counter: 0,
      is_active: true,
    })
    .select('id, credential_id, device_name, created_at')
    .single()

  if (insertError) {
    console.error('[PASSKEY-REGISTER] Insert error:', insertError)
    return errorResponse('Failed to register passkey', 500, origin)
  }

  // Log the registration
  const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null
  await supabase.from('audit_logs').insert({
    user_id: userId,
    action: 'passkey_registered',
    action_category: 'auth',
    ip_address: clientIp,
    metadata: {
      device_name: device_name || 'Unknown Device',
      authenticator_type: authenticator_type || 'platform',
    },
    success: true,
  })

  return jsonResponse({
    success: true,
    passkey: {
      id: passkey.id,
      credential_id: passkey.credential_id.substring(0, 16) + '...',
      device_name: passkey.device_name,
      created_at: passkey.created_at,
    },
  }, 201, origin)
}

/**
 * DELETE: Remove a passkey
 * Body: { passkey_id: string }
 */
async function handleDeletePasskey(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  req: Request,
  origin: string | null
) {
  let body
  try {
    body = await req.json()
  } catch {
    return errorResponse('Invalid JSON body', 400, origin)
  }

  const { passkey_id } = body

  if (!passkey_id) {
    return errorResponse('passkey_id is required', 400, origin)
  }

  // Delete the passkey (only if it belongs to this user)
  const { error: deleteError, count } = await supabase
    .from('user_passkeys')
    .delete()
    .eq('id', passkey_id)
    .eq('user_id', userId)

  if (deleteError) {
    console.error('[PASSKEY-REGISTER] Delete error:', deleteError)
    return errorResponse('Failed to delete passkey', 500, origin)
  }

  if (count === 0) {
    return errorResponse('Passkey not found', 404, origin)
  }

  // Log the deletion
  const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null
  await supabase.from('audit_logs').insert({
    user_id: userId,
    action: 'passkey_deleted',
    action_category: 'auth',
    ip_address: clientIp,
    metadata: { passkey_id },
    success: true,
  })

  return jsonResponse({ success: true }, 200, origin)
}
