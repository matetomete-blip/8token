-- Migration 003: Clean up orphan/duplicate ip_subscriptions
-- Execute in Supabase Dashboard > SQL Editor
-- Marks subscriptions without user_id as 'orphaned' (keeps for audit, doesn't delete)

-- Step 1: Mark subscriptions with NULL user_id as orphaned
UPDATE ip_subscriptions
SET status = 'orphaned'
WHERE user_id IS NULL
  AND status = 'active';

-- Step 2: For IPs with multiple active subscriptions, keep only the one with a valid user_id
-- and mark duplicates as 'duplicate'
UPDATE ip_subscriptions
SET status = 'duplicate'
WHERE id IN (
  SELECT sub.id
  FROM ip_subscriptions sub
  INNER JOIN (
    SELECT ip, MIN(id) as keep_id
    FROM ip_subscriptions
    WHERE status = 'active' AND user_id IS NOT NULL
    GROUP BY ip
    HAVING COUNT(*) > 1
  ) dup ON sub.ip = dup.ip AND sub.id != dup.keep_id
  WHERE sub.status = 'active'
);

-- Step 3: Verify results
SELECT status, COUNT(*) as count
FROM ip_subscriptions
GROUP BY status
ORDER BY count DESC;