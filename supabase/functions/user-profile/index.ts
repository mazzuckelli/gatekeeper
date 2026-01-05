/**
 * GATEKEEPER: User Profile Endpoint
 *
 * Handles user profile read/update operations.
 * This endpoint knows user_id (Gatekeeper privilege).
 *
 * Endpoints:
 * - GET: Retrieve user profile
 * - PUT/PATCH: Update user profile (limited fields)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  isValidUrl,
  isValidTimezone,
  isValidDisplayName,
  isValidLocale,
} from '../_shared/security.ts';
import {
  handleCors,
  jsonResponse,
  errorResponse,
  getCorsHeaders,
} from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Fields that users are allowed to update
const ALLOWED_UPDATE_FIELDS = [
  'display_name',
  'avatar_url',
  'timezone',
  'locale',
  'marketing_consent',
  'data_retention_consent',
];

interface ProfileUpdate {
  display_name?: string;
  avatar_url?: string;
  timezone?: string;
  locale?: string;
  marketing_consent?: boolean;
  data_retention_consent?: boolean;
  accept_privacy_policy?: boolean;
  privacy_policy_version?: string;
  accept_terms?: boolean;
  terms_version?: string;
}

interface ValidationResult {
  valid: boolean;
  error?: string;
  sanitized?: Record<string, unknown>;
}

/**
 * Validate and sanitize profile update fields
 */
function validateProfileUpdate(body: ProfileUpdate): ValidationResult {
  const sanitized: Record<string, unknown> = {};

  // Validate display_name
  if (body.display_name !== undefined) {
    if (body.display_name === null || body.display_name === '') {
      // Allow clearing display name
      sanitized.display_name = null;
    } else {
      const nameValidation = isValidDisplayName(body.display_name);
      if (!nameValidation.valid) {
        return { valid: false, error: nameValidation.error };
      }
      sanitized.display_name = body.display_name.trim();
    }
  }

  // Validate avatar_url
  if (body.avatar_url !== undefined) {
    if (body.avatar_url === null || body.avatar_url === '') {
      // Allow clearing avatar
      sanitized.avatar_url = null;
    } else {
      if (!isValidUrl(body.avatar_url)) {
        return { valid: false, error: 'Invalid avatar URL format' };
      }
      // Additional check: only allow https URLs for avatars
      if (!body.avatar_url.startsWith('https://')) {
        return { valid: false, error: 'Avatar URL must use HTTPS' };
      }
      sanitized.avatar_url = body.avatar_url;
    }
  }

  // Validate timezone
  if (body.timezone !== undefined) {
    if (body.timezone === null || body.timezone === '') {
      sanitized.timezone = null;
    } else {
      if (!isValidTimezone(body.timezone)) {
        return { valid: false, error: 'Invalid timezone. Use IANA timezone format (e.g., America/New_York)' };
      }
      sanitized.timezone = body.timezone;
    }
  }

  // Validate locale
  if (body.locale !== undefined) {
    if (body.locale === null || body.locale === '') {
      sanitized.locale = null;
    } else {
      if (!isValidLocale(body.locale)) {
        return { valid: false, error: 'Invalid locale format. Use BCP 47 format (e.g., en-US)' };
      }
      sanitized.locale = body.locale;
    }
  }

  // Validate boolean fields
  if (body.marketing_consent !== undefined) {
    if (typeof body.marketing_consent !== 'boolean') {
      return { valid: false, error: 'marketing_consent must be a boolean' };
    }
    sanitized.marketing_consent = body.marketing_consent;
  }

  if (body.data_retention_consent !== undefined) {
    if (typeof body.data_retention_consent !== 'boolean') {
      return { valid: false, error: 'data_retention_consent must be a boolean' };
    }
    sanitized.data_retention_consent = body.data_retention_consent;
  }

  // Handle legal acceptances
  if (body.accept_privacy_policy === true) {
    sanitized.privacy_policy_accepted_at = new Date().toISOString();
    sanitized.privacy_policy_version = body.privacy_policy_version || '1.0';
  }

  if (body.accept_terms === true) {
    sanitized.terms_accepted_at = new Date().toISOString();
    sanitized.terms_version = body.terms_version || '1.0';
  }

  return { valid: true, sanitized };
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');

  // Handle CORS preflight
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    // 1. AUTHENTICATE USER
    const authHeader = req.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return errorResponse('Missing authorization header', 401, origin);
    }

    // Create Supabase client with the user's auth header
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
      global: {
        headers: { Authorization: authHeader },
      },
    });

    // Validate the user's token
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      console.error('[USER-PROFILE] Auth error:', authError?.message, authError?.status);
      return jsonResponse({
        error: 'Invalid or expired token',
        code: 401,
        details: authError?.message
      }, 401, origin);
    }

    // 2. HANDLE REQUEST METHOD
    if (req.method === 'GET') {
      // Fetch profile
      const { data: profile, error: fetchError } = await supabase
        .from('user_profiles')
        .select(`
          display_name,
          avatar_url,
          timezone,
          locale,
          subscription_tier,
          subscription_status,
          subscription_expires_at,
          features,
          created_at,
          last_seen_at,
          marketing_consent,
          data_retention_consent,
          privacy_policy_accepted_at,
          privacy_policy_version,
          terms_accepted_at,
          terms_version
        `)
        .eq('id', user.id)
        .single();

      if (fetchError) {
        console.error('[PROFILE] Fetch error:', fetchError);
        return errorResponse('Failed to fetch profile', 500, origin);
      }

      // Update last_seen
      const { error: updateError } = await supabase
        .from('user_profiles')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('id', user.id);

      if (updateError) {
        console.error('[PROFILE] Last seen update error:', updateError);
        // Don't fail the request for this
      }

      return jsonResponse(
        {
          email: user.email,
          ...profile,
        },
        200,
        origin
      );

    } else if (req.method === 'PUT' || req.method === 'PATCH') {
      // Parse and validate request body
      let body: ProfileUpdate;
      try {
        body = await req.json();
      } catch {
        return errorResponse('Invalid JSON body', 400, origin);
      }

      // Validate and sanitize updates
      const validation = validateProfileUpdate(body);
      if (!validation.valid) {
        return errorResponse(validation.error || 'Validation failed', 400, origin);
      }

      const updates = validation.sanitized!;

      if (Object.keys(updates).length === 0) {
        return jsonResponse(
          { error: 'No valid fields to update', allowed_fields: ALLOWED_UPDATE_FIELDS },
          400,
          origin
        );
      }

      // Perform update
      const { data: updated, error: updateError } = await supabase
        .from('user_profiles')
        .update(updates)
        .eq('id', user.id)
        .select()
        .single();

      if (updateError) {
        console.error('[PROFILE] Update error:', updateError);
        return errorResponse('Failed to update profile', 500, origin);
      }

      // Log audit event
      const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
      const userAgent = req.headers.get('user-agent') || null;

      const { error: auditError } = await supabase.rpc('log_audit_event', {
        p_user_id: user.id,
        p_action: 'profile_updated',
        p_category: 'profile',
        p_ip_address: clientIp,
        p_user_agent: userAgent,
        p_metadata: { fields_updated: Object.keys(updates) },
      });

      if (auditError) {
        console.error('[PROFILE] Audit log error:', auditError);
      }

      return jsonResponse(
        {
          success: true,
          profile: updated,
        },
        200,
        origin
      );

    } else {
      return errorResponse('Method not allowed', 405, origin);
    }

  } catch (error) {
    console.error('[PROFILE] Unexpected error:', error);
    return errorResponse('Internal server error', 500, origin);
  }
});
