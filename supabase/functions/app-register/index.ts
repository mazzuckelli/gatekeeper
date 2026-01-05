/**
 * App Register Endpoint
 *
 * PURPOSE: Allow developers to register their apps with Gatekeeper.
 * This is the DEVELOPER PORTAL functionality - not user authorization.
 *
 * When a developer registers an app:
 * 1. They get an app_id, shared_secret, and api_key
 * 2. Their app is stored in registered_apps table
 * 3. Users can later authorize this app via Dawg Tag
 *
 * ENDPOINTS:
 * - GET: List apps owned by the authenticated developer
 * - POST: Register a new app
 * - PUT: Update an existing app
 * - DELETE: Deactivate an app
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

/**
 * Generate a cryptographically secure random string
 */
function generateSecureToken(length: number): string {
  const array = new Uint8Array(length)
  crypto.getRandomValues(array)
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Validate app_id format
 */
function isValidAppId(appId: string): boolean {
  // 4-50 chars, lowercase alphanumeric and hyphens, must start/end with alphanumeric
  return /^[a-z0-9][a-z0-9-]{2,48}[a-z0-9]$/.test(appId)
}

/**
 * Validate URL format
 */
function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  const origin = req.headers.get('Origin')

  try {
    // Authenticate the developer
    const authHeader = req.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return errorResponse('Missing authorization header', 401, origin)
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    // Verify the token and get user
    const token = authHeader.split(' ')[1]
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)

    if (authError || !user) {
      return errorResponse('Invalid or expired token', 401, origin)
    }

    const userId = user.id

    // Route based on method
    switch (req.method) {
      case 'GET':
        return await handleGetApps(supabase, userId, origin)
      case 'POST':
        return await handleRegisterApp(supabase, userId, req, origin)
      case 'PUT':
        return await handleUpdateApp(supabase, userId, req, origin)
      case 'DELETE':
        return await handleDeactivateApp(supabase, userId, req, origin)
      default:
        return errorResponse('Method not allowed', 405, origin)
    }

  } catch (error) {
    console.error('[APP-REGISTER] Error:', error)
    return errorResponse('Internal server error', 500, origin)
  }
})

/**
 * GET: List apps owned by the developer
 */
async function handleGetApps(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  origin: string | null
) {
  const { data: apps, error } = await supabase
    .from('registered_apps')
    .select(`
      id,
      app_id,
      app_name,
      app_description,
      organization_name,
      callback_urls,
      allowed_origins,
      allowed_scopes,
      is_active,
      is_verified,
      is_first_party,
      total_tokens_issued,
      total_users_connected,
      created_at,
      last_token_issued_at
    `)
    .eq('owner_user_id', userId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[APP-REGISTER] Fetch error:', error)
    return errorResponse('Failed to fetch apps', 500, origin)
  }

  return jsonResponse({ apps: apps || [] }, 200, origin)
}

/**
 * POST: Register a new app
 */
async function handleRegisterApp(
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
    app_id,
    app_name,
    owner_email,
    description,
    organization_name,
    callback_urls,
    allowed_origins,
    allowed_scopes,
  } = body

  // Validate required fields
  if (!app_id || !app_name || !owner_email) {
    return errorResponse('app_id, app_name, and owner_email are required', 400, origin)
  }

  if (!isValidAppId(app_id)) {
    return errorResponse(
      'app_id must be 4-50 lowercase letters, numbers, and hyphens. Must start and end with a letter or number.',
      400,
      origin
    )
  }

  if (!Array.isArray(callback_urls) || callback_urls.length === 0) {
    return errorResponse('At least one callback_url is required', 400, origin)
  }

  // Validate all URLs
  for (const url of callback_urls) {
    if (!isValidUrl(url)) {
      return errorResponse(`Invalid callback URL: ${url}`, 400, origin)
    }
  }

  if (allowed_origins) {
    for (const o of allowed_origins) {
      if (!isValidUrl(o)) {
        return errorResponse(`Invalid origin: ${o}`, 400, origin)
      }
    }
  }

  // Check if app_id already exists
  const { data: existing } = await supabase
    .from('registered_apps')
    .select('id')
    .eq('app_id', app_id)
    .single()

  if (existing) {
    return errorResponse('An app with this app_id already exists', 409, origin)
  }

  // Generate credentials
  const sharedSecret = generateSecureToken(32) // 64 hex chars
  const apiKey = `gk_${generateSecureToken(24)}` // gk_ prefix + 48 hex chars

  // Hash the credentials for storage
  const encoder = new TextEncoder()
  const secretHash = await crypto.subtle.digest('SHA-256', encoder.encode(sharedSecret))
  const apiKeyHash = await crypto.subtle.digest('SHA-256', encoder.encode(apiKey))

  const sharedSecretHash = Array.from(new Uint8Array(secretHash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
  const apiKeyHashStr = Array.from(new Uint8Array(apiKeyHash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')

  // Default scopes if not provided
  const scopes = allowed_scopes || ['profile:read']

  // Insert the app
  const { data: app, error } = await supabase
    .from('registered_apps')
    .insert({
      app_id,
      app_name,
      app_description: description || null,
      owner_email,
      owner_user_id: userId,
      organization_name: organization_name || null,
      callback_urls,
      allowed_origins: allowed_origins || callback_urls.map((u: string) => new URL(u).origin),
      allowed_scopes: scopes,
      shared_secret_hash: sharedSecretHash,
      api_key_hash: apiKeyHashStr,
      is_active: true,
      is_verified: false,
      is_first_party: false,
    })
    .select()
    .single()

  if (error) {
    console.error('[APP-REGISTER] Insert error:', error)
    if (error.code === '23505') {
      return errorResponse('An app with this app_id already exists', 409, origin)
    }
    return errorResponse('Failed to register app', 500, origin)
  }

  // Log audit event
  await supabase.from('audit_logs').insert({
    user_id: userId,
    action: 'app_registered',
    action_category: 'developer',
    metadata: { app_id, app_name },
    success: true,
  })

  // Return the app info WITH credentials (only time they're shown)
  return jsonResponse({
    app: {
      id: app.id,
      app_id: app.app_id,
      app_name: app.app_name,
      created_at: app.created_at,
    },
    credentials: {
      shared_secret: sharedSecret,
      api_key: apiKey,
    },
    message: 'Save these credentials now - they will not be shown again!',
  }, 201, origin)
}

/**
 * PUT: Update an existing app
 */
async function handleUpdateApp(
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

  const { app_id, ...updates } = body

  if (!app_id) {
    return errorResponse('app_id is required', 400, origin)
  }

  // Verify ownership
  const { data: existing, error: fetchError } = await supabase
    .from('registered_apps')
    .select('id, owner_user_id')
    .eq('app_id', app_id)
    .single()

  if (fetchError || !existing) {
    return errorResponse('App not found', 404, origin)
  }

  if (existing.owner_user_id !== userId) {
    return errorResponse('You do not own this app', 403, origin)
  }

  // Allowed update fields
  const allowedFields = [
    'app_name',
    'app_description',
    'organization_name',
    'callback_urls',
    'allowed_origins',
    'allowed_scopes',
    'app_icon_url',
  ]

  const sanitizedUpdates: Record<string, unknown> = {}
  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      sanitizedUpdates[field] = updates[field]
    }
  }

  if (Object.keys(sanitizedUpdates).length === 0) {
    return errorResponse('No valid fields to update', 400, origin)
  }

  // Validate URLs if provided
  if (sanitizedUpdates.callback_urls) {
    for (const url of sanitizedUpdates.callback_urls as string[]) {
      if (!isValidUrl(url)) {
        return errorResponse(`Invalid callback URL: ${url}`, 400, origin)
      }
    }
  }

  if (sanitizedUpdates.allowed_origins) {
    for (const o of sanitizedUpdates.allowed_origins as string[]) {
      if (!isValidUrl(o)) {
        return errorResponse(`Invalid origin: ${o}`, 400, origin)
      }
    }
  }

  const { data: updated, error: updateError } = await supabase
    .from('registered_apps')
    .update(sanitizedUpdates)
    .eq('id', existing.id)
    .select()
    .single()

  if (updateError) {
    console.error('[APP-REGISTER] Update error:', updateError)
    return errorResponse('Failed to update app', 500, origin)
  }

  // Log audit event
  await supabase.from('audit_logs').insert({
    user_id: userId,
    action: 'app_updated',
    action_category: 'developer',
    metadata: { app_id, fields_updated: Object.keys(sanitizedUpdates) },
    success: true,
  })

  return jsonResponse({ app: updated }, 200, origin)
}

/**
 * DELETE: Deactivate an app (soft delete)
 */
async function handleDeactivateApp(
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

  const { app_id } = body

  if (!app_id) {
    return errorResponse('app_id is required', 400, origin)
  }

  // Verify ownership
  const { data: existing, error: fetchError } = await supabase
    .from('registered_apps')
    .select('id, owner_user_id, is_first_party')
    .eq('app_id', app_id)
    .single()

  if (fetchError || !existing) {
    return errorResponse('App not found', 404, origin)
  }

  if (existing.owner_user_id !== userId) {
    return errorResponse('You do not own this app', 403, origin)
  }

  if (existing.is_first_party) {
    return errorResponse('First-party apps cannot be deactivated', 403, origin)
  }

  // Soft delete - mark as inactive
  const { error: updateError } = await supabase
    .from('registered_apps')
    .update({ is_active: false })
    .eq('id', existing.id)

  if (updateError) {
    console.error('[APP-REGISTER] Deactivate error:', updateError)
    return errorResponse('Failed to deactivate app', 500, origin)
  }

  // Log audit event
  await supabase.from('audit_logs').insert({
    user_id: userId,
    action: 'app_deactivated',
    action_category: 'developer',
    metadata: { app_id },
    success: true,
  })

  return jsonResponse({ success: true, message: 'App deactivated' }, 200, origin)
}
