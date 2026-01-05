-- ============================================================================
-- GATEKEEPER SIMPLIFICATION FOR DAWG TAG ARCHITECTURE
-- ============================================================================
--
-- With Dawg Tag as the identity bridge, Gatekeeper becomes auth-only.
-- Ghost IDs, blind tokens, and app connections are now handled by Dawg Tag.
--
-- WHAT'S REMOVED:
-- - blind_token_log: Dawg Tag handles tokens locally
-- - user_app_connections: Dawg Tag manages app authorizations locally
--
-- WHAT'S KEPT:
-- - user_profiles: Subscription tiers, Stripe integration
-- - registered_apps: First-party app configuration (may use for settings)
-- - audit_logs: Security and compliance logging
-- - rate_limits: Abuse prevention
--
-- ============================================================================

-- Drop blind_token_log table (tokens now handled by Dawg Tag)
DROP TABLE IF EXISTS blind_token_log CASCADE;

-- Drop user_app_connections table (Dawg Tag manages locally)
DROP TABLE IF EXISTS user_app_connections CASCADE;

-- Drop related functions that are no longer needed
DROP FUNCTION IF EXISTS register_app CASCADE;
DROP FUNCTION IF EXISTS auto_authorize_first_party_app CASCADE;
DROP FUNCTION IF EXISTS log_token_issuance CASCADE;
DROP FUNCTION IF EXISTS revoke_token CASCADE;
DROP FUNCTION IF EXISTS revoke_all_user_tokens CASCADE;
DROP FUNCTION IF EXISTS get_user_active_tokens CASCADE;

-- Add increment_rate_limit function for auth-validate endpoint
CREATE OR REPLACE FUNCTION increment_rate_limit(
    p_identifier TEXT,
    p_action TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO rate_limits (identifier, action, count, window_start)
    VALUES (p_identifier, p_action, 1, date_trunc('minute', NOW()))
    ON CONFLICT (identifier, action, window_start)
    DO UPDATE SET count = rate_limits.count + 1;
END;
$$;

-- Grant execute to service role
GRANT EXECUTE ON FUNCTION increment_rate_limit(TEXT, TEXT) TO service_role;

-- Add cleanup function for old rate limit entries
CREATE OR REPLACE FUNCTION cleanup_old_rate_limits()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    DELETE FROM rate_limits
    WHERE window_start < NOW() - INTERVAL '1 hour';
END;
$$;

GRANT EXECUTE ON FUNCTION cleanup_old_rate_limits() TO service_role;

-- Update comments to reflect new architecture
COMMENT ON TABLE user_profiles IS 'User profiles with subscription info. Gatekeeper knows WHO you are (identity), never WHAT you do (behavior).';
COMMENT ON TABLE registered_apps IS 'App registry for both first-party and third-party apps. Developers register apps here via the web portal. User authorization of apps is handled by Dawg Tag locally.';
COMMENT ON TABLE audit_logs IS 'Security audit trail. Logs auth events but NEVER behavioral data or ghost_ids.';
COMMENT ON TABLE rate_limits IS 'Rate limiting for abuse prevention on auth endpoints.';

-- ============================================================================
-- GATEKEEPER'S NEW ROLE:
-- ============================================================================
-- 1. Authenticate users (email/password, passkey)
-- 2. Return user_id to Dawg Tag (transiently, for ghost_id computation)
-- 3. Manage subscriptions and billing
-- 4. Provide rate limiting and audit logging
--
-- Gatekeeper NEVER knows:
-- - ghost_secret (only on Dawg Tag device)
-- - ghost_id (computed on Dawg Tag, never sent here)
-- - Which apps the user accesses (Dawg Tag handles that)
-- - What the user does in any app (Goals handles that)
-- ============================================================================
