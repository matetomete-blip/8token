-- Adiciona coluna 'role' na tabela users para separar cargo de plano
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(50) DEFAULT 'user';

-- Atualiza usuários existentes com plan='admin' para ter role='admin' e plan='anual'
UPDATE users SET role = 'admin', plan = 'anual' WHERE plan = 'admin';

-- Cria índice para busca por role
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- Comentário: Agora 'admin' é um cargo (role), não um plano.
-- Planos válidos: free, mensal, trimestral, anual
-- Cargos válidos: user, admin, affiliate