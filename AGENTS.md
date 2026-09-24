# AGENTS.md — Regras do Projeto LP 4TOKEN / 8Token

## 📋 CONTEXTO DA OFERTA (OBRIGATÓRIO)

Antes de **qualquer** tarefa relacionada a copy, design, funcionalidade, suporte ou discussão sobre o produto:

1. **LEIA** o arquivo [`contexto/OFERTA.md`](contexto/OFERTA.md) — ele é a fonte única de verdade sobre o que estamos vendendo, preços, modelos, políticas e estado atual do produto.
2. **NUNCA invente** informações sobre a oferta que não estejam nesse arquivo ou nos resumos do site (`RESUMO-COMPLETO-SITE-MAE.txt`, `RESUMO-COMPLETO-DETALHADO-SITE-MAE.txt`).
3. **ATUALIZE** o `contexto/OFERTA.md` sempre que:
   - Preços, planos ou modelos mudarem
   - Novas features forem implementadas ou removidas
   - Políticas de reembolso/termos forem alteradas
   - Estado do produto mudar (bug corrigido, integração concluída, TODO resolvido)
   - Decisões de copy/posicionamento forem tomadas em sessões de cowork

### Como atualizar
- Edite diretamente o `contexto/OFERTA.md` mantendo a estrutura existente
- Atualize o campo "Última atualização" no topo do arquivo
- Se a mudança for significativa, adicione uma nota breve na seção relevante explicando o que mudou e por quê
- Não duplique informações que já existem nos resumos do site — referencie-os quando necessário

## 🎯 ESCOPO DO PROJETO

Este projeto contém a landing page e infraestrutura backend do **8Token**, uma plataforma de acesso unificado a modelos frontier de IA para código via assinatura mensal ilimitada.

### Arquivos-chave
- `index.html` — Landing page principal
- `server.js` — Backend Node.js
- `login.html`, `account.html`, `admin.html` — Páginas de autenticação e gestão
- `contexto/OFERTA.md` — **Fonte única de verdade da oferta** (leia sempre)
- `RESUMO-COMPLETO-SITE-MAE.txt` — Conteúdo extraído do site original de referência
- `RESUMO-COMPLETO-DETALHADO-SITE-MAE.txt` — Versão detalhada com todas as seções, animações e estrutura

### Stack
- Frontend: HTML/CSS/JS vanilla (sem framework pesado, otimizado para Hostinger)
- Backend: Node.js + sql.js (TODO: migrar para PostgreSQL/MySQL)
- Design system: variáveis CSS próprias, tema escuro, glow laranja como accent

## ⚠️ REGRAS GERAIS

- **Idioma**: responda sempre no mesmo idioma que o usuário escreveu
- **Nomes corretos**: 8Token (produto), Codex Fable 5.1 (não "5.3"), GLM 5.3 (Z.ai), GPT-6 Astra (OpenAI)
- **Sem HTML raw**: nunca use `<details>`, `<summary>`, `<br>` nas respostas — o cliente CLI renderiza como texto literal
- **Markdown apenas**: use headings, listas e parágrafos curtos
- **TODOs**: quando implementar algo que depende de configuração externa (Google Client ID, gateway de pagamento, etc.), marque com comentário `TODO` no código e atualize o `contexto/OFERTA.md` na seção de estado atual

## 🔗 LINKS ÚTEIS

- Deploy: Vercel (matetomete-blip/8token)
- Docs: docs.html (página local)