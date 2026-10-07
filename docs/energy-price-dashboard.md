# Dashboard de preço da energia

## Referências e unidades

Todas as séries usam R$/MWh. ACR antes da adesão é a soma de TE ponta e fora ponta, com tributos, menos somente os créditos GD da TE, dividida pela soma do consumo medido ponta e fora ponta, multiplicada por 1.000. TUSD, demanda, bandeira, encargos e honorários não entram neste indicador. O denominador inclui o consumo compensado por GD.

O histórico de 12 meses consecutivos aprovado no processo usa as tarifas da fatura de referência e as hipóteses GD configuradas no estudo. É uma referência estimada, não prova de 12 faturas quitadas. A linha anual permanece constante no ano comparado; o painel informa o período da fonte.

Compra ACL mensal usa custo publicado da energia do fornecedor (incluindo mínimo contratual e compra extra), com tributos, dividido pelo consumo medido publicado. Não prova quitação. Para preço GROSS não são removidos tributos presumidos. Preço NET exige memória tributária com bases somente do fornecedor; bases misturadas à distribuidora bloqueiam este indicador.

Score de preço (%) = (ACR específico − compra ACL específica) / ACR específico × 100. Score positivo indica compra ACL de energia abaixo da referência ACR; não representa economia total da fatura.

PLD permanece indisponível até a integração CCEE fornecer médias mensais verificadas por submercado. Não são criadas séries fictícias. Submercado vem da localização da fatura. Para submercados diferentes no consolidado, a média PLD exige consumos mensais de todas as unidades e ponderação por consumo.

## Indicativo sem tributos

O indicativo inicial é o menor entre ACR líquido e compra ACL líquida. Na ausência de compra líquida publicada, pode usar o preço líquido da proposta do estudo, com as perdas explicitamente configuradas, identificado como cenário. Não presume alíquota para remover tributos. O aviso é “não contém tributo na indicação”. Ausência de referência líquida bloqueia a indicação. Proposta não é compra realizada nem autorização para contratar.

## Consolidação e publicação

Consolidado reúne unidades de um único cliente, ponderando soma dos custos / soma dos consumos. Compra média anual considera somente competências com cobertura completa das unidades selecionadas. Dados ausentes não são zero e não conectam trechos interrompidos da linha.

O backoffice usa contexto, função, licença e relacionamentos vigentes; prévias internas exigem fontes históricas ainda válidas. Portal aceita somente consulta externa vinculada a um cliente e nunca lê estudos internos. Referência ACR publicada exige estudo íntegro, fonte vigente, revisão independente e confirmação pelo gestor; a publicação preserva snapshot e autoria imutáveis. Publicar referência de preço não aprova a migração ACL.

Tabelas com RLS, sem acesso direto de anon/authenticated/service_role. Apenas RPCs específicos do backend, com validação de organização, ator, função e escopo. PLD possui tabela preparada; ingestão pelo adapter CCEE depende da habilitação da API e não está ativa nesta entrega.
