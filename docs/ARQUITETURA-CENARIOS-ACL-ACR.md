# Parâmetros e comparação ACL × ACR — proposta de implantação

Status: arquitetura para a Etapa 4; não representa motor de cálculo ou cadastro tributário já publicado. A F1.29 acrescenta somente condições operacionais do fornecedor na Etapa 3.

## Enquadramento no Prompt Mestre

As seções 9–13 organizam contratos/configuração na Etapa 3, faturas e motor determinístico na Etapa 4, integração CCEE isolada e resultados auditáveis. O roadmap coloca OCR na Etapa 5, dashboards na 6 e eventos/operação na 7. Os parâmetros abaixo devem ser implementados no começo da Etapa 4, antes de liberar qualquer economia calculada. OCR e API CCEE podem chegar depois, usando os mesmos dados normalizados e revisados.

## Contratos — entregue nesta etapa

Fornecedor: flexibilidade mínima/máxima como percentual do volume contratado (100% = referência), modulação Flex/Conforme a carga, submercado, sazonalidade textual, distribuição mensal ou ambas. Cada ano declara seu volume em MWh e 12 percentuais somando 100%; meses sem vigência ficam em zero. A quantidade geral legada não é reinterpretada como volume anual. Contratos ativados preservam os valores; alterações futuras exigem aditivo/versionamento.

Os quatro submercados são Sul, Sudeste/Centro-Oeste, Nordeste e Norte. Sudeste e SE/CO não devem formar cadastros separados. Fonte: [CCEE](https://www.ccee.org.br/o/ccee/documentos/CCEE_1205706).

## Cadastro proposto: Parâmetros de cálculo

Entrada no Backoffice por organização → cliente → unidade. A marcação Mercado Livre indica necessidade de completar os parâmetros ACL e o cenário ACR de referência; não deve preencher tributos ou tarifas com zero automaticamente. A tela mostra período, situação de revisão, itens ausentes e fonte de cada valor.

### Tarifas por vigência

Distribuidora, UF, grupo/subgrupo, modalidade, cenário, componente (TE, TUSD, demanda, energia reativa e demais rubricas), posto tarifário, unidade de medida (R$/kW, R$/kWh, R$/MWh), valor decimal, início/fim, fonte/documento, versão e aprovação. Informar se o valor inclui tributos e quais. Uma tarifa líquida não pode ser confundida com valor final faturado. O ranking da [ANEEL](https://www.gov.br/aneel/pt-br/assuntos/tarifas/ranking-das-tarifas) não inclui todos os tributos e adicionais da conta.

Regras para sobreposição, mudança dentro do mês e proporcionalidade devem ser explícitas. Não sobrescrever vigências anteriores. Referências públicas globais podem alimentar rascunhos; ajustes privados pertencem à organização. A tabela tariffs do esquema documentado é global e não pode receber parâmetros privados sem adequação do escopo.

### Perfis tributários versionados

ICMS, PIS, Cofins e tributos condicionais devem registrar alíquota, base de incidência, rubricas incluídas/excluídas, cenário, jurisdição, período, regime por dentro/por fora/já incluído, isenções, créditos aplicáveis, fonte e responsável pela revisão. Ausente é diferente de zero. Alíquotas efetivas dependentes da competência precisam ser registradas por competência.

IOF deve ser aplicável somente quando existir a operação correspondente, por exemplo crédito/seguro conforme seu enquadramento; não será somado como imposto genérico da energia. A [Receita Federal](https://www.gov.br/receitafederal/pt-br/assuntos/orientacao-tributaria/tributos/IOF) descreve suas operações de incidência. O cadastro deve aceitar Não aplicável com justificativa.

Para ICMS por dentro, quando B for a base líquida pertinente e a a alíquota, o caso simples é Total = B / (1 − a), e ICMS = Total − B. A inclusão do imposto na própria base consta do art. 13 da [LC 87](https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp87.htm). Isso não autoriza dividir toda conta indistintamente por 1 − ICMS − PIS − Cofins: cada regra exige base e exclusões próprias. Valores já tributados não recebem o imposto novamente. A configuração efetiva deverá refletir a legislação e o contrato aplicáveis, com revisão responsável.

### Catálogo extensível de custos

Fornecedor, distribuidora, CCEE, encargos, exposição/spot, créditos, honorários, intermediação, garantias/financiamento e outros. Cada componente informa débito/crédito, valor ou quantidade × preço, unidade, competência, origem, tributos, cenário e critério de rateio. Impedir duplicidade entre energia do fornecedor e TE do cenário de referência, entre tributo embutido e calculado e entre dados manuais e importados.

Custos por organização ou cliente devem ser rateados entre unidades por regra versionada, conservando o total e os centavos residuais. Honorário fixo de um cliente não pode ser cobrado uma vez por unidade sem previsão contratual.

## Motor determinístico e auditável

Backend centralizado, valores monetários decimais (NUMERIC/Decimal), conversões explícitas kWh/MWh, política de arredondamento por componente e versão de fórmula. Cada execução captura faturas aprovadas, medições, contratos/preços vigentes, parâmetros tributários, tarifas, custos, índices efetivamente publicados e fontes utilizadas. Preço-base aguardando reajuste não é preço final confirmado.

A apuração usa a mesma competência, unidades e consumo comparável nos dois cenários. Sem entrada obrigatória, retorna cenário incompleto e lista de pendências; não inventa economia. Considerar demanda, sazonalidade, flexibilidade e modulação somente conforme fórmula e dados disponíveis, sem simular medição horária a partir de consumo mensal.

Reaproveitar e evoluir, após validar o banco real, monthly_energy_settlements, management_billings, invoices/invoice_items e ccee_entries descritas no esquema. Não criar motor concorrente nem converter valores históricos em massa sem reconciliação. Novos parâmetros financeiros usam decimal; o legado FLOAT exige plano específico de migração e testes.

### Honorários sobre economia

Definição proposta para eliminar circularidade e respeitar a dedução prévia de custos:

- A = custo ACR completo e comparável.
- L = custo ACL com fornecedor, distribuidora, CCEE, encargos, tributos, demais custos e créditos, excluindo somente os honorários de gestão calculados abaixo.
- F = honorário fixo aplicável.
- Base líquida antes do honorário variável = A − L − F.
- Honorário variável = percentual contratual × max(Base líquida, 0).
- Honorário total = F + variável.
- Custo ACL final = L + honorário total.
- Economia final do cliente = A − custo ACL final.
- Economia percentual = economia final / A; se A = 0, percentual indisponível.

O piso zero do honorário variável é a regra proposta e precisa constar da configuração contratual; não se inventa cobrança variável em prejuízo. Custos tributários incidentes no próprio honorário exigem regra específica de composição e arredondamento antes da aprovação. Se um contrato exigir percentual sobre economia já líquida do próprio percentual, será outra fórmula explícita, nunca uma referência circular escondida.

Exemplo sem tributos adicionais sobre honorários: A=100.000; L=80.000; F=1.000; percentual=20%. Base=19.000; variável=3.800; total honorários=4.800; ACL final=84.800; economia final=15.200 (15,2%).

## Segurança, revisão e histórico

Toda configuração privada, consulta, execução e publicação deve estar vinculada à organização, cliente e unidade, com RBAC e RLS e testes contra acesso entre organizações. Gestores revisam conforme permissão; clientes consultam somente dados publicados do seu escopo. Módulo e licença são conferidos pelo backend.

Estados: rascunho → em revisão → aprovado → publicado. Registrar autor, aprovador, datas, versão e evidências. Correção cria nova versão; não altera silenciosamente meses já publicados. Execução idempotente por organização/unidade/competência/conjunto de entradas; agregação conserva totais e sinal de créditos. Resultado inclui memória de cálculo por rubrica, não só totais.

## CCEE, OCR, dashboards e eventos

CCEE: conector isolado → normalização → validação → apuração. Antes da API, dados manuais revisados podem usar o mesmo formato. Guardar identificador externo, competência, versão e conciliação para evitar duplicidade.

OCR: extrair campos com arquivo/página e evidência, valor original, confiança e correção humana. Faturas precisam ser revisadas e conciliadas antes de alimentar resultados publicados. Separar arquivo recebido, extração proposta e valor validado. Uma imagem ou PDF não prova por si só a competência nem o valor tributário.

Dashboards do Backoffice e cliente devem consumir a apuração publicada. Eventos de possível desperdício, ultrapassagem ou energia reativa incluem parâmetro, limiar, período e evidência; sinalizar necessidade de análise em vez de afirmar desperdício sem validação. API CCEE e OCR não contêm regras financeiras próprias.

## Próximas entregas e critérios de aceitação

1. Etapa 4A: telas e API de tarifas, perfis tributários e custos versionados; revisão de escopo, sobreposição e dados ausentes.
2. Etapa 4B: apuração ACL/ACR com memória, composição de base tributária, honorários, rateio, arredondamento e snapshots. Testar ICMS incluído/excluído, créditos, IOF não aplicável, economia negativa, honorário fixo/variável, troca de tarifa no período e isolamento.
3. Etapa 4C: revisão/aprovação/publicação e consolidação por unidade/cliente/organização; reconciliação com exemplos reais revisados.
4. Etapas seguintes: OCR, conectores CCEE, indicadores e eventos consumindo os resultados validados.

Esta proposta não entrega indicadores financeiros reais antes dessas validações. Os indicadores cadastrais atuais permanecem distintos de economia energética calculada.
