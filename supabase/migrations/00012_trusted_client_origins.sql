-- ============================================================================
-- TRUSTED CLIENT ORIGINS
-- ============================================================================
-- Stores APK fingerprints (origins) for client apps that can use a user's
-- passkey for authentication. This enables Dawg Tag to authenticate via
-- Gatekeeper's passkey system even though it has a different APK signing key.
--
-- Flow:
-- 1. User pairs Dawg Tag from Gatekeeper mobile
-- 2. Dawg Tag's APK fingerprint is stored here
-- 3. When Dawg Tag tries passkey auth, passkey-auth checks this table
-- 4. If origin is trusted for this user, authentication proceeds
-- ============================================================================

CREATE TABLE IF NOT EXISTS trusted_client_origins (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- Client app identification
    client_app_id TEXT NOT NULL,  -- e.g., 'dawg-tag'
    client_app_name TEXT,         -- Display name

    -- The WebAuthn origin (android:apk-key-hash:... format)
    origin TEXT NOT NULL,

    -- Status
    is_active BOOLEAN DEFAULT TRUE,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,

    -- Prevent duplicate origins per user
    UNIQUE(user_id, origin)
);

-- Index for fast lookups during passkey auth
CREATE INDEX IF NOT EXISTS idx_trusted_client_origins_user
    ON trusted_client_origins(user_id) WHERE is_active = TRUE;

-- RLS
ALTER TABLE trusted_client_origins ENABLE ROW LEVEL SECURITY;

-- Users can view their own trusted origins
CREATE POLICY "Users can view own trusted origins" ON trusted_client_origins
    FOR SELECT USING (auth.uid() = user_id);

-- Users can delete their own trusted origins
CREATE POLICY "Users can delete own trusted origins" ON trusted_client_origins
    FOR DELETE USING (auth.uid() = user_id);

-- Service role has full access
CREATE POLICY "Service role full access - trusted_client_origins" ON trusted_client_origins
    FOR ALL USING (auth.role() = 'service_role');

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

-- Add a trusted client origin for a user
CREATE OR REPLACE FUNCTION add_trusted_client_origin(
    p_user_id UUID,
    p_client_app_id TEXT,
    p_client_app_name TEXT,
    p_origin TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id UUID;
BEGIN
    INSERT INTO trusted_client_origins (user_id, client_app_id, client_app_name, origin)
    VALUES (p_user_id, p_client_app_id, p_client_app_name, p_origin)
    ON CONFLICT (user_id, origin) DO UPDATE
    SET is_active = TRUE,
        client_app_name = EXCLUDED.client_app_name,
        last_used_at = NOW()
    RETURNING id INTO v_id;

    -- Log the pairing
    INSERT INTO audit_logs (user_id, action, action_category, metadata)
    VALUES (p_user_id, 'client_origin_trusted', 'security', jsonb_build_object(
        'client_app_id', p_client_app_id,
        'origin', p_origin
    ));

    RETURN v_id;
END;
$$;

-- Get all trusted origins for a user (for passkey verification)
CREATE OR REPLACE FUNCTION get_user_trusted_origins(p_user_id UUID)
RETURNS TEXT[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_origins TEXT[];
BEGIN
    SELECT ARRAY_AGG(tco.origin)
    INTO v_origins
    FROM trusted_client_origins tco
    WHERE tco.user_id = p_user_id AND tco.is_active = TRUE;

    RETURN COALESCE(v_origins, ARRAY[]::TEXT[]);
END;
$$;

-- Grants
GRANT EXECUTE ON FUNCTION add_trusted_client_origin(UUID, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION get_user_trusted_origins(UUID) TO service_role;

-- ============================================================================
-- PAIRING CHALLENGES
-- ============================================================================
-- Short-lived tokens for secure pairing handshake

CREATE TABLE IF NOT EXISTS pairing_challenges (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- Challenge data
    challenge TEXT NOT NULL UNIQUE,
    client_app_id TEXT NOT NULL,

    -- Expiry (5 minutes)
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '5 minutes'),

    -- Status
    consumed_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pairing_challenges_challenge
    ON pairing_challenges(challenge) WHERE consumed_at IS NULL;

-- RLS
ALTER TABLE pairing_challenges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access - pairing_challenges" ON pairing_challenges
    FOR ALL USING (auth.role() = 'service_role');

-- Function to create a pairing challenge
CREATE OR REPLACE FUNCTION create_pairing_challenge(
    p_user_id UUID,
    p_client_app_id TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_challenge TEXT;
BEGIN
    -- Generate secure random challenge (use extensions.gen_random_bytes or public.gen_random_bytes)
    v_challenge := encode(extensions.gen_random_bytes(32), 'base64');

    INSERT INTO pairing_challenges (user_id, client_app_id, challenge)
    VALUES (p_user_id, p_client_app_id, v_challenge);

    RETURN v_challenge;
END;
$$;

-- Function to consume a pairing challenge and return user info
CREATE OR REPLACE FUNCTION consume_pairing_challenge(p_challenge TEXT)
RETURNS TABLE (
    user_id UUID,
    client_app_id TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID;
    v_client_app_id TEXT;
BEGIN
    UPDATE pairing_challenges pc
    SET consumed_at = NOW()
    WHERE pc.challenge = p_challenge
    AND pc.consumed_at IS NULL
    AND pc.expires_at > NOW()
    RETURNING pc.user_id, pc.client_app_id INTO v_user_id, v_client_app_id;

    IF v_user_id IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY SELECT v_user_id, v_client_app_id;
END;
$$;

-- Grants
GRANT EXECUTE ON FUNCTION create_pairing_challenge(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION consume_pairing_challenge(TEXT) TO service_role;
