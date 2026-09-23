-- =============================================
-- 8Token — Migração: tabelas e colunas faltantes
-- Rodar no Supabase Dashboard → SQL Editor
-- =============================================

-- 1. Criar tabela site_settings (CRÍTICO — sem ela o Gateway URL não funciona)
CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Inserir/atualizar Gateway URL padrão
INSERT INTO site_settings (key, value)
VALUES ('gateway_url', 'https://8token.tech/v1')
ON CONFLICT (key) DO UPDATE SET value = 'https://8token.tech/v1', updated_at = now();

-- 3. Adicionar coluna key_encrypted na tabela api_keys (para revelar chaves depois)
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS key_encrypted TEXT;

-- 4. Adicionar coluna additional_ip_expires_at na tabela ip_subscriptions (expiração independente do IP adicional)
ALTER TABLE ip_subscriptions ADD COLUMN IF NOT EXISTS additional_ip_expires_at TIMESTAMPTZ;

-- 5. Verificar se tudo foi criado corretamente
SELECT 'site_settings' AS table_name, count(*) AS rows FROM site_settings
UNION ALL
SELECT 'api_keys.key_encrypted', count(*) FROM information_schema.columns WHERE table_name = 'api_keys' AND column_name = 'key_encrypted'
UNION ALL
SELECT 'ip_subscriptions.additional_ip_expires_at', count(*) FROM information_schema.columns WHERE table_name = 'ip_subscriptions' AND column_name = 'additional_ip_expires_at';