/**
 * GATEKEEPER: Create Stripe Identity Verification Session
 *
 * Creates a Stripe Identity VerificationSession for KYC verification.
 * User must be authenticated via JWT.
 *
 * Request body:
 * - return_url: URL to return to after verification (for web)
 * - verification_type: 'document' | 'selfie' | 'full' (default: 'document')
 *
 * Response:
 * - verification_session_id: Stripe VerificationSession ID
 * - client_secret: For web SDK integration
 * - ephemeral_key_secret: For mobile SDK integration
 * - url: Direct URL to hosted verification (for web redirect)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14.14.0?target=deno';
import {
  handleCors,
  jsonResponse,
  errorResponse,
} from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY');

// Initialize Stripe
const stripe = STRIPE_SECRET_KEY
  ? new Stripe(STRIPE_SECRET_KEY, {
      apiVersion: '2023-10-16',
      httpClient: Stripe.createFetchHttpClient(),
    })
  : null;

type VerificationType = 'document' | 'selfie' | 'full';

interface VerificationRequest {
  return_url?: string;
  verification_type?: VerificationType;
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');

  // Handle CORS preflight
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  // Only accept POST
  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405, origin);
  }

  try {
    // Check Stripe configuration
    if (!stripe || !STRIPE_SECRET_KEY) {
      console.error('[IDENTITY] Stripe not configured');
      return errorResponse('Verification system not configured', 500, origin);
    }

    // 1. AUTHENTICATE USER
    const authHeader = req.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return errorResponse('Missing authorization header', 401, origin);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
      global: {
        headers: { Authorization: authHeader },
      },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      console.error('[IDENTITY] Auth error:', authError?.message);
      return errorResponse('Invalid or expired token', 401, origin);
    }

    // 2. CHECK EXISTING VERIFICATION STATUS
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('identity_verified, identity_verification_session_id')
      .eq('id', user.id)
      .single();

    if (profile?.identity_verified) {
      return jsonResponse(
        {
          already_verified: true,
          message: 'User identity is already verified',
        },
        200,
        origin
      );
    }

    // 3. PARSE REQUEST
    let body: VerificationRequest = {};
    try {
      body = await req.json();
    } catch {
      // Empty body is OK, we have defaults
    }

    const { return_url, verification_type = 'document' } = body;

    // Validate verification type
    if (!['document', 'selfie', 'full'].includes(verification_type)) {
      return errorResponse(
        'verification_type must be one of: document, selfie, full',
        400,
        origin
      );
    }

    // 4. BUILD VERIFICATION OPTIONS
    const options: Stripe.Identity.VerificationSessionCreateParams['options'] = {};

    switch (verification_type) {
      case 'document':
        options.document = {
          require_id_number: false,
          require_matching_selfie: false,
        };
        break;
      case 'selfie':
        options.document = {
          require_id_number: false,
          require_matching_selfie: true,
        };
        break;
      case 'full':
        options.document = {
          require_id_number: true,
          require_matching_selfie: true,
        };
        break;
    }

    // 5. CREATE VERIFICATION SESSION
    const sessionParams: Stripe.Identity.VerificationSessionCreateParams = {
      type: 'document',
      metadata: {
        user_id: user.id,
        verification_type: verification_type,
      },
      options: options,
    };

    // Add return URL if provided (for hosted verification)
    if (return_url) {
      sessionParams.return_url = return_url;
    }

    const verificationSession = await stripe.identity.verificationSessions.create(sessionParams);

    console.log(`[IDENTITY] Session created: ${verificationSession.id} for user ${user.id}`);

    // 6. STORE SESSION ID IN PROFILE
    const { error: updateError } = await supabase
      .from('user_profiles')
      .update({
        identity_verification_session_id: verificationSession.id,
      })
      .eq('id', user.id);

    if (updateError) {
      console.error('[IDENTITY] Failed to store session ID:', updateError);
      // Don't fail - session is still valid
    }

    // 7. AUDIT LOG
    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
    await supabase.rpc('log_audit_event', {
      p_user_id: user.id,
      p_action: 'identity_verification_started',
      p_category: 'security',
      p_ip_address: clientIp,
      p_user_agent: req.headers.get('user-agent'),
      p_metadata: {
        session_id: verificationSession.id,
        verification_type: verification_type,
      },
    });

    // 8. RETURN SESSION DETAILS
    return jsonResponse(
      {
        verification_session_id: verificationSession.id,
        client_secret: verificationSession.client_secret,
        url: verificationSession.url, // Hosted verification URL
        status: verificationSession.status,
      },
      200,
      origin
    );

  } catch (error) {
    console.error('[IDENTITY] Error:', error);

    // Handle Stripe-specific errors
    if (error instanceof Stripe.errors.StripeError) {
      // Check if Identity is not enabled
      if (error.message.includes('Identity')) {
        return errorResponse(
          'Identity verification is not enabled for this account',
          400,
          origin
        );
      }
      return errorResponse(`Stripe error: ${error.message}`, 400, origin);
    }

    return errorResponse('Internal server error', 500, origin);
  }
});
