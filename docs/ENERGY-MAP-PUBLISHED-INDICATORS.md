# Mapa — resultados publicados (etapa 3)

A unidade selecionada consulta, por ação explícita, `/api/v1/financial-settlements/reports`, com organização autenticada e cliente/unidade/período específicos. A rota existente exige permissões de relatórios e contratos e licença do módulo financeiro. O mapa não cria outro motor de apuração, não altera publicações e não agrega prévias ou rascunhos.

O frontend verifica organização, cliente, unidade, período, cobertura e versões/hashes antes de renderizar. Troca de organização, unidade, usuário ou perda da permissão descarta a consulta. Meses sem publicação não são zero. Valores monetários preservam os decimais retornados pelo backend.

Alertas: economia após honorários negativa em um mês publicado; achados, qualificações e ressalvas preservados na versão publicada. Cada alerta informa mês, versão, grupo e hash. Não há alerta de ultrapassagem de demanda inventado a partir de cadastro atual nem notificações externas automáticas.

Portal: reutiliza `/portal`, cujo backend deriva o cliente do vínculo externo exclusivo vigente e revalida vínculo, permissão, cliente ativo e licença. O mapa oferece apenas a prévia administrativa já existente a Gestor/Admin da organização ou sessão operacional da plataforma. Operador não recebe esse link. A prévia não cria contas nem concede acesso. O mapa global continua exclusivo do administrador da plataforma; valores financeiros exigem entrada na organização autorizada.

Validação: teste DOM/pureza com escopo estrangeiro, resposta antiga, permissão revogada, hash divergente, publicação duplicada, economia negativa e período sem publicação; regressões do portal e da análise financeira existentes. A etapa 4 adicionará o Score de economia e a consulta comercial por raio após o checkpoint desta etapa.
