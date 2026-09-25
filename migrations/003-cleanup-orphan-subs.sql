-- Migration 003: Clean up orphan/duplicate ip_subscriptions
-- Execute in Supabase Dashboard > SQL Editor
-- Marks subscriptions without user_id as 'orphaned' (keeps for audit, doesn't delete)

-- Step 1: Mark subscriptions with NULL user_id as orphaned
UPDATE ip_subscriptions
SET status = 'orphaned'
WHERE user_id IS NULL
  AND status = 'active';

-- Step 2: For duplicate subscriptions per user+ip, keep the most recent and mark older ones
-- NOTE: MIN(uuid) doesn't exist in PostgreSQL — use ROW_NUMBER() instead
UPDATE ip_subscriptions
SET status = 'duplicate'
WHERE id IN (
  SELECT id FROM (
    SELECT id,
      ROW_NUMBER() OVER (PARTITION BY ip, user_id ORDER BY created_at DESC) as rn
    FROM ip_subscriptions
    WHERE status = 'active' AND user_id IS NOT NULL
  ) ranked
  WHERE rn > 1
);

-- Step 3: Verify results
SELECT status, COUNT(*) as count
FROM ip_subscriptions
GROUP BY status
ORDER BY count DESC;