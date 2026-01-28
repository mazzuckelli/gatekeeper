-- Fix create_pairing_challenge to use extensions.gen_random_bytes
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
    -- Generate secure random challenge using extensions schema
    v_challenge := encode(extensions.gen_random_bytes(32), 'base64');

    INSERT INTO pairing_challenges (user_id, client_app_id, challenge)
    VALUES (p_user_id, p_client_app_id, v_challenge);

    RETURN v_challenge;
END;
$$;

GRANT EXECUTE ON FUNCTION create_pairing_challenge(UUID, TEXT) TO service_role;
