# Operação — primeira entrega backoffice

Agenda, solicitações e eventos têm cadastro, edição versionada, responsável, prioridade, vínculos opcionais com cliente/unidade e documento privado existente, filtros por período/cliente e histórico de autoria e motivo. Solicitações exigem cliente, prazo e tipo; agenda exige início e valida término. Não há envio externo automático.

Agenda/solicitações: aberto → em andamento/aguardando/concluído/cancelado. Eventos: rascunho → revisão → publicado → arquivado; revisão pode voltar a rascunho. Publicação exige gestor/administrador; publicados não são sobrescritos. Publicação nesta etapa é interna ao backoffice, sem nova exposição ao portal do cliente. Aprovação financeira continua exclusiva do fluxo financeiro existente.

O sino e a caixa de notificações mostram revisões vigentes de atividades, solicitações e eventos autorizados, prioridade, origem, prazo vencido e leitura por usuário/organização. Uma nova revisão gera nova notificação. Alertas OCR, contratos, licenças e canais externos permanecem como ampliação posterior, sem simular entregas inexistentes.

PLD exibe explicitamente que aguarda agendamento/emissão do certificado e habilitação da Plataforma de Integração CCEE. Não consulta, sincroniza ou apresenta preço fictício.

## Segurança e persistência

Reutiliza permissões Operação existentes e licença free_market_management. Todas as APIs verificam organização ativa, usuário, perfil backoffice, permissão específica e licença. Perfil consulta/cliente e contexto global não recebem dados. Responsáveis precisam de vínculo ativo; documento precisa estar recebido e pertencer ao cliente/unidade. Não concede permissões a usuários.

Migration aditiva 20261003_f3_1_operations.sql: novas tabelas com RLS, leitura somente por service_role e escrita por RPC auditada. Não reutiliza a tabela legada de notificações sem tenant. Histórico imutável; controle de revisão e chave de idempotência evitam sobrescrita concorrente e duplicação em repetição de requisição. RPC valida novamente vínculos, ator e estados. Sem alteração de apurações, tarifas, custos publicados ou dados legados.

Aplicar somente após inspeção do catálogo real e testes. Verificar marcador operation_module_versions, RLS, grants restritos e sucesso das três RPCs. Não repetir migration após resultado incerto sem consultar marcador. Não há exclusão de registros pela interface.

## Validação

Teste SQL em PostgreSQL embarcado: 29 verificações de isolamento, idempotência, conflito de revisão, vínculos, publicação exclusiva, imutabilidade, leitura de notificações e negação de escrita direta/browser. Testes de serviço verificam tenant, RBAC, licença, filtros e fluxo. Builds e regressões devem acompanhar a integração.
