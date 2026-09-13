---
name: oferta
description: Recarrega o contexto da oferta 4TOKEN (planos, preços, features) e opcionalmente sincroniza a seção de preços do index.html com este conhecimento.
---

# Skill: oferta

## O que estamos vendendo (ler antes de tudo)

**Um SaaS de API de IA com uso ilimitado.** O cliente paga uma mensalidade fixa e ganha acesso ilimitado (sem cobrança por token, sem quota de mensagens) aos melhores modelos frontier para código — Claude Fable 5.1, Opus 5, Sonnet 5, GPT-6 Astra e GLM 5.3 — via endpoints API compatíveis com Anthropic, OpenAI e Google SDKs, além de ferramentas como Claude Code, Codex CLI, Cursor, Continue, Aider e LangChain.

- **Produto:** assinatura mensal de acesso a APIs de modelos de IA.
- **Modelo de cobrança:** mensalidade fixa (Mensal / Trimestral / Anual). Quanto maior o período, menor o custo mensal equivalente.
- **O que é ilimitado:** tokens de entrada e saída, número de mensagens, trocas de modelo.
- **O que NÃO é ilimitado:** 1 IP autorizado por conta (regra anti-abuso e de uso pessoal).
- **Para quem:** desenvolvedores e equipes que usam IA para codificar todos os dias e não querem surpresa na fatura nem teto de uso.
- **Diferencial vs. pagar direto nos providers:** preço fixo previsível + acesso unificado a 5 laboratórios numa única chave, sem gerenciar billing separado em cada um.

Sempre que escrever copy, responder dúvida de suporte ou ajustar a LP, partir desse resumo. Se algo no pedido contradizer esse posicionamento (ex.: prometer "créditos", "cobrança por token", "vários IPs"), corrigir o pedido antes de aplicar.

## Quando usar
- O usuário digita `/oferta`.
- O usuário pede para "atualizar o contexto da oferta", "sincronizar os preços", "revisar os planos" ou similar.
- Antes de editar qualquer copy de preço/modelo no `index.html`, `dashboard.html`, `account.html` ou `login.html`.

## Passo 1 — Ler o conhecimento autoritativo
Leia sempre primeiro: `F:\agentes ia\LP 4TOKEN\contexto\oferta.md`

Esse arquivo é a fonte da verdade. Se ele e o HTML divergirem, o arquivo vence — atualize o HTML, não o contrário (a menos que o usuário diga explicitamente para mudar a oferta).

## Regras principais (NUNCA esquecer)

### Regra 1 — Só muda o desconto
**A única coisa que muda de um plano para o outro é o desconto dos meses. Todos os planos incluem TODOS os modelos com uso ilimitado.**

- Não existe feature exclusiva de nenhum plano.
- Não existe modelo bloqueado nos planos mais baratos.
- O argumento de venda entre planos é SEMPRE economia (custo mensal equivalente menor).
- Nunca escrever copy sugerindo que o Trimestral ou Anual "tem mais recursos" que o Mensal.

### Regra 2 — 1 IP por conta
**Cada conta usa exatamente 1 (um) endereço IP autorizado.** A chave API só funciona a partir do IP registrado no dashboard.

- Não prometer "vários dispositivos simultâneos", "múltiplos IPs" ou "compartilhe com a equipe".
- A conta é pessoal e intransferível.
- Trocou de rede? Atualize o IP no dashboard.
- Essa regra vale para TODOS os planos — não existe plano com "mais IPs".
- Sempre que mencionar acesso/dispositivo na copy, reforçar "1 IP por conta".

### Regra 3 — IP adicional pós-compra (add-on no painel)
**Após ativar o plano, o cliente pode adicionar +1 IP extra por R$ 74,90/mês diretamente no painel (dashboard).**

- **O que é IP:** o endereço de internet da sua conexão (ex.: `189.45.xx.xx`). É ele que identifica de onde a sua chave API está sendo usada. Cada computador/rede tem um IP diferente.
- **Por que adicionar um IP extra:** se você alterna entre duas redes (casa e trabalho, ou notebook e desktop em redes diferentes), sem o IP extra a chave para de funcionar toda vez que troca de rede — você teria que entrar no painel e atualizar o IP manualmente antes de usar. Com o IP extra, as duas redes ficam autorizadas ao mesmo tempo e você codifica sem interrupção.
- **Preço:** R$ 74,90/mês (valor fixo, independente do plano escolhido — Mensal, Trimestral ou Anual).
- **Quando comprar:** só aparece no painel **depois que o plano já está ativo/pago**. Não é vendido no checkout da LP — é um add-on pós-compra.
- **Limite:** máximo de 2 IPs por conta (1 padrão + 1 extra). Não existe opção de 3 ou mais IPs.
- **Cancelamento:** o IP extra pode ser removido a qualquer momento no painel; a cobrança para no próximo ciclo.
- **Regra continua valendo:** mesmo com o IP extra, a conta segue sendo pessoal e intransferível — os 2 IPs devem ser do mesmo titular.
- Ao mencionar o IP extra na copy, explicar sempre: (1) o que é IP, (2) que serve para quem alterna entre duas redes, (3) que só aparece no painel após o plano estar ativo.

## Tabela de preços vigente

| Plano       | Preço             | Equiv. mensal | Economia vs mensal      |
|-------------|-------------------|---------------|-------------------------|
| Mensal      | R$ 199,70 / mês   | R$ 199,70     | —                       |
| Trimestral  | R$ 399 / trim.    | R$ 133,00     | R$ 200 no trimestre     |
| Anual       | R$ 1.100 / ano    | R$ 91,67      | R$ 1.296 no ano         |

## Features idênticas em todos os planos
- Uso ilimitado de todos os modelos
- Claude Fable 5.1, Opus 5, Sonnet 5, GPT-6 Astra e GLM 5.3
- Troque de modelo a qualquer momento
- Acesso no computador e navegador (1 IP por conta)
- Suporte por WhatsApp e email

## Posicionamento
- Sem créditos pré-pagos
- Sem cobrança por token
- Sem letras miúdas
- Cancele quando quiser
- 1 IP por conta — uso pessoal, intransferível

## Passo 2 — O que fazer depois de ler
Pergunte (ou infira do pedido do usuário) qual ação ele quer:

1. **Só recarregar contexto** — confirme que leu e resuma em 2-3 linhas o que está vigente. Pare.
2. **Sincronizar o `index.html`** — abra a seção `#precos` (procure por `<!-- Pricing Section -->`), compare cada card com a tabela acima e edite só o que divergir (preços, notas de economia, lista de features, menção a 1 IP). Não mexa em CSS nem em outras seções.
3. **Atualizar a própria oferta** — se o usuário disser "mude o preço do anual para X" ou "adicione o modelo Y", edite primeiro `contexto/oferta.md`, depois propague para o HTML. A ordem importa: o .md é a fonte.

## Passo 3 — Verificação
Depois de editar o HTML, confira com `preview_snapshot` ou lendo a seção que:
- Os 3 cards têm exatamente a mesma lista de features.
- Os preços batem com a tabela.
- As notas de economia estão matematicamente corretas (trimestral: 199,70 × 3 − 399 = 200,10 ≈ 200; anual: 199,70 × 12 − 1100 = 1296,40 ≈ 1296).
- A regra de 1 IP por conta aparece claramente (hero, cards ou seção dedicada).

## Arquivos relacionados
- Fonte da verdade: `contexto/oferta.md`
- Landing page: `index.html` (seção `#precos`, ~linha 2968; hero ~linha 2430)
- Esta skill: `.claude/skills/oferta/SKILL.md`