/**
 * GATEKEEPER: Create Stripe Customer Portal Session
 *
 * Creates a Stripe Customer Portal session for subscription management.
 * User must be authenticated and have an existing Stripe customer ID.
 *
 * Request body:
 * - return_url: URL to return to after portal session
 *
 * Response:
 * - url: Stripe Customer Portal URL to redirect user
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

interface PortalRequest {
  return_url: string;
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
      console.error('[PORTAL] Stripe not configured');
      return errorResponse('Payment system not configured', 500, origin);
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
      console.error('[PORTAL] Auth error:', authError?.message);
      return errorResponse('Invalid or expired token', 401, origin);
    }

    // 2. PARSE REQUEST
    let body: PortalRequest;
    try {
      body = await req.json();
    } catch {
      return errorResponse('Invalid JSON body', 400, origin);
    }

    const { return_url } = body;

    if (!return_url) {
      return errorResponse('return_url is required', 400, origin);
    }

    // 3. GET USER PROFILE
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('stripe_customer_id')
      .eq('id', user.id)
      .single();

    if (profileError) {
      console.error('[PORTAL] Profile fetch error:', profileError);
      return errorResponse('Failed to fetch user profile', 500, origin);
    }

    if (!profile?.stripe_customer_id) {
      return errorResponse(
        'No subscription found. Please subscribe first.',
        400,
        origin
      );
    }

    // 4. CREATE PORTAL SESSION
    const session = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: return_url,
    });

    console.log(`[PORTAL] Session created for user ${user.id}: ${session.id}`);

    // 5. AUDIT LOG
    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
    await supabase.rpc('log_audit_event', {
      p_user_id: user.id,
      p_action: 'portal_session_created',
      p_category: 'subscription',
      p_ip_address: clientIp,
      p_user_agent: req.headers.get('user-agent'),
      p_metadata: {
        session_id: session.id,
      },
    });

    // 6. RETURN SESSION URL
    return jsonResponse(
      {
        url: session.url,
      },
      200,
      origin
    );

  } catch (error) {
    console.error('[PORTAL] Error:', error);

    // Handle Stripe-specific errors
    if (error instanceof Stripe.errors.StripeError) {
      return errorResponse(`Stripe error: ${error.message}`, 400, origin);
    }

    return errorResponse('Internal server error', 500, origin);
  }
});
