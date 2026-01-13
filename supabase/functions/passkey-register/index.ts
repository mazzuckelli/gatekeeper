import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const GATEKEEPER_PUBLISHABLE_KEY = Deno.env.get('GATEKEEPER_PUBLISHABLE_KEY')!
const GATEKEEPER_SECRET_KEY = Deno.env.get('GATEKEEPER_SECRET_KEY')!

Deno.serve(async (req) => {
  console.log(`[Passkey] Incoming ${req.method} request`)
  
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  const origin = req.headers.get('Origin')

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      console.error('[Passkey] Missing Authorization header')
      return errorResponse('Missing Auth Header', 401, origin)
    }

    // 1. Verify the User Session
    const supabaseUser = createClient(SUPABASE_URL, GATEKEEPER_PUBLISHABLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error: authError } = await supabaseUser.auth.getUser()

    if (authError || !user) {
      console.error('[Passkey] Auth failed:', authError?.message)
      return errorResponse('Unauthorized', 401, origin)
    }
    console.log(`[Passkey] Authenticated user: ${user.id}`)

    // 2. Initialize Admin Client for DB
    const supabaseAdmin = createClient(SUPABASE_URL, GATEKEEPER_SECRET_KEY)

    if (req.method === 'GET') {
      console.log('[Passkey] Fetching keys...')
      const { data, error } = await supabaseAdmin
        .from('user_passkeys')
        .select('id, device_name, created_at')
        .eq('user_id', user.id)
        .eq('is_active', true)

      if (error) {
        console.error('[Passkey] Database error (List):', error.message)
        return errorResponse(`DB Error: ${error.message}`, 500, origin)
      }
      return jsonResponse({ passkeys: data }, 200, origin)
    }

    if (req.method === 'POST') {
      const body = await req.json()
      console.log('[Passkey] Registering new key...')
      const { data, error } = await supabaseAdmin
        .from('user_passkeys')
        .insert({
          user_id: user.id,
          credential_id: body.credential_id,
          public_key: body.public_key,
          device_name: body.device_name || 'Mobile Device',
        })
        .select()

      if (error) {
        console.error('[Passkey] Database error (Insert):', error.message)
        return errorResponse(`DB Error: ${error.message}`, 500, origin)
      }
      return jsonResponse({ success: true, data }, 201, origin)
    }

    return errorResponse('Method not allowed', 405, origin)
  } catch (err: any) {
    console.error('[Passkey] Uncaught exception:', err.message)
    return errorResponse(err.message, 500, origin)
  }
})
