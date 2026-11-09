# EVA: recepÃ§Ã£o e retomada de documentos

O recebimento mantÃ©m PDF (15 MB), JPEG/PNG e acrescenta XML fiscal NF-e modelo 55 e NF3e modelo 66 (2 MB, UTF-8). O portal do cliente continua restrito Ã  fatura da distribuidora; NF-e do fornecedor Ã© recebida pela equipe interna.

XML Ã© validado antes da reserva e novamente no processamento, sem Azure OCR. Entidades/DTD, instruÃ§Ãµes de processamento, namespaces divergentes, profundidade excessiva, duplicidade de destinatÃ¡rio e chaves inconsistentes sÃ£o recusados. Hash e tamanho vinculam os bytes ao tenant, cliente, unidade e competÃªncia. XML nÃ£o Ã© renderizado como documento ativo; a conferÃªncia mostra texto escapado ou oferece download. A leitura nÃ£o verifica criptograficamente assinatura nem situaÃ§Ã£o na SEFAZ e nÃ£o representa aprovaÃ§Ã£o financeira.

O perÃ­odo vem de `gFat/CompetFat` ou referÃªncia explÃ­cita, nunca da emissÃ£o ou vencimento. CNPJ vÃ¡lido de mesma raiz requer correspondÃªncia de unidade/endereÃ§o/perÃ­odo. UC antiga exige decisÃ£o auditada vinculada Ã  fonte quando ainda nÃ£o consta do histÃ³rico. Escolher manualmente unidade/mÃªs nÃ£o comprova o conteÃºdo.

A nota do fornecedor pode propor quantidade MWh, preÃ§o e total quando um Ãºnico item de energia reconcilia exatamente com o total. Tributos nÃ£o sÃ£o presumidos isentos. NF3e preserva os itens estruturados; campos sem mapeamento financeiro homologado continuam em conferÃªncia, sem simular layout de distribuidora ou confianÃ§a OCR. XML NFS-e e outros modelos nÃ£o fazem parte desta admissÃ£o.

O worker nÃ£o baixa o original a cada GET de polling ainda em andamento. Um fingerprint calculado no banco substitui as mÃºltiplas viagens HTTP para capturar fontes; os limites e a comparaÃ§Ã£o antes/depois continuam ativos. A explicaÃ§Ã£o opcional por IA tem tarefa durÃ¡vel prÃ³pria, criada na transaÃ§Ã£o de preparaÃ§Ã£o; nÃ£o bloqueia o preenchimento determinÃ­stico. IntenÃ§Ã£o de inferÃªncia interrompida fica UNKNOWN, sem repetiÃ§Ã£o paga automÃ¡tica.

Resultados incertos usam o procedimento administrativo existente de reconciliaÃ§Ã£o. O botÃ£o reconfere efeitos, fonte e autorizaÃ§Ãµes; nÃ£o repete OCR, aprova ou publica valores. RevogaÃ§Ã£o de licenÃ§a, vÃ­nculo ou delegaÃ§Ã£o continua bloqueando o trabalho.

Aplicar migraÃ§Ãµes 20261286, 20261287, 20261288 e 20261289 antes do backend novo. SÃ£o aditivas, sem reprocessar publicaÃ§Ãµes financeiras. Para rollback de aplicaÃ§Ã£o, reverter frontend/backend; preservar originais, leituras e auditoria. NÃ£o enviar XML durante rollback para um worker anterior, que desconhece esse formato.

ValidaÃ§Ã£o: testes de parser hostil/identidade, worker, serviÃ§o e PGlite com isolamento, lease invÃ¡lido, idempotÃªncia, revogaÃ§Ã£o, fingerprint e tarefa opcional. O alerta de CPU exige acompanhamento de mÃ©tricas reais; reduzir viagens HTTP nÃ£o comprova, sozinho, queda de CPU ou SLA de produÃ§Ã£o. A implantaÃ§Ã£o nÃ£o altera plano pago, RLS, credenciais ou aprovaÃ§Ã£o financeira.

Leiaute NF3e: [MOC oficial da SEFAZ-SP](https://portal.fazenda.sp.gov.br/servicos/nf3e/Paginas/Downloads.aspx). As polÃ­ticas existentes de desperdÃ­cio reativo/ultrapassagem de demanda e publicaÃ§Ã£o ao cliente nÃ£o sÃ£o substituÃ­das por esta mudanÃ§a.

## CPU e conflitos nÃ£o repetÃ­veis

O incidente mostrou milhÃµes de transaÃ§Ãµes de configuraÃ§Ã£o, poucos pedidos HTTP e erros repetidos `Original request changed` com SQLSTATE `40001`. A [base oficial do Supabase](https://supabase.com/kb/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b) documenta tentativas infinitas no PostgREST 14 quando um conflito de negÃ³cio usa esse cÃ³digo.

A migraÃ§Ã£o 20261289 troca somente o cÃ³digo dos conflitos explÃ­citos do recebimento EVA por `PT409`, mantendo condiÃ§Ãµes, mensagens, permissÃµes e rejeiÃ§Ã£o da solicitaÃ§Ã£o alterada. Falhas reais do motor mantÃªm sua semÃ¢ntica. NÃ£o introduzir `40001` como erro de negÃ³cio em novos fluxos. Os mÃ³dulos legados fora do recebimento ainda exigem revisÃ£o prÃ³pria antes de qualquer normalizaÃ§Ã£o abrangente.

SessÃµes jÃ¡ presas precisam ser identificadas por PID nos logs e conferidas em `pg_stat_activity` antes de encerramento pontual. NÃ£o reiniciar o projeto nem encerrar conexÃµes indiscriminadamente. Medir CPU e variaÃ§Ã£o de contadores apÃ³s a correÃ§Ã£o; o banner pode refletir uma janela anterior.

## Retomada anterior Ã  explicaÃ§Ã£o opcional

A migraÃ§Ã£o 20261290 permite reconciliar um resultado UNKNOWN com `ai_attempted=false` somente quando o Ãºltimo fechamento que inclui a unidade contÃ©m o documento e hash exatos e estÃ¡ INCOMPLETE ou READY_FOR_REVIEW. Todos os controles anteriores de vÃ­nculo/licenÃ§a/permissÃ£o, lease, OCR concluÃ­do, cadastro ativo, rascunhos reconhecidos como PREPARED/PARTIAL, fonte Ãºnica e ausÃªncia de aprovaÃ§Ã£o continuam vigentes. NÃ£o repetir uma gravaÃ§Ã£o UNKNOWN/RUNNING e nÃ£o usar um fechamento antigo para encobrir uma versÃ£o mais recente com outra fonte.

## Modo da transação dos RPCs de fontes

A migração 20261291 declara fingerprint e catálogo de aliases VOLATILE porque a cadeia de autorização existente usa FOR SHARE. O PostgREST inicia RPCs STABLE em READ ONLY, causando SQLSTATE 25006 antes do preenchimento. Mantêm-se bloqueios, verificações e privilégios; somente o modo da transação é corrigido. O teste reproduz o erro em READ ONLY e valida o modo escolhido pelo metadado das funções.

## Painel operacional e melhorias comuns a todas as organizações

O painel em `/backoffice/documents/operations` apresenta recebidos e propostas da janela de 30 dias, filas técnica/humana/de fontes, etapa registrada, tempo sem atualização, próxima consulta, decisão de identidade já salva e explicação opcional separada. Pendências antigas continuam visíveis. Não interpreta consulta periódica como nova leitura paga nem como falha. Paginação de 25 envios, índices por organização e uma consulta autenticada a cada 30 segundos somente com a página visível. Falha de consulta aparece como erro com horário do último dado, sem mostrar zero artificial.

A projeção usa o vínculo, papel e permissões reais no banco (`eva_intake_actor`), exige equipe interna e não retorna OCR/XML, URL do provedor, hash ou credencial. O backend recebe a organização do contexto autenticado; a consulta não aceita outra organização. Usuários externos não acessam esta visão. Uma decisão de identidade exibida não significa que uma alteração de fonte esteja aprovada.

O recebimento usa rollout GLOBAL quando o recurso principal está ligado. A lista histórica de IDs não restringe mais as melhorias. `EVA_AUTOMATIC_INTAKE_ROLLOUT=ALLOWLIST` é rollback explícito para a lista antiga; o interruptor principal continua disponível. Workers descobrem no banco até 100 organizações com trabalhos vencidos, licença vigente única e automação habilitada; ordenação favorece o trabalho mais antigo. Somente IDs concretos chegam ao claim. O claim revalida autor, delegação, licença e escopo antes de cada efeito. Uma nova organização herda o mesmo processador sem nova variável de ambiente, desde que tenha contratado o módulo e configurado sua própria delegação/consentimento. Não são copiadas permissões, dados de cliente, contratos, justificativas de UC, alíquotas ou aprovações de outra organização.

As correções de PDF/XML, CPU/conflitos, recuperação, identidade matriz/filial, desperdícios, CCEE/PLD e concessão pelo administrador permanecem código/migrações compartilhados. Cadastros e evidências continuam específicos da organização. Recursos experimentais não relacionados (por exemplo mapas e RAG) mantêm suas próprias licenças e controles; este rollout não os ativa nem concede novas permissões.

A tela Documentos agora monta a conferência OCR somente do documento selecionado. Antes, componentes ocultos de todos os documentos eram montados e consultavam status independentemente. O link do painel abre a conferência pela navegação de documento já existente, sem iniciar OCR ou IA.

Não é necessária uma troca imediata para RabbitMQ/Azure Service Bus. As filas duráveis, a preparação determinística e a explicação separada existentes atendem este incremento. Broker, OpenTelemetry/Prometheus/Grafana e dashboard executivo completo permanecem evoluções condicionadas a métricas e desenho de acesso/custo; não são apresentados como implementados. O painel identifica bloqueios, mas não elimina ausência de fonte, revogação ou decisão humana legítima.

Migração 20261292: funções service-only, índices e projeção; nenhum resultado financeiro, licença, vínculo ou delegação é alterado. Implantar migração antes de ativar o código global. Rollback do código: ALLOWLIST; manter funções/índices e históricos, sem desfazer resultados.

Migração 20261293: o painel reutiliza a prova de publicação por documento/hash, versão, decisão e publicação vigentes, em lotes de até 100 IDs. Uma publicação comprovada prevalece na apresentação sobre um erro antigo do recibo. O recibo e o histórico originais não são reescritos; retirada de publicação ou fonte alterada desfaz essa projeção.
