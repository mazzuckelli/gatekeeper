-- ============================================================================
-- FIRST-PARTY APP SUPPORT
-- ============================================================================
-- First-party apps (like Xenon Totem, Goals, Fingerprint) work seamlessly
-- without requiring user consent screens. They're trusted apps from the
-- same organization that share authentication automatically.
--
-- Key difference from third-party apps:
-- - No consent screen required
-- - Auto-authorized on first login
-- - Still use ghost_id for privacy (apps can't correlate users)
-- ============================================================================

-- Add first-party flag to registered_apps
ALTER TABLE registered_apps
ADD COLUMN IF NOT EXISTS is_first_party BOOLEAN DEFAULT FALSE;

-- Add icon URL for app display
ALTER TABLE registered_apps
ADD COLUMN IF NOT EXISTS app_icon_url TEXT;

-- Update the requires_user_consent logic: first-party apps never need consent
COMMENT ON COLUMN registered_apps.is_first_party IS
'First-party apps are auto-authorized without consent screens. They share auth seamlessly but still use ghost_id for privacy.';

-- Function to auto-authorize first-party apps
-- Call this when a user authenticates and tries to access a first-party app
CREATE OR REPLACE FUNCTION auto_authorize_first_party_app(
    p_user_id UUID,
    p_app_id TEXT
)
RETURNS TABLE (
    connection_id UUID,
    auto_authorized BOOLEAN,
    granted_scopes TEXT[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_app_uuid UUID;
    v_is_first_party BOOLEAN;
    v_connection_id UUID;
    v_granted_scopes TEXT[];
BEGIN
    -- Get app info
    SELECT ra.id, ra.is_first_party, ra.allowed_scopes
    INTO v_app_uuid, v_is_first_party, v_granted_scopes
    FROM registered_apps ra
    WHERE ra.app_id = p_app_id AND ra.is_active = TRUE;

    IF v_app_uuid IS NULL THEN
        RAISE EXCEPTION 'App not found or inactive: %', p_app_id;
    END IF;

    -- Check if connection already exists
    SELECT uac.id INTO v_connection_id
    FROM user_app_connections uac
    WHERE uac.user_id = p_user_id AND uac.app_id = v_app_uuid AND uac.is_active = TRUE;

    IF v_connection_id IS NOT NULL THEN
        -- Already connected
        SELECT uac.granted_scopes INTO v_granted_scopes
        FROM user_app_connections uac
        WHERE uac.id = v_connection_id;

        RETURN QUERY SELECT v_connection_id, FALSE, v_granted_scopes;
        RETURN;
    END IF;

    -- If first-party, auto-authorize with all allowed scopes
    IF v_is_first_party THEN
        INSERT INTO user_app_connections (user_id, app_id, granted_scopes)
        VALUES (p_user_id, v_app_uuid, v_granted_scopes)
        RETURNING id INTO v_connection_id;

        -- Update app stats
        UPDATE registered_apps
        SET total_users_connected = total_users_connected + 1
        WHERE id = v_app_uuid;

        -- Log the auto-authorization
        PERFORM log_audit_event(
            p_user_id,
            'app_auto_authorized',
            'auth',
            NULL,
            NULL,
            jsonb_build_object('app_id', p_app_id, 'reason', 'first_party')
        );

        RETURN QUERY SELECT v_connection_id, TRUE, v_granted_scopes;
        RETURN;
    END IF;

    -- Not first-party and no existing connection - return null (needs consent)
    RETURN QUERY SELECT NULL::UUID, FALSE, NULL::TEXT[];
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION auto_authorize_first_party_app(UUID, TEXT) TO service_role;

-- ============================================================================
-- SEED: Register Xenon Totem as first-party app
-- ============================================================================
-- Run this in SQL editor after migration to get the credentials:
--
-- SELECT * FROM register_app(
--     'xenon-totem',
--     'Xenon Totem',
--     'admin@xenontotem.com',
--     ARRAY['xenon://auth/callback', 'exp://localhost:8081/--/auth/callback'],
--     ARRAY['https://xenon-engine-web.vercel.app', 'http://localhost:8081'],
--     NULL,  -- owner_user_id (set after you register)
--     'Xenon',
--     'Privacy-preserving personal data and habit tracking'
-- );
--
-- Then mark it as first-party:
-- UPDATE registered_apps SET is_first_party = TRUE, is_verified = TRUE WHERE app_id = 'xenon-totem';
