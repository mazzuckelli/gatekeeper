-- ============================================================================
-- GATEKEEPER: Remove duplicate index on registered_apps
-- ============================================================================
-- Both idx_registered_apps_owner and idx_registered_apps_owner_user_id
-- index the same column (owner_user_id). Duplicate indexes waste storage
-- and slow down writes without improving reads.
-- ============================================================================

-- Keep idx_registered_apps_owner_user_id (clearer naming), drop the duplicate
DROP INDEX IF EXISTS public.idx_registered_apps_owner;

-- Refresh statistics after index change
ANALYZE public.registered_apps;

-- Verify only one index remains on owner_user_id
DO $$
DECLARE
  idx_count integer;
BEGIN
  SELECT COUNT(*) INTO idx_count
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename = 'registered_apps'
    AND indexdef LIKE '%owner_user_id%';

  RAISE NOTICE 'Indexes on owner_user_id column: %', idx_count;

  IF idx_count > 1 THEN
    RAISE WARNING 'Still have % duplicate indexes on owner_user_id', idx_count;
  END IF;
END $$;
