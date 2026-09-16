# Conhecimento da Oferta — 8Token

> Última atualização: 2026-09-15

## O que estamos vendendo (resumo em 1 linha)

**Um SaaS de API de IA com uso ilimitado.** O cliente paga uma mensalidade fixa e ganha acesso ilimitado (sem cobrança por token, sem quota de mensagens) aos melhores modelos frontier para código — Claude Fable 5.1, Opus 5, Sonnet 5, GPT-6 Astra e GLM 5.3 — via endpoints API compatíveis com Anthropic, OpenAI e Google SDKs, além de ferramentas como Claude Code, Codex CLI, Cursor, Continue, Aider e LangChain.

### Em outras palavras
- **Produto:** assinatura mensal de acesso a APIs de modelos de IA.
- **Modelo de cobrança:** mensalidade fixa (Mensal / Trimestral / Anual). Quanto maior o período, menor o custo mensal equivalente.
- **O que é ilimitado:** tokens de entrada e saída, número de mensagens, trocas de modelo.
- **O que NÃO é ilimitado:** 1 IP autorizado por conta (regra anti-abuso e de uso pessoal).
- **Para quem:** desenvolvedores e equipes que usam IA para codificar todos os dias e não querem surpresa na fatura nem teto de uso.
- **Diferencial vs. pagar direto nos providers:** preço fixo previsível + acesso unificado a 5 laboratórios numa única chave, sem gerenciar billing separado em cada um.

---

## Regras principais

### 1. Só muda o desconto
**A única coisa que muda de um plano para o outro é o desconto dos meses. Todos os planos incluem TODOS os modelos com uso ilimitado.**

Não existe diferenciação de features entre os planos — nenhum modelo é exclusivo de um plano, nenhum recurso é bloqueado nos planos mais baratos. A diferença é puramente econômica: quanto maior o período, menor o custo mensal equivalente.

### 2. 1 IP por conta
**Cada conta usa exatamente 1 (um) endereço IP autorizado.** A chave API só funciona quando chamada a partir do IP registrado no dashboard.

**Fluxo de troca com e-mail (2026-09-15):** a solicitação de troca de IP no dashboard avisa o admin por e-mail (Resend via API HTTP — funciona na Vercel sem SMTP; requer `RESEND_API_KEY` e opcionalmente `EMAIL_FROM`/`ADMIN_EMAIL` nas env vars da Vercel). Quando o admin aprova ou recusa, o usuário recebe o resultado por e-mail. Sem a chave configurada, o sistema continua funcionando (só não envia e-mail — fica o aviso no log).

- Não é permitido compartilhar a conta/key com outras pessoas ou máquinas em IPs diferentes.
- Trocou de rede (casa → trabalho → celular 4G)? Atualize o IP no dashboard antes de usar.
- Uso simultâneo de múltiplos IPs na mesma chave = violação dos termos, possível suspensão sem reembolso.
- Essa regra vale para TODOS os planos (Mensal, Trimestral, Anual) — não existe plano com "mais IPs".

### 3. IP adicional pós-compra (add-on no painel)
**Após ativar o plano, o cliente pode adicionar +1 IP extra por R$ 74,90/mês diretamente no painel (dashboard).**

- **O que é IP:** o endereço de internet da sua conexão (ex.: `189.45.xx.xx`). É ele que identifica de onde a sua chave API está sendo usada. Cada computador/rede tem um IP diferente.
- **Por que adicionar um IP extra:** se você alterna entre duas redes (casa e trabalho, ou notebook e desktop em redes diferentes), sem o IP extra a chave para de funcionar toda vez que troca de rede — você teria que entrar no painel e atualizar o IP manualmente antes de usar. Com o IP extra, as duas redes ficam autorizadas ao mesmo tempo e você codifica sem interrupção.
- **Preço:** R$ 74,90/mês (valor fixo, independente do plano escolhido — Mensal, Trimestral ou Anual).
- **Quando comprar:** só aparece no painel **depois que o plano já está ativo/pago**. Não é vendido no checkout da LP — é um add-on pós-compra.
- **Limite:** máximo de 2 IPs por conta (1 padrão + 1 extra). Não existe opção de 3 ou mais IPs.
- **Cancelamento:** o IP extra pode ser removido a qualquer momento no painel; a cobrança para no próximo ciclo.
- **Regra continua valendo:** mesmo com o IP extra, a conta segue sendo pessoal e intransferível — os 2 IPs devem ser do mesmo titular.

---

## Planos e preços

### Mensal
- **Preço:** R$ 199,70 / mês
- **Ideal para:** experimentar ou uso esporádico

### Trimestral (Mais Escolhido)
- **Preço:** R$ 399 / trimestre
- **Equivalente mensal:** R$ 133 / mês
- **Economia vs mensal:** R$ 200 no trimestre (199,70 × 3 − 399 = 200,10)
- **Ideal para:** quem usa IA todos os dias para trabalho e estudo

### Anual
- **Preço:** R$ 1.100 / ano
- **Equivalente mensal:** R$ 91,67 / mês
- **Economia vs mensal:** R$ 1.296 no ano (199,70 × 12 − 1100 = 1296,40)
- **Ideal para:** maior economia — pagar uma vez e usar o ano todo

### Add-on: IP adicional (pós-compra, no painel)
- **Preço:** R$ 74,90 / mês
- **Disponibilidade:** só após o plano estar ativo — comprado dentro do dashboard, não no checkout
- **O que libera:** autoriza um 2º endereço IP na mesma conta (máx. 2 IPs no total)

---

## Features incluídas em TODOS os planos (idênticas)

- ✅ Uso ilimitado de todos os modelos
- ✅ Claude Fable 5.1, Opus 5, Sonnet 5, GPT-6 Astra e GLM 5.3
- ✅ Troque de modelo a qualquer momento
- ✅ Acesso no computador e navegador (1 IP por conta — IP extra disponível no painel por R$ 74,90/mês)
- ✅ Suporte por WhatsApp e email

---

## Comparação vs Claude (banner único acima dos cards)

**Estrutura atual (2026-09-13):** um único banner centralizado acima do grid de preços, com três blocos de argumento empilhados.

**Bloco 1 — vs Claude Pro (âncora principal):**
- Headline: "Por R$ 80 a mais no mensal você troca o uso limitado do Claude Pro por créditos infinitos e acesso ao Claude Fable 5."
- Math row: R$ 199,70 (8Token) − R$ 110 (Claude Pro) = ~R$ 80/mês

**Bloco 2 — vs Claude Max 5x (economia maior):**
- Card lado a lado: Claude Max 5x R$ 550/mês (uso limitado, 5x o Pro) → 8Token Mensal R$ 199,70/mês (ilimitado, sem janela de tokens)
- Economia mensal: R$ 350,30 (550 − 199,70)
- Economia anual: R$ 4.203,60 (350,30 × 12)

**Bloco 3 — tag ilimitado:**
- Tag: "∞ Ilimitado de verdade: sem teto de tokens, sem janela de limite, sem surpresa na fatura."
- (Punchline do Max 20x removida em 2026-09-13 a pedido do usuário — manter só a tag ilimitado.)

**Lógica do argumento:**
- O cliente já paga R$ 110/mês no Claude Pro (uso limitado). Por ~R$ 80 a mais (R$ 199,70 total), ganha tokens infinitos + Fable 5.1 + todos os outros modelos. Ele cancela o Claude Pro quando assina o 8Token — o custo real é só a diferença.
- Quem usa o Max 5x (R$ 550/mês) economiza R$ 350,30/mês ou R$ 4.203,60/ano ao trocar pelo 8Token — e ainda ganha uso realmente ilimitado, sem janela de limite.
- O Max 20x (R$ 1.100/mês) é citado só como trocadilho: a economia seria tão absurda (~R$ 900/mês, ~R$ 10.800/ano) que "nem fazemos a conta".

Planos Claude de referência:
- **Claude Pro** = R$ 110/mês (ou R$ 1.100/ano) — uso limitado
- **Claude Max 5x** = R$ 550/mês — uso limitado (5x o Pro)
- **Claude Max 20x** = R$ 1.100/mês — uso limitado (20x o Pro)

Regra de copy: focar na diferença de preço e no ganho qualitativo (ilimitado vs limitado + Fable 5). Nunca dizer que o modelo é melhor — só que o uso é sem teto por um delta pequeno. No Max 5x, mostrar a economia concreta (mensal e anual). No Max 20x, usar o trocadilho — não calcular sério.

Âncoras por card 4TOKEN — copy com impacto máximo (mostrar Pro + Max 5x + Max 20x):

**Mensal (R$ 199,70/mês):**
- Headline: "Tokens infinitos por menos da metade do Max 5x."
- vs Pro R$ 110: R$ 89,70 a mais e o teto de uso some.
- vs Max 5x R$ 550: 64% mais barato (R$ 350,30/mês a menos = R$ 4.203,60/ano).
- vs Max 20x R$ 1.100: 82% mais barato (R$ 900,30/mês a menos = R$ 10.803,60/ano).

**Trimestral (R$ 133/mês equiv.):**
- Headline: "R$ 23 a mais que o Pro. Tokens infinitos, sem surpresa."
- vs Pro R$ 110: +R$ 23/mês e o teto de uso some.
- vs Max 5x R$ 550: 76% mais barato (R$ 417/mês a menos = R$ 5.004/ano).
- vs Max 20x R$ 1.100: 88% mais barato (R$ 967/mês a menos = R$ 11.604/ano).

**Anual (R$ 91,67/mês equiv.):**
- Headline: "Mais barato que o Claude Pro. E com tokens infinitos."
- vs Pro R$ 110: R$ 18,33/mês mais barato E sem limite (economia R$ 220/ano vs Pro).
- vs Max 5x R$ 550: 83% mais barato (R$ 458/mês a menos = R$ 5.500/ano).
- vs Max 20x R$ 1.100: 92% mais barato (R$ 1.008/mês a menos = R$ 12.100/ano).

Regra de copy: sempre mostrar (1) o % ou valor economizado, (2) o ganho qualitativo "ilimitado vs limitado", (3) a projeção anual quando couber. Nunca dizer que o modelo é melhor — só que o uso é sem teto pelo mesmo preço ou menos.

Regra: nunca dizer que o 4TOKEN é "melhor modelo" — só que pelo mesmo preço (ou menos) o uso é ilimitado, sem teto de tokens.

---

## Posicionamento da oferta
- Sem créditos pré-pagos
- Sem cobrança por token
- Sem letras miúdas
- Cancele quando quiser
- **1 IP por conta** — uso pessoal, intransferível (IP extra opcional no painel por R$ 74,90/mês após ativar o plano)

---

## Notas para copy/marketing
- Nunca sugerir que um plano tem "mais recursos" que outro — isso é incorreto.
- O argumento de venda entre planos é sempre **economia**: quanto maior o período, menor o custo por mês.
- Todos os modelos (incluindo os mais poderosos como Claude Fable 5.1 e GPT-6 Astra) estão disponíveis desde o plano Mensal.
- Sempre deixar claro: **1 IP por conta**. Não prometer "vários dispositivos simultâneos" nem "múltiplos IPs" no checkout — a conta é pessoal e vinculada a um único IP autorizado. O IP extra (R$ 74,90/mês) é um add-on opcional comprado **depois** no painel, não no checkout.
- Ao mencionar o IP extra, explicar sempre: (1) o que é IP, (2) que serve para quem alterna entre duas redes, (3) que só aparece no painel após o plano estar ativo.