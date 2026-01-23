-- ============================================================================
-- FIX USER_PURCHASES RLS POLICIES
-- ============================================================================
-- Issues fixed:
-- 1. auth.uid() and auth.role() re-evaluate for each row - use (select ...) to cache
-- 2. Multiple permissive policies for same role/action - consolidate
-- ============================================================================

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view own purchases" ON user_purchases;
DROP POLICY IF EXISTS "Service role full access - purchases" ON user_purchases;

-- Recreate with optimized auth checks (using select to cache the result)
-- Users can only view their own purchases
CREATE POLICY "Users can view own purchases" ON user_purchases
    FOR SELECT
    TO authenticated
    USING ((select auth.uid()) = user_id);

-- Service role has full access (separate policies for each action to avoid overlap)
CREATE POLICY "Service role can select purchases" ON user_purchases
    FOR SELECT
    TO service_role
    USING (true);

CREATE POLICY "Service role can insert purchases" ON user_purchases
    FOR INSERT
    TO service_role
    WITH CHECK (true);

CREATE POLICY "Service role can update purchases" ON user_purchases
    FOR UPDATE
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role can delete purchases" ON user_purchases
    FOR DELETE
    TO service_role
    USING (true);
