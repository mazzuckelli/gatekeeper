/**
 * Pair Client Endpoint
 *
 * PURPOSE: Enable Dawg Tag (or other client apps) to register their APK
 * fingerprint so they can use passkey authentication.
 *
 * FLOW:
 * 1. User initiates pairing from Gatekeeper mobile (authenticated)
 * 2. Gatekeeper mobile calls POST /pair-client { action: 'create_challenge', client_app_id: 'dawg-tag' }
 * 3. Returns a pairing challenge
 * 4. Gatekeeper mobile opens Dawg Tag via deep link with the challenge
 * 5. Dawg Tag collects its APK fingerprint and calls POST /pair-client
 *    { action: 'complete_pairing', challenge: '...', origin: 'android:apk-key-hash:...' }
 * 6. Server validates challenge and stores the trusted origin
 *
 * SECURITY:
 * - Challenge is single-use and expires in 5 minutes
 * - Only the user who created the challenge can have origins added
 * - Origins are stored per-user, not globally
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

Deno.serve(async (req) => {
  console.log('[PAIR-CLIENT] Request:', req.method, req.url)

  // Handle CORS preflight
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  const origin = req.headers.get('Origin')

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405, origin)
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  let body
  try {
    body = await req.json()
  } catch {
    return errorResponse('Invalid request body', 400, origin)
  }

  const { action } = body

  try {
    if (action === 'create_challenge') {
      return await handleCreateChallenge(supabase, req, body, origin)
    } else if (action === 'complete_pairing') {
      return await handleCompletePairing(supabase, body, origin)
    } else {
      return errorResponse('Invalid action. Use "create_challenge" or "complete_pairing"', 400, origin)
    }
  } catch (error) {
    console.error('[PAIR-CLIENT] Error:', error)
    return errorResponse('Internal server error', 500, origin)
  }
})

/**
 * Create a pairing challenge (called from Gatekeeper mobile, authenticated)
 */
async function handleCreateChallenge(
  supabase: ReturnType<typeof createClient>,
  req: Request,
  body: { client_app_id?: string; client_app_name?: string },
  origin: string | null
) {
  const { client_app_id, client_app_name } = body

  if (!client_app_id) {
    return errorResponse('client_app_id is required', 400, origin)
  }

  // Verify user is authenticated
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return errorResponse('Authentication required', 401, origin)
  }

  const token = authHeader.split(' ')[1]
  const { data: { user }, error: authError } = await supabase.auth.getUser(token)

  if (authError || !user) {
    console.error('[PAIR-CLIENT] Auth error:', authError)
    return errorResponse('Invalid or expired token', 401, origin)
  }

  console.log('[PAIR-CLIENT] Creating challenge for user:', user.id, 'client:', client_app_id)

  // Create pairing challenge using the database function
  const { data: challenge, error: challengeError } = await supabase.rpc('create_pairing_challenge', {
    p_user_id: user.id,
    p_client_app_id: client_app_id,
  })

  if (challengeError) {
    console.error('[PAIR-CLIENT] Failed to create challenge:', challengeError)
    return errorResponse(`Failed to create pairing challenge: ${challengeError.message}`, 500, origin)
  }

  console.log('[PAIR-CLIENT] Challenge created successfully')

  return jsonResponse({
    challenge,
    client_app_id,
    client_app_name: client_app_name || client_app_id,
    expires_in: 300, // 5 minutes
  }, 200, origin)
}

/**
 * Complete pairing (called from Dawg Tag, unauthenticated but with valid challenge)
 */
async function handleCompletePairing(
  supabase: ReturnType<typeof createClient>,
  body: { challenge?: string; origin?: string; client_app_name?: string },
  httpOrigin: string | null
) {
  const { challenge, origin: clientOrigin, client_app_name } = body

  if (!challenge) {
    return errorResponse('challenge is required', 400, httpOrigin)
  }

  if (!clientOrigin) {
    return errorResponse('origin is required', 400, httpOrigin)
  }

  // Validate origin format (should be android:apk-key-hash:... or https://...)
  if (!clientOrigin.startsWith('android:apk-key-hash:') && !clientOrigin.startsWith('https://')) {
    return errorResponse('Invalid origin format', 400, httpOrigin)
  }

  console.log('[PAIR-CLIENT] Completing pairing with origin:', clientOrigin)

  // Consume the challenge and get user info
  const { data: challengeData, error: consumeError } = await supabase.rpc('consume_pairing_challenge', {
    p_challenge: challenge,
  })

  if (consumeError) {
    console.error('[PAIR-CLIENT] Failed to consume challenge:', consumeError)
    return errorResponse('Invalid or expired challenge', 401, httpOrigin)
  }

  if (!challengeData || challengeData.length === 0) {
    console.error('[PAIR-CLIENT] Challenge not found or expired')
    return errorResponse('Invalid or expired challenge', 401, httpOrigin)
  }

  const { user_id, client_app_id } = challengeData[0]
  console.log('[PAIR-CLIENT] Challenge valid for user:', user_id, 'client:', client_app_id)

  // Store the trusted origin
  const { data: originId, error: originError } = await supabase.rpc('add_trusted_client_origin', {
    p_user_id: user_id,
    p_client_app_id: client_app_id,
    p_client_app_name: client_app_name || client_app_id,
    p_origin: clientOrigin,
  })

  if (originError) {
    console.error('[PAIR-CLIENT] Failed to store origin:', originError)
    return errorResponse('Failed to complete pairing', 500, httpOrigin)
  }

  console.log('[PAIR-CLIENT] Pairing completed successfully, origin_id:', originId)

  return jsonResponse({
    success: true,
    message: 'Pairing completed successfully',
    client_app_id,
  }, 200, httpOrigin)
}
