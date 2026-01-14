/**
 * GATEKEEPER: Create Stripe Payment Intent
 *
 * Creates a Stripe PaymentIntent for one-time purchases (credits, unlocks, etc.).
 * User must be authenticated via JWT.
 *
 * Request body:
 * - product_id: Internal product identifier (e.g., 'ai_credits_100')
 * - product_type: Type of purchase ('credits', 'unlock', 'app_feature', 'one_time')
 * - amount_cents: Amount in cents
 * - currency: Currency code (default: 'usd')
 * - app_id: (optional) Which app is requesting
 * - metadata: (optional) Additional metadata
 *
 * Response:
 * - client_secret: PaymentIntent client secret for Stripe Elements
 * - payment_intent_id: PaymentIntent ID
 * - purchase_id: Our internal purchase record ID
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

// Valid product types
const VALID_PRODUCT_TYPES = ['credits', 'unlock', 'app_feature', 'one_time'];

interface PaymentRequest {
  product_id: string;
  product_type: string;
  amount_cents: number;
  currency?: string;
  app_id?: string;
  metadata?: Record<string, string>;
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
      console.error('[PAYMENT] Stripe not configured');
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
      console.error('[PAYMENT] Auth error:', authError?.message);
      return errorResponse('Invalid or expired token', 401, origin);
    }

    // 2. PARSE REQUEST
    let body: PaymentRequest;
    try {
      body = await req.json();
    } catch {
      return errorResponse('Invalid JSON body', 400, origin);
    }

    const {
      product_id,
      product_type,
      amount_cents,
      currency = 'usd',
      app_id,
      metadata = {},
    } = body;

    // 3. VALIDATE INPUT
    if (!product_id) {
      return errorResponse('product_id is required', 400, origin);
    }
    if (!product_type || !VALID_PRODUCT_TYPES.includes(product_type)) {
      return errorResponse(
        `product_type must be one of: ${VALID_PRODUCT_TYPES.join(', ')}`,
        400,
        origin
      );
    }
    if (!amount_cents || amount_cents < 50) {
      return errorResponse('amount_cents must be at least 50 (50 cents)', 400, origin);
    }
    if (amount_cents > 99999999) {
      return errorResponse('amount_cents exceeds maximum', 400, origin);
    }

    // 4. GET OR CREATE STRIPE CUSTOMER
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('stripe_customer_id')
      .eq('id', user.id)
      .single();

    let customerId = profile?.stripe_customer_id;

    if (!customerId) {
      // Create a new Stripe customer
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: {
          user_id: user.id,
        },
      });
      customerId = customer.id;

      // Save customer ID to profile
      await supabase
        .from('user_profiles')
        .update({ stripe_customer_id: customerId })
        .eq('id', user.id);

      console.log(`[PAYMENT] Created Stripe customer ${customerId} for user ${user.id}`);
    }

    // 5. CREATE PAYMENT INTENT
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount_cents,
      currency: currency.toLowerCase(),
      customer: customerId,
      metadata: {
        user_id: user.id,
        product_id: product_id,
        product_type: product_type,
        app_id: app_id || '',
        ...metadata,
      },
      automatic_payment_methods: {
        enabled: true,
      },
    });

    console.log(`[PAYMENT] PaymentIntent created: ${paymentIntent.id} for user ${user.id}`);

    // 6. LOG PURCHASE IN DATABASE
    const { data: purchaseRecord, error: purchaseError } = await supabase.rpc('log_purchase', {
      p_user_id: user.id,
      p_payment_intent_id: paymentIntent.id,
      p_product_type: product_type,
      p_product_id: product_id,
      p_amount_cents: amount_cents,
      p_app_id: app_id || null,
      p_metadata: metadata,
    });

    if (purchaseError) {
      console.error('[PAYMENT] Failed to log purchase:', purchaseError);
      // Don't fail the request - payment can still be processed
    }

    // 7. RETURN CLIENT SECRET
    return jsonResponse(
      {
        client_secret: paymentIntent.client_secret,
        payment_intent_id: paymentIntent.id,
        purchase_id: purchaseRecord || null,
      },
      200,
      origin
    );

  } catch (error) {
    console.error('[PAYMENT] Error:', error);

    // Handle Stripe-specific errors
    if (error instanceof Stripe.errors.StripeError) {
      return errorResponse(`Stripe error: ${error.message}`, 400, origin);
    }

    return errorResponse('Internal server error', 500, origin);
  }
});
