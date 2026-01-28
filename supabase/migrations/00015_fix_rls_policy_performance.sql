-- ============================================================================
-- FIX RLS POLICY PERFORMANCE
-- ============================================================================
-- Supabase warns that policies using auth.uid() or auth.role() directly
-- re-evaluate for each row. Wrapping in (select ...) caches the value.
-- ============================================================================

-- Drop existing policies on trusted_client_origins
DROP POLICY IF EXISTS "Users can view own trusted origins" ON trusted_client_origins;
DROP POLICY IF EXISTS "Users can delete own trusted origins" ON trusted_client_origins;
DROP POLICY IF EXISTS "Service role full access - trusted_client_origins" ON trusted_client_origins;

-- Recreate with optimized auth checks
CREATE POLICY "Users can view own trusted origins" ON trusted_client_origins
    FOR SELECT USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can delete own trusted origins" ON trusted_client_origins
    FOR DELETE USING ((select auth.uid()) = user_id);

CREATE POLICY "Service role full access - trusted_client_origins" ON trusted_client_origins
    FOR ALL USING ((select auth.role()) = 'service_role');

-- Drop existing policy on pairing_challenges
DROP POLICY IF EXISTS "Service role full access - pairing_challenges" ON pairing_challenges;

-- Recreate with optimized auth check
CREATE POLICY "Service role full access - pairing_challenges" ON pairing_challenges
    FOR ALL USING ((select auth.role()) = 'service_role');
