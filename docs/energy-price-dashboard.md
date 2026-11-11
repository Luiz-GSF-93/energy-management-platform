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

Tabelas com RLS, sem acesso direto de anon/authenticated/service_role. Apenas RPCs específicos do backend, com validação de organização, ator, função e escopo. A ingestão PLD depende da API habilitada e da agenda homologada, com os limites de requisições existentes.

## Atualização após publicação

A confirmação de publicação do PLD e da referência anual emite o aviso comum de atualização. O aviso entre abas contém somente um marcador temporal, nunca dados financeiros ou credenciais. Cada painel consulta novamente sua API autenticada e reconfere o recorte de empresa/unidades.

O painel de preços usa uma única rotina de atualização a cada minuto, com a página visível, e consulta novamente ao retornar à aba. Se uma consulta estiver em andamento, avisos e ciclos periódicos são reunidos em uma única reconferência posterior, sem abortar a resposta por lentidão. Durante a conferência anual marcada ou a publicação, a reconferência aguarda o fim da ação. Mudanças de organização, empresa, unidade ou ano continuam descartando a resposta anterior. A tela mostra o horário da última consulta concluída em Brasília.

O cartão PLD apresenta média de mês encerrado e sua competência; a publicação só utiliza todas as horas e os quatro submercados conferidos. A coleta horária continua na agenda própria, mas não transforma novembro parcial em média mensal definitiva nem altera fechamentos publicados. Referência ausente continua como lacuna, sem valor presumido.
