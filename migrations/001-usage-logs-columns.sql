-- Migration 001: Add missing columns to usage_logs for proxy tracking
-- Execute this in Supabase Dashboard > SQL Editor

ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS api_key_id UUID REFERENCES api_keys(id);
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS latency_ms INTEGER;
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS status_code INTEGER;
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS ip TEXT;

-- Index for faster queries by user and date
CREATE INDEX IF NOT EXISTS idx_usage_logs_user_id ON usage_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_logs_created_at ON usage_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_usage_logs_api_key_id ON usage_logs(api_key_id);