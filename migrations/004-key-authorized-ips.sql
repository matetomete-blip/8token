-- Migration 004: key_authorized_ips — vincula IPs autorizados a cada chave API
-- Cada chave tem seus próprios IPs; ao excluir a chave, os IPs são removidos (CASCADE)

CREATE TABLE IF NOT EXISTS key_authorized_ips (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    api_key_id UUID NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
    ip TEXT NOT NULL,
    authorized_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(api_key_id, ip)
);

CREATE INDEX IF NOT EXISTS idx_key_authorized_ips_key ON key_authorized_ips(api_key_id);

-- RLS (consistente com as demais tabelas — server usa service_role que bypassa)
ALTER TABLE key_authorized_ips ENABLE ROW LEVEL SECURITY;