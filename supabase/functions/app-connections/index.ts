/**
 * GATEKEEPER: User App Connections Management
 *
 * Allows users to:
 * - View all apps they've authorized
 * - Authorize new app connections (explicit consent)
 * - Revoke access to specific apps
 * - See usage statistics per app
 *
 * This gives users full control over their data sharing.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/security.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Allowed origins
const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:8080',
  'http://localhost:19006',
];
const PRODUCTION_ORIGINS = Deno.env.get('ALLOWED_ORIGINS')?.split(',') || [];
const ALLOWED_ORIGINS = [...DEFAULT_ALLOWED_ORIGINS, ...PRODUCTION_ORIGINS];

interface AppInfo {
  app_id: string;
  app_name: string;
  app_description: string | null;
  organization_name: string | null;
  is_verified: boolean;
}

interface ConnectionRow {
  id: string;
  granted_scopes: string[];
  authorized_at: string;
  last_used_at: string | null;
  tokens_issued: number;
  is_active: boolean;
  revoked_at: string | null;
  app: AppInfo | null;
}

interface AuthorizeRequest {
  app_id: string;
  scopes?: string[];
}

/**
 * Create JSON response with CORS headers
 */
function jsonResponse(
  data: unknown,
  status: number,
  corsHeaders: Record<string, string>
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  const requestOrigin = req.headers.get('origin');
  const corsHeaders = getCorsHeaders(requestOrigin, { allowedOrigins: ALLOWED_ORIGINS });

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    // Authenticate user
    const authHeader = req.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return jsonResponse({ error: 'Missing authorization header' }, 401, corsHeaders);
    }

    // Create Supabase client with the user's auth header
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
      global: {
        headers: { Authorization: authHeader },
      },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return jsonResponse({ error: 'Invalid or expired token' }, 401, corsHeaders);
    }
    const url = new URL(req.url);

    // GET: List all authorized apps for this user
    if (req.method === 'GET') {
      const { data: connections, error: connError } = await supabase
        .from('user_app_connections')
        .select(`
          id,
          granted_scopes,
          authorized_at,
          last_used_at,
          tokens_issued,
          is_active,
          revoked_at,
          app:app_id (
            app_id,
            app_name,
            app_description,
            organization_name,
            is_verified
          )
        `)
        .eq('user_id', user.id)
        .order('authorized_at', { ascending: false });

      if (connError) {
        console.error('[APP-CONNECTIONS] Fetch error:', connError);
        return jsonResponse({ error: 'Failed to fetch connections' }, 500, corsHeaders);
      }

      // Format response with proper typing
      const apps = (connections as ConnectionRow[] || []).map(conn => ({
        connection_id: conn.id,
        app_id: conn.app?.app_id || null,
        app_name: conn.app?.app_name || 'Unknown App',
        app_description: conn.app?.app_description || null,
        organization: conn.app?.organization_name || null,
        is_verified: conn.app?.is_verified || false,
        scopes: conn.granted_scopes,
        authorized_at: conn.authorized_at,
        last_used_at: conn.last_used_at,
        tokens_issued: conn.tokens_issued,
        is_active: conn.is_active,
        revoked_at: conn.revoked_at,
      }));

      return jsonResponse(
        {
          connections: apps,
          active_count: apps.filter(a => a.is_active).length,
          total_count: apps.length,
        },
        200,
        corsHeaders
      );
    }

    // POST: Authorize a new app connection (explicit user consent)
    if (req.method === 'POST') {
      let body: AuthorizeRequest;
      try {
        body = await req.json();
      } catch {
        return jsonResponse({ error: 'Invalid JSON body' }, 400, corsHeaders);
      }

      const { app_id, scopes = ['basic'] } = body;

      if (!app_id) {
        return jsonResponse({ error: 'app_id is required' }, 400, corsHeaders);
      }

      // Validate app_id format
      if (!/^[a-z0-9][a-z0-9-]{2,48}[a-z0-9]$/.test(app_id)) {
        return jsonResponse({ error: 'Invalid app_id format' }, 400, corsHeaders);
      }

      // Validate scopes is array of strings
      if (!Array.isArray(scopes) || !scopes.every(s => typeof s === 'string')) {
        return jsonResponse({ error: 'scopes must be an array of strings' }, 400, corsHeaders);
      }

      // Check if app exists and is active
      const { data: appData, error: appError } = await supabase
        .rpc('get_app_config', { p_app_id: app_id });

      if (appError) {
        console.error('[APP-CONNECTIONS] App lookup error:', appError);
        return jsonResponse({ error: 'Failed to lookup app' }, 500, corsHeaders);
      }

      if (!appData || appData.length === 0) {
        return jsonResponse({ error: 'App not found' }, 404, corsHeaders);
      }

      const app = appData[0];
      if (!app.is_active) {
        return jsonResponse({ error: 'App is not active' }, 403, corsHeaders);
      }

      // Validate requested scopes against allowed scopes
      const allowedScopes: string[] = app.allowed_scopes || ['basic'];
      const invalidScopes = scopes.filter(s => !allowedScopes.includes(s));
      if (invalidScopes.length > 0) {
        return jsonResponse(
          {
            error: 'Invalid scopes requested',
            invalid: invalidScopes,
            allowed: allowedScopes,
          },
          400,
          corsHeaders
        );
      }

      // Create connection (explicit user consent)
      const { data: result, error: authzError } = await supabase
        .rpc('authorize_app_connection', {
          p_user_id: user.id,
          p_app_id: app_id,
          p_granted_scopes: scopes,
        });

      if (authzError) {
        console.error('[APP-CONNECTIONS] Authorization error:', authzError);
        return jsonResponse({ error: 'Failed to authorize app' }, 500, corsHeaders);
      }

      const connection = result?.[0];

      // Log audit event
      const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
      const userAgent = req.headers.get('user-agent') || null;

      const { error: auditError } = await supabase.rpc('log_audit_event', {
        p_user_id: user.id,
        p_action: connection?.is_new ? 'app_authorized' : 'app_reauthorized',
        p_category: 'auth',
        p_ip_address: clientIp,
        p_user_agent: userAgent,
        p_metadata: { app_id, scopes, is_new: connection?.is_new },
      });

      if (auditError) {
        console.error('[APP-CONNECTIONS] Audit log error:', auditError);
      }

      console.log(`[APP-CONNECTIONS] User authorized app: ${app_id} (new: ${connection?.is_new})`);

      return jsonResponse(
        {
          success: true,
          connection_id: connection?.connection_id,
          is_new: connection?.is_new,
          app_id: app_id,
          app_name: app.app_name,
          scopes: scopes,
        },
        connection?.is_new ? 201 : 200,
        corsHeaders
      );
    }

    // DELETE: Revoke an app connection
    if (req.method === 'DELETE') {
      const appId = url.searchParams.get('app_id');

      if (!appId) {
        return jsonResponse({ error: 'app_id query parameter is required' }, 400, corsHeaders);
      }

      // Validate app_id format
      if (!/^[a-z0-9][a-z0-9-]{2,48}[a-z0-9]$/.test(appId)) {
        return jsonResponse({ error: 'Invalid app_id format' }, 400, corsHeaders);
      }

      // Revoke the connection
      const { data: revoked, error: revokeError } = await supabase
        .rpc('revoke_app_connection', {
          p_user_id: user.id,
          p_app_id: appId,
          p_revoked_by: 'user',
        });

      if (revokeError) {
        console.error('[APP-CONNECTIONS] Revoke error:', revokeError);
        return jsonResponse({ error: 'Failed to revoke app' }, 500, corsHeaders);
      }

      if (!revoked) {
        return jsonResponse({ error: 'No active connection found' }, 404, corsHeaders);
      }

      // Log audit event
      const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
      const userAgent = req.headers.get('user-agent') || null;

      const { error: auditError } = await supabase.rpc('log_audit_event', {
        p_user_id: user.id,
        p_action: 'app_revoked',
        p_category: 'security',
        p_ip_address: clientIp,
        p_user_agent: userAgent,
        p_metadata: { app_id: appId },
      });

      if (auditError) {
        console.error('[APP-CONNECTIONS] Audit log error:', auditError);
      }

      console.log(`[APP-CONNECTIONS] User revoked app: ${appId}`);

      return jsonResponse(
        {
          success: true,
          message: 'App access revoked',
          app_id: appId,
        },
        200,
        corsHeaders
      );
    }

    return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders);

  } catch (error) {
    console.error('[APP-CONNECTIONS] Unexpected error:', error);
    const corsHeaders = getCorsHeaders(req.headers.get('origin'), { allowedOrigins: ALLOWED_ORIGINS });
    return jsonResponse({ error: 'Internal server error' }, 500, corsHeaders);
  }
});
