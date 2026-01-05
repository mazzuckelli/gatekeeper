-- ============================================================================
-- PASSKEY (WEBAUTHN) SUPPORT
-- ============================================================================
--
-- Enables passwordless authentication via WebAuthn passkeys.
-- Users can register multiple passkeys (phone, laptop, security key).
--
-- ============================================================================

-- Create user_passkeys table
CREATE TABLE IF NOT EXISTS user_passkeys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- WebAuthn credential data
    credential_id TEXT NOT NULL UNIQUE,
    public_key TEXT NOT NULL,
    counter INTEGER NOT NULL DEFAULT 0,

    -- Credential metadata
    device_name TEXT,
    authenticator_type TEXT, -- 'platform' (built-in) or 'cross-platform' (security key)
    transports TEXT[], -- ['internal', 'usb', 'ble', 'nfc']

    -- Status
    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,

    -- Constraints
    CONSTRAINT credential_id_format CHECK (LENGTH(credential_id) >= 16)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_user_passkeys_user_id ON user_passkeys(user_id);
CREATE INDEX IF NOT EXISTS idx_user_passkeys_credential_id ON user_passkeys(credential_id);
CREATE INDEX IF NOT EXISTS idx_user_passkeys_active ON user_passkeys(user_id, is_active) WHERE is_active = TRUE;

-- RLS Policies
ALTER TABLE user_passkeys ENABLE ROW LEVEL SECURITY;

-- Users can only see their own passkeys
CREATE POLICY "Users can view own passkeys"
    ON user_passkeys FOR SELECT
    USING (auth.uid() = user_id);

-- Users can insert their own passkeys
CREATE POLICY "Users can register passkeys"
    ON user_passkeys FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Users can update their own passkeys (rename, deactivate)
CREATE POLICY "Users can update own passkeys"
    ON user_passkeys FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Users can delete their own passkeys
CREATE POLICY "Users can delete own passkeys"
    ON user_passkeys FOR DELETE
    USING (auth.uid() = user_id);

-- Service role can do everything (for auth endpoints)
CREATE POLICY "Service role full access to passkeys"
    ON user_passkeys FOR ALL
    TO service_role
    USING (TRUE)
    WITH CHECK (TRUE);

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON user_passkeys TO authenticated;
GRANT ALL ON user_passkeys TO service_role;

-- ============================================================================
-- PASSKEY REGISTRATION ENDPOINT SUPPORT
-- ============================================================================
-- Note: Passkey registration is handled by a separate endpoint that:
-- 1. Generates a registration challenge
-- 2. Receives the signed credential from the client
-- 3. Stores the public key in user_passkeys
--
-- This migration only creates the storage. The registration endpoint
-- will be created when needed.
-- ============================================================================

-- Comment on table
COMMENT ON TABLE user_passkeys IS 'WebAuthn passkey credentials for passwordless authentication. Each user can have multiple passkeys.';
COMMENT ON COLUMN user_passkeys.credential_id IS 'Base64url-encoded credential ID from WebAuthn registration';
COMMENT ON COLUMN user_passkeys.public_key IS 'Base64-encoded SPKI public key for signature verification';
COMMENT ON COLUMN user_passkeys.counter IS 'Signature counter for replay attack prevention';
