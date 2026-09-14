import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.colors import HexColor
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
from reportlab.lib.enums import TA_LEFT, TA_CENTER

output_path = r"F:\agentes ia\LP 4TOKEN\contexto\scripts-criativos-meta-ads-compliant.pdf"

doc = SimpleDocTemplate(
    output_path,
    pagesize=A4,
    rightMargin=20*mm,
    leftMargin=20*mm,
    topMargin=20*mm,
    bottomMargin=20*mm
)

styles = getSampleStyleSheet()

styles.add(ParagraphStyle(name="MainTitle", parent=styles["Title"], fontSize=18, spaceAfter=6, textColor=HexColor("#1a1a1a")))
styles.add(ParagraphStyle(name="SubTitle", parent=styles["Normal"], fontSize=11, spaceAfter=12, textColor=HexColor("#555555"), alignment=TA_CENTER))
styles.add(ParagraphStyle(name="SectionHead", parent=styles["Heading1"], fontSize=14, spaceBefore=16, spaceAfter=8, textColor=HexColor("#0d47a1")))
styles.add(ParagraphStyle(name="SubHead", parent=styles["Heading2"], fontSize=11, spaceBefore=10, spaceAfter=4, textColor=HexColor("#1565c0")))
styles.add(ParagraphStyle(name="Quote", parent=styles["Normal"], fontSize=10, leftIndent=12, rightIndent=12, spaceBefore=4, spaceAfter=4, textColor=HexColor("#333333"), backColor=HexColor("#f5f5f5"), borderPadding=6))
styles.add(ParagraphStyle(name="Compliance", parent=styles["Normal"], fontSize=9, spaceBefore=2, spaceAfter=8, textColor=HexColor("#2e7d32"), leftIndent=12))
styles.add(ParagraphStyle(name="BodySmall", parent=styles["Normal"], fontSize=9.5, spaceAfter=6, leading=13))
styles.add(ParagraphStyle(name="CheckItem", parent=styles["Normal"], fontSize=9.5, spaceAfter=3, leftIndent=12, leading=12))
styles.add(ParagraphStyle(name="FooterNote", parent=styles["Normal"], fontSize=8, textColor=HexColor("#888888"), alignment=TA_CENTER, spaceBefore=20))

story = []

# Title
story.append(Paragraph("Scripts para Meta Ads (Facebook/Instagram)", styles["MainTitle"]))
story.append(Paragraph("8Token / GhostCLI - API Ilimitada de IA - Compliance Total", styles["SubTitle"]))
story.append(HRFlowable(width="100%", thickness=1, color=HexColor("#cccccc"), spaceAfter=10))

# Policy notice
policy_text = '<b>POLITICA DE ANUNCIOS META:</b> Este documento foi revisado para conformidade com as Politicas de Publicidade da Meta (setembro 2026). Todos os scripts evitam: promessas absolutistas, comparacoes depreciativas diretas, linguagem sensacionalista, alegacoes nao verificaveis e gatilhos de circumventing systems. Foco em beneficios tangiveis, prova concreta e tom educacional.<br/><br/><b>Formato:</b> Gancho (3-5s) > Corpo (15-25s) > CTA (3-5s)<br/><b>Apresentador:</b> Voce aparece nos videos (tom pessoal, educativo, dev-to-dev)<br/><b>Publico-alvo:</b> Desenvolvedores que usam IA para codar e buscam previsibilidade de custos'
story.append(Paragraph(policy_text, styles["BodySmall"]))
story.append(Spacer(1, 8))

# === GANCHOS ===
story.append(Paragraph("5 GANCHOS (Abertura - 3 a 5 segundos)", styles["SectionHead"]))
story.append(Paragraph("Ganchos compliant focam em identificacao com situacao real, curiosidade educativa ou beneficio claro. Evitam dor excessiva, medo ou promessas irreais.", styles["BodySmall"]))

ganchos = [
    ("Gancho 1 - Identificacao situacional (sem dor exagerada)",
     "Voce programa com IA e ja precisou parar no meio de um projeto porque o limite de uso acabou?",
     "Pergunta factual sobre experiencia comum. Sem linguagem emocional excessiva ou alarmismo. Permite que o lead se identifique sem sentir-se atacado."),
    ("Gancho 2 - Beneficio direto + especificidade",
     "Acesso ao Claude Fable 5.1 e outros modelos frontier por R$ 199,70 mensais. Uso continuo, sem cobranca por token.",
     "Declaracao factual de preco e feature. Sem superlativos. Preco visivel evita clickbait. Uso continuo substitui ilimitado (termo mais seguro politicamente)."),
    ("Gancho 3 - Comparativo educativo (nao depreciativo)",
     "Se voce paga por tokens hoje, existe uma alternativa com custo fixo mensal. Deixa eu te mostrar como funciona.",
     "Tom educacional. Nao nomeia concorrente diretamente. Oferece valor antes de vender. Alternativa e neutro; deixa eu te mostrar convida sem pressionar."),
    ("Gancho 4 - Curiosidade baseada em mecanismo",
     "Como devs estao usando Claude Code o dia todo com uma unica assinatura de R$ 199? Vou explicar em 20 segundos.",
     "Prova social implicita sem numeros inventados. Promessa de conteudo educativo. Time-bound (20 segundos) reduz sensacao de venda agressiva."),
    ("Gancho 5 - Transparencia + valor",
     "R$ 199,70 por mes. Cinco modelos frontier. Uso continuo. Sem surpresas na fatura. Se voce usa IA pra codar, isso pode fazer sentido pra voce.",
     "Lista factual de features. Pode fazer sentido respeita autonomia do lead. Preco upfront filtra publico qualificado. Sem adjetivos vazios."),
]

for title, quote, compliance in ganchos:
    story.append(Paragraph(title, styles["SubHead"]))
    story.append(Paragraph('"' + quote + '"', styles["Quote"]))
    story.append(Paragraph("<b>Compliance:</b> " + compliance, styles["Compliance"]))

# === CORPOS ===
story.append(Paragraph("5 CORPOS (Desenvolvimento - 15 a 25 segundos)", styles["SectionHead"]))
story.append(Paragraph("Corpos compliant explicam o mecanismo, mostram valor concreto e educam sobre a oferta. Evitam comparacoes diretas com concorrentes especificos, promessas de resultado financeiro ou linguagem coercitiva.", styles["BodySmall"]))

corpos = [
    ("Corpo 1 - Explicacao do mecanismo + compatibilidade",
     "Funciona assim: voce assina por R$ 199,70 mensais e recebe uma chave API compativel com Claude Code, Claude Desktop, Cursor e outras ferramentas que ja usa. Sao cinco modelos disponiveis: Claude Fable 5.1, Opus 5, Sonnet 5, GLM 5.3 e GPT-6 Astra. Voce troca entre eles quando quiser, sem cobranca adicional por volume de uso. Tudo numa unica assinatura, sem precisar gerenciar billing separado.",
     "Explicacao tecnica clara. Lista verificavel de modelos. Sem cobranca adicional por volume e factual. Nao promete economia especifica vs concorrente. Foca no funcionamento do produto."),
    ("Corpo 2 - Previsibilidade de custos (beneficio racional)",
     "Pra quem programa todo dia, imprevisibilidade de custo e um problema. Com a nossa API, o valor e fixo: R$ 199,70 por mes. Voce sabe exatamente quanto vai gastar, independente de quantos tokens usar. Isso facilita planejamento financeiro e elimina surpresas no fim do mes. O plano trimestral sai R$ 133 por mes equivalente, e o anual R$ 91,67.",
     "Beneficio tangivel (previsibilidade). Dados concretos de preco. Sem alegacoes de economia especifica. Tom informativo. Mencao aos planos longer-term como opcao, nao pressao."),
    ("Corpo 3 - Experiencia pratica (sem promessas absolutas)",
     "Na pratica, voce configura sua ferramenta favorita apontando pra nossa URL base. A partir dai, usa os modelos normalmente - mesma interface, mesmos comandos. Se precisa de mais capacidade, troca pro Fable 5.1. Se quer velocidade, vai de Sonnet 5. Tudo dentro do mesmo plano. E se alternar entre duas redes, tem opcao de adicionar um segundo IP no painel por R$ 74,90 mensais.",
     "Descricao realista de uso. Normalmente evita garantia de funcionamento perfeito. Explica add-on de IP extra com transparencia. Sem nunca mais ou para sempre."),
    ("Corpo 4 - Contexto de mercado (educativo, nao comparativo)",
     "Hoje, acesso a modelos frontier por token pode variar bastante de custo dependendo do volume. Nossa abordagem e diferente: preco fixo mensal, independente do uso. Isso significa que desenvolvedores que usam IA intensivamente tem acesso continuo sem precisar calcular custo por mensagem. E um modelo pensado pra quem programa profissionalmente.",
     "Educa sobre o mercado SEM citar concorrentes pelo nome. Pode variar e factual e verificavel. Abordagem diferente posiciona sem atacar. Foca no perfil do usuario como qualificador natural."),
    ("Corpo 5 - Transparencia total (limitacoes incluidas)",
     "Importante ser transparente: cada conta autoriza um endereco IP. Se voce usa em dois lugares diferentes, pode adicionar um segundo IP opcional no painel. Os modelos sao os oficiais dos laboratorios - nao modificamos nada. E o cancelamento e livre, direto no dashboard, sem multa. A ideia e simples: acesso continuo a modelos frontier por um custo previsivel.",
     "Divulgacao proativa de limitacoes (IP unico) atende politica de transparencia da Meta. Modelos oficiais evita alegacao falsa de exclusividade. Cancelamento livre remove objecao sem pressao."),
]

for title, quote, compliance in corpos:
    story.append(Paragraph(title, styles["SubHead"]))
    story.append(Paragraph('"' + quote + '"', styles["Quote"]))
    story.append(Paragraph("<b>Compliance:</b> " + compliance, styles["Compliance"]))

# === CTAs ===
story.append(Paragraph("5 CTAs (Chamada para Acao - 3 a 5 segundos)", styles["SectionHead"]))
story.append(Paragraph("CTAs compliant sao claros, especificos e de baixo atrito. Evitam urgencia artificial, escassez fabricada ou comandos agressivos. Focam no proximo passo logico.", styles["BodySmall"]))

ctas = [
    ("CTA 1 - Convite educativo",
     "Se faz sentido pro seu fluxo de trabalho, clica no link abaixo e conhece os detalhes. Tem documentacao completa e guia de configuracao passo a passo.",
     "Condicional (se faz sentido) respeita autonomia. Oferece recurso gratuito (documentacao) como proximo passo. Sem pressao temporal."),
    ("CTA 2 - Experimentacao com clareza",
     "Quer ver como funciona na pratica? Acessa o link, cria sua conta gratuita e testa os modelos antes de decidir. Sem compromisso.",
     "Oferece teste gratuito (reduz risco percebido). Antes de decidir reconhece processo de avaliacao do lead. Sem compromisso e factual."),
    ("CTA 3 - Informacao de preco direta",
     "Os planos comecam em R$ 199,70 mensais. Link abaixo com tabela completa de precos e comparacao detalhada. Avalia se encaixa no seu orcamento.",
     "Preco visivel no anuncio (transparencia). Avalia se encaixa convida a reflexao, nao a compra impulsiva. Direciona para pagina informativa."),
    ("CTA 4 - Proximo passo logico",
     "Se voce programa com IA regularmente, vale conhecer. Clica no link, le a documentacao e ve se atende sua necessidade. Qualquer duvida, tem suporte por WhatsApp e email.",
     "Qualifica o publico. Oferece multiplos pontos de contato (suporte). Ve se atende e consultivo, nao transacional."),
    ("CTA 5 - Decisao informada",
     "Todas as informacoes estao no link: modelos disponiveis, precos, limites de IP e guia de setup. Confere la e decide com calma. Estamos aqui se precisar de ajuda.",
     "Enumera o que o lead encontrara (transparencia). Decide com calma remove pressao. Estamos aqui humaniza sem ser invasivo."),
]

for title, quote, compliance in ctas:
    story.append(Paragraph(title, styles["SubHead"]))
    story.append(Paragraph('"' + quote + '"', styles["Quote"]))
    story.append(Paragraph("<b>Compliance:</b> " + compliance, styles["Compliance"]))

# === MATRIZ ===
story.append(Paragraph("MATRIZ DE COMBINACAO RECOMENDADA (META ADS)", styles["SectionHead"]))

matrix_data = [
    ["Video", "Gancho", "Corpo", "CTA", "Objetivo", "Publico"],
    ["1", "#1 (Situacao)", "#1 (Mecanismo)", "#2 (Teste)", "Consideracao", "Devs ativos - topo"],
    ["2", "#2 (Beneficio)", "#2 (Previsibilidade)", "#3 (Preco)", "Conversao", "Solution Aware - meio"],
    ["3", "#5 (Transparencia)", "#5 (Limitacoes)", "#5 (Decisao)", "Confianca", "Remarketing - fundo"],
    ["4", "#4 (Curiosidade)", "#4 (Mercado)", "#1 (Educacao)", "Awareness", "Cold audience - topo"],
    ["5", "#3 (Comparativo)", "#3 (Experiencia)", "#4 (Proximo passo)", "Consideracao", "Product Aware - meio"],
]

t = Table(matrix_data, colWidths=[30, 80, 85, 70, 65, 90])
t.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), HexColor("#0d47a1")),
    ("TEXTCOLOR", (0, 0), (-1, 0), HexColor("#ffffff")),
    ("FONTSIZE", (0, 0), (-1, -1), 8),
    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
    ("ALIGN", (0, 0), (-1, -1), "LEFT"),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("GRID", (0, 0), (-1, -1), 0.5, HexColor("#cccccc")),
    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [HexColor("#ffffff"), HexColor("#f5f8ff")]),
    ("TOPPADDING", (0, 0), (-1, -1), 4),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ("LEFTPADDING", (0, 0), (-1, -1), 4),
]))
story.append(t)
story.append(Spacer(1, 12))

# === CHECKLIST ===
story.append(Paragraph("CHECKLIST DE COMPLIANCE META (ANTES DE PUBLICAR)", styles["SectionHead"]))

story.append(Paragraph("<b>FAZER</b>", styles["SubHead"]))
fazer_items = [
    "Preco visivel no video ou legenda",
    "Limitacoes divulgadas claramente (1 IP por conta)",
    "Linguagem factual e verificavel",
    "Tom educativo ou consultivo",
    "Landing page coerente com promessa do anuncio",
    "Documentacao/guia disponivel como recurso gratuito",
    "Suporte mencionado como recurso, nao isca",
]
for item in fazer_items:
    story.append(Paragraph("[OK] " + item, styles["CheckItem"]))

story.append(Spacer(1, 6))
story.append(Paragraph("<b>EVITAR (GATILHOS DE REJEICAO)</b>", styles["SubHead"]))
evitar_items = [
    "Ilimitado sem contexto (usar uso continuo ou sem cobranca por token)",
    "Comparacoes diretas com concorrentes pelo nome",
    "Promessas de economia especifica sem disclaimer",
    "Urgencia artificial (so hoje, ultimas vagas)",
    "Linguagem emocional excessiva",
    "Garantias absolutas (sempre funciona, nunca trava)",
    "Alegacoes nao verificaveis",
    "Clickbait no gancho sem entrega no corpo",
    "Imagens/videos com texto excessivo (>20% da area visual)",
]
for item in evitar_items:
    story.append(Paragraph("[X] " + item, styles["CheckItem"]))

# === NOTAS ESTRATEGICAS ===
story.append(Paragraph("NOTAS ESTRATEGICAS PARA META ADS", styles["SectionHead"]))

story.append(Paragraph("<b>Por que esta versao e diferente da original</b>", styles["SubHead"]))
diff_items = [
    "Tokens ilimitados > Substituido por uso continuo ou sem cobranca por token",
    "Cancele seu Claude Pro > Removido (comparacao direta = risco de rejeicao)",
    "R$ 550 vs R$ 199 > Substituido por custo fixo vs variavel",
    "Nunca mais se preocupe > Substituido por previsibilidade de custos",
    "Tom provocativo > Substituido por tom educativo",
]
for item in diff_items:
    story.append(Paragraph("- " + item, styles["CheckItem"]))

story.append(Spacer(1, 6))
story.append(Paragraph("<b>Segmentacao recomendada</b>", styles["SubHead"]))
seg_items = [
    "Interesses: Desenvolvimento de software, Programacao, Inteligencia artificial, Machine learning, Claude AI, Cursor, VS Code",
    "Comportamentos: Administradores de paginas de tecnologia, Usuarios de GitHub",
    "Exclusao: Publicos que ja converteram",
]
for item in seg_items:
    story.append(Paragraph("- " + item, styles["CheckItem"]))

story.append(Spacer(1, 6))
story.append(Paragraph("<b>Estrutura de campanha sugerida</b>", styles["SubHead"]))
camp_items = [
    "Topo de funil (Awareness): Videos 4 e 1. Objetivo: alcance ou trafego.",
    "Meio de funil (Consideration): Videos 2 e 5. Objetivo: engajamento ou leads.",
    "Fundo de funil (Conversion): Video 3. Objetivo: conversoes na landing page.",
]
for item in camp_items:
    story.append(Paragraph("- " + item, styles["CheckItem"]))

story.append(Spacer(1, 6))
story.append(Paragraph("<b>Teste A/B prioritario</b>", styles["SubHead"]))
story.append(Paragraph("Teste Gancho #2 (beneficio direto) vs Gancho #4 (curiosidade) primeiro. Ambos sao safe e medem se o publico responde melhor a transparencia imediata ou educacao progressiva.", styles["BodySmall"]))

# === REFERENCIAS ===
story.append(Paragraph("REFERENCIAS DE POLITICA META", styles["SectionHead"]))
refs = [
    "Politicas de Publicidade Meta - Praticas Comerciais Inaceitaveis: https://www.facebook.com/policies/ads/",
    "Diretrizes de Comunidade - Spam e Engano: https://transparency.fb.com/pt-br/community-standards/",
    "Requisitos de Anuncios de Servicos Financeiros/Criptomoedas: https://www.facebook.com/business/help/2066069993689883",
    "Guia de Texto em Imagens/Videos: https://www.facebook.com/business/help/1225779854185058",
]
for ref in refs:
    story.append(Paragraph("- " + ref, styles["CheckItem"]))

# Footer
story.append(Spacer(1, 16))
story.append(HRFlowable(width="100%", thickness=0.5, color=HexColor("#cccccc"), spaceAfter=6))
story.append(Paragraph("Documento vivo. Atualize conforme mudancas nas politicas da Meta ou resultados de testes. Ultima revisao: setembro 2026.", styles["FooterNote"]))

doc.build(story)
print("PDF generated: " + output_path)
print("Size: " + str(os.path.getsize(output_path)) + " bytes")