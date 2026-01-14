-- ============================================================================
-- STRIPE PURCHASES AND IDENTITY VERIFICATION
-- ============================================================================
-- Adds support for:
-- 1. One-time purchases (credits, unlocks, app features)
-- 2. Identity verification via Stripe Identity
-- ============================================================================

-- ============================================================================
-- USER PURCHASES TABLE
-- ============================================================================
-- Tracks one-time purchases and per-app charges
CREATE TABLE IF NOT EXISTS user_purchases (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- Purchase details
    stripe_payment_intent_id TEXT UNIQUE,
    stripe_invoice_id TEXT,
    product_type TEXT NOT NULL CHECK (product_type IN ('credits', 'unlock', 'app_feature', 'one_time')),
    product_id TEXT NOT NULL,    -- e.g., 'goals_pro_unlock', 'ai_credits_100'
    app_id TEXT,                 -- Which app requested (if applicable)

    -- Amount
    amount_cents INTEGER NOT NULL,
    currency TEXT DEFAULT 'usd',

    -- Status
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'refunded', 'failed')),

    -- Metadata
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_user_purchases_user ON user_purchases(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_purchases_app ON user_purchases(app_id, user_id) WHERE app_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_purchases_product ON user_purchases(product_id, user_id);
CREATE INDEX IF NOT EXISTS idx_user_purchases_payment_intent ON user_purchases(stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_purchases_status ON user_purchases(status) WHERE status = 'pending';

-- ============================================================================
-- IDENTITY VERIFICATION COLUMNS
-- ============================================================================
-- Add identity verification fields to user_profiles
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS identity_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS identity_verification_session_id TEXT;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS identity_verified_at TIMESTAMPTZ;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS identity_verification_level TEXT DEFAULT 'none';

-- Add check constraint for verification level (separate statement for compatibility)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'user_profiles_identity_verification_level_check'
    ) THEN
        ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_identity_verification_level_check
            CHECK (identity_verification_level IN ('none', 'document', 'selfie', 'full'));
    END IF;
END $$;

-- Index for identity verification queries
CREATE INDEX IF NOT EXISTS idx_user_profiles_identity ON user_profiles(identity_verified) WHERE identity_verified = TRUE;

-- ============================================================================
-- ROW LEVEL SECURITY FOR USER_PURCHASES
-- ============================================================================
ALTER TABLE user_purchases ENABLE ROW LEVEL SECURITY;

-- Users can view their own purchases
CREATE POLICY "Users can view own purchases" ON user_purchases
    FOR SELECT USING (auth.uid() = user_id);

-- Users cannot directly insert/update/delete purchases (only via service role)
CREATE POLICY "Service role full access - purchases" ON user_purchases
    FOR ALL USING (auth.role() = 'service_role');

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Check if user has purchased a specific product
CREATE OR REPLACE FUNCTION has_purchased(p_user_id UUID, p_product_id TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM user_purchases
        WHERE user_id = p_user_id
          AND product_id = p_product_id
          AND status = 'completed'
    );
END;
$$;

-- Get user's purchase count for a product (useful for credits)
CREATE OR REPLACE FUNCTION get_purchase_count(p_user_id UUID, p_product_id TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_count
    FROM user_purchases
    WHERE user_id = p_user_id
      AND product_id = p_product_id
      AND status = 'completed';
    RETURN COALESCE(v_count, 0);
END;
$$;

-- Log purchase event
CREATE OR REPLACE FUNCTION log_purchase(
    p_user_id UUID,
    p_payment_intent_id TEXT,
    p_product_type TEXT,
    p_product_id TEXT,
    p_amount_cents INTEGER,
    p_app_id TEXT DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id UUID;
BEGIN
    INSERT INTO user_purchases (
        user_id, stripe_payment_intent_id, product_type, product_id,
        amount_cents, app_id, metadata, status
    )
    VALUES (
        p_user_id, p_payment_intent_id, p_product_type, p_product_id,
        p_amount_cents, p_app_id, p_metadata, 'pending'
    )
    RETURNING id INTO v_id;

    -- Audit log
    PERFORM log_audit_event(
        p_user_id,
        'purchase_initiated',
        'subscription',
        NULL,
        NULL,
        jsonb_build_object(
            'product_id', p_product_id,
            'amount_cents', p_amount_cents,
            'app_id', p_app_id
        )
    );

    RETURN v_id;
END;
$$;

-- Complete a purchase (called by webhook)
CREATE OR REPLACE FUNCTION complete_purchase(p_payment_intent_id TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_purchase RECORD;
BEGIN
    -- Get and update the purchase
    UPDATE user_purchases
    SET status = 'completed',
        completed_at = NOW()
    WHERE stripe_payment_intent_id = p_payment_intent_id
      AND status = 'pending'
    RETURNING * INTO v_purchase;

    IF v_purchase.id IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Audit log
    PERFORM log_audit_event(
        v_purchase.user_id,
        'purchase_completed',
        'subscription',
        NULL,
        NULL,
        jsonb_build_object(
            'product_id', v_purchase.product_id,
            'amount_cents', v_purchase.amount_cents,
            'payment_intent_id', p_payment_intent_id
        )
    );

    RETURN TRUE;
END;
$$;

-- Update identity verification status
CREATE OR REPLACE FUNCTION update_identity_verification(
    p_verification_session_id TEXT,
    p_verified BOOLEAN,
    p_level TEXT DEFAULT 'document'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID;
BEGIN
    -- Find and update the user
    UPDATE user_profiles
    SET identity_verified = p_verified,
        identity_verified_at = CASE WHEN p_verified THEN NOW() ELSE NULL END,
        identity_verification_level = CASE WHEN p_verified THEN p_level ELSE 'none' END
    WHERE identity_verification_session_id = p_verification_session_id
    RETURNING id INTO v_user_id;

    IF v_user_id IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Audit log
    PERFORM log_audit_event(
        v_user_id,
        CASE WHEN p_verified THEN 'identity_verified' ELSE 'identity_verification_failed' END,
        'security',
        NULL,
        NULL,
        jsonb_build_object(
            'verification_session_id', p_verification_session_id,
            'level', p_level
        )
    );

    RETURN TRUE;
END;
$$;

-- ============================================================================
-- GRANTS
-- ============================================================================
GRANT EXECUTE ON FUNCTION has_purchased(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION get_purchase_count(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION log_purchase(UUID, TEXT, TEXT, TEXT, INTEGER, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION complete_purchase(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION update_identity_verification(TEXT, BOOLEAN, TEXT) TO service_role;

-- Allow authenticated users to check their own purchases
GRANT EXECUTE ON FUNCTION has_purchased(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_purchase_count(UUID, TEXT) TO authenticated;
