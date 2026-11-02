ENERGYOS — POLÍTICA PROPOSTA DE RETENÇÃO E ARQUIVAMENTO DE LOGS — V1
Data: 02/11/2026 | Situação: política aprovada; implementação com simulação inicial, sem descarte definitivo automático.

1. OBJETIVO E ALCANCE
Reduzir exposição de dados pessoais e crescimento do banco, preservando rastreabilidade e evidências necessárias. Abrange logs técnicos, eventos de auditoria e segurança do EnergyOS, por organização e no escopo global. Não altera a guarda dos arquivos originais, NFs, contratos, assinaturas, apurações ou tabelas financeiras: esses dados de negócio exigem política própria. Classificar o evento não autoriza excluir o documento relacionado.

2. FUNDAMENTO E RESPONSABILIDADE
Os prazos abaixo são parâmetros internos propostos, não prazos impostos universalmente pela LGPD. A ANPD esclarece que a duração depende da finalidade e da circunstância; encerrado o tratamento, aplicam-se as regras de eliminação e as hipóteses legais de conservação. O controlador deve documentar finalidade, fundamento aplicável, necessidade, responsável, versão da política e revisão. Organização e plataforma têm responsabilidades distintas conforme o tratamento e os instrumentos contratados.
Arquivar, criptografar ou pseudonimizar não elimina por si só a incidência da LGPD. Hash de identificação não deve ser chamado automaticamente de anonimização. Armazenamento frio também está sujeito ao prazo de guarda e aos direitos dos titulares.

3. MATRIZ CONSOLIDADA — PRAZO TOTAL, NÃO PRAZO EM CADA CAMADA
INFO — 12 meses: login/logout comuns, consulta de tela, abertura de dashboard e navegação sem ação administrativa privilegiada. Ao vencer: avaliação de descarte controlado; não preservar por 24 meses somente para cumprir a regra de arquivamento.
MEDIUM — 36 meses: cadastro e edição comuns de registros que não estejam nas exceções críticas. Cadastro de usuário, alteração financeira ou contratual não entram aqui.
SEGURANÇA — 60 meses: sinais/tentativas de invasão, alteração de senha, eventos MFA, bloqueio de conta e acesso administrativo. Nenhuma senha, código MFA, token ou segredo é guardado no log. Não confundir alerta grave com guarda eterna automática. Incidente com obrigação de preservação recebe impedimento de descarte documentado.
HIGH — 120 meses: evidências e eventos relacionados a financeiro, faturas e contratos que não constituam alteração financeira/contratual, aprovação ou outra exceção crítica.
CRITICAL — sem eliminação automática, sujeito a finalidade/fundamento vigentes e revisão anual: criação/exclusão de usuários; alteração de permissões; exclusões de documentos/negócios; alterações financeiras e contratuais; alteração de tarifas; aprovações eletrônicas; assinaturas digitais; registros de compliance; ações privilegiadas de Super Admin. Não significa guarda pessoal perpétua sem justificativa. Sem necessidade/fundamento vigente, encaminhar para decisão de eliminação ou anonimização efetiva, preservadas obrigações e impedimentos válidos.

Precedência: exceção CRITICAL > registro de segurança > HIGH > MEDIUM > INFO. Prazo jurídico/contratual específico e impedimento de descarte são avaliados antes da execução. Um prazo maior só se aplica com fundamento registrado; um pedido de eliminação também deve ser avaliado quando cabível, sem transformar o prazo interno em obrigação automática de conservar.
As alternativas genéricas de 5/7/10 anos não serão sorteadas por categoria: esta V1 usa os prazos da matriz acima; regras específicas de 7 anos poderão ser cadastradas apenas com motivo, fundamento, responsável e aprovação.
Severidade do erro/alerta e classe de retenção são campos distintos. Um HTTP 500 ou uma tentativa de login isolada não transforma todo o conteúdo em CRITICAL indeterminado.
As ações privilegiadas de Super Admin são alterações de controle, concessões, decisões e operações sensíveis. Navegação comum e polling do administrador não serão convertidos indistintamente em guarda indeterminada.

4. CONTAGEM E VENCIMENTO
Contar o prazo a partir da data documentada da operação (occurred_at/created_at/recorded_at), em UTC. Não usar a competência retroativa da fatura como idade do log. Anos/meses de calendário, com testes de anos bissextos. Exceção que dependa de outro marco deve informá-lo expressamente, sem presumir o encerramento de contratos ou disputas.
Movimentar o registro entre camadas não reinicia o prazo. Evento sem classificação, data ou origem comprovadas vai para revisão; não receberá INFO por padrão para autorizar descarte.

5. CAMADAS DE ARMAZENAMENTO
Principal: eventos ainda necessários com até 24 meses; consulta rápida, índices por organização/escopo, data e identificadores necessários. A retenção mais curta prevalece: INFO vencido aos 12 meses não fica ativo até 24 meses.
Histórico: a partir de 24 meses, eventos ainda dentro do prazo e evidências críticas conservadas passam a audit_logs_archive, com consulta paginada e controle de acesso equivalentes ao principal. MEDIUM permanece até 36 meses; segurança até 60 meses, salvo extensão válida.
Frio: a partir de 60 meses, somente eventos com prazo remanescente ou conservação justificada. HIGH segue até 120 meses; CRITICAL segue enquanto houver fundamento vigente, com revisão. Segurança que vence aos 60 meses não é exportada para frio apenas para continuar armazenada sem necessidade.
Frio não é backup nem pesquisa instantânea: haverá manifesto pesquisável e solicitação de restauração autorizada. Prazo e custo de recuperação serão exibidos conforme provedor homologado; nenhuma promessa de acesso imediato.
Mover entre tabelas do mesmo banco, sozinho, não garante economia de armazenamento. Avaliar volume, índices, compressão, manutenção, backup, custo de exportação, armazenamento e recuperação. Não executar VACUUM FULL, reescrita ou troca de banco automaticamente.

6. IMPEDIMENTO DE DESCARTE E DADOS PESSOAIS
Retenção por investigação, obrigação ou disputa exige fundamento, escopo, responsável, motivo e data de revisão. O impedimento suspende descarte/anonimização incompatível com a finalidade; pode permitir mudança de camada se integridade, acesso e recuperabilidade forem preservados. Não bloquear todo o tenant sem necessidade.
Guardar somente metadados pertinentes: não duplicar corpos de faturas, prompts, respostas integrais, senhas, cookies, tokens, chaves, códigos de liberação ou URLs assinadas. IP e identificadores exigem minimização própria; não se tornam permanentes porque o evento é crítico.
A janela técnica anterior de 180 dias será substituída pela consulta de até 24 meses nesta ampliação. A proposta não estende automaticamente a guarda de IP a 10 anos ou ao indeterminado: dados identificáveis necessitam justificativa e revisão por finalidade. Minimização/anonimização de dados já existentes requer decisão auditada e compatibilidade com evidências/impedimentos; nunca reescrever silenciosamente o original imutável.

7. ROTINA MENSAL PROPOSTA
Dia 1, às 03:00 de Brasília, independentemente de login. Se o serviço estiver indisponível, retomar o ciclo pendente uma vez, usando chave de idempotência, lease e cursor por organização. Não disparar cópias paralelas em múltiplas réplicas.
Sequência: inventariar > classificar com versão > conferir prazo e impedimentos > simular lote > copiar/validar histórico ou exportação > confirmar manifesto e recuperabilidade > remover somente a cópia de origem por operação de manutenção restrita. Preservar ID, organização, data, conteúdo canônico e checksum. Qualquer incerteza interrompe a remoção da origem.
A movimentação é recuperável a partir do histórico/frio verificado; não é exclusão definitiva. Os controles de imutabilidade só admitirão essa transferência específica, com prova da cópia e autorização do job. Não haverá desativação geral de triggers/RLS.
Registros com prazo vencido seguem fila de disposição. A primeira entrega não executa exclusão definitiva automática: exige aprovação administrativa do lote exato, justificativa e ausência de impedimentos, além da homologação da rotina de descarte. O painel distinguirá vencido, aguardando decisão, conservado por fundamento, arquivado e efetivamente eliminado; não anunciará redução de dados enquanto a fonte existir.

8. ARQUIVO FRIO, RESTAURAÇÃO E BACKUPS
Pacotes mensais separados por organização e escopo; nenhum pacote mistura empresas. Conteúdo canônico comprimido, cifrado e com manifesto/checksum, contagem, versão de política, período e referências estáveis. Manifesto não contém payloads ou IP em texto de pesquisa.
A integração deve ter destino privado, credencial própria com privilégio mínimo, região e custos aprovados. Não reutilizar nem alterar expertenergy-ocr ou expertenergy-ai. Sem destino homologado, o estado será AGUARDANDO_ARMAZENAMENTO e a origem será preservada.
Na restauração, checar autorização atual, escopo, fundamento, manifesto e hash; usar cópia temporária com expiração configurada, sem tornar o objeto público. Auditar pedido, disponibilidade e acesso. Bloqueio de acesso é imediato após revogação, inclusive para resultados restaurados.
Backups/PITR são tratados separadamente: esta entrega não muda automaticamente a retenção do provedor. A restauração do banco deverá reaplicar disposições/impedimentos antes de reabrir acesso, evitando ressuscitar dados já eliminados. Não prometer eliminação instantânea de cópias de backup imutáveis.

9. GOVERNANÇA E ACOMPANHAMENTO
Painel na Auditoria Global: última/próxima execução, lotes, contagens por classe/camada, bytes observados, falhas, impedimentos, revisões anuais e fila de vencidos. Valores de economia somente com fonte e comparação real; projeção identificada como estimativa.
Organização consulta somente seu histórico e suas solicitações autorizadas. Owner gerencia política, exceções e lotes; isso não permite acessar dados de outra organização por parâmetro livre. Consulta atual da auditoria não concede implicitamente poderes de descartar ou administrar armazenamento.
Revisão anual da política e de retenções indeterminadas; revisão após incidente, mudança normativa, contrato ou encerramento de serviço. O ciclo não depende da renovação comercial do plano.

10. FONTES OFICIAIS CONSULTADAS EM 02/11/2026
ANPD, perguntas 5.5 e 6.6: https://www.gov.br/anpd/pt-br/acesso-a-informacao/perguntas-frequentes
Microsoft, níveis de acesso: https://learn.microsoft.com/en-us/azure/storage/blobs/access-tiers-overview/
Microsoft, recuperação de Archive e custos/latência: https://learn.microsoft.com/en-us/azure/storage/blobs/archive-rehydrate-overview
PostgreSQL, manutenção e espaço: https://www.postgresql.org/docs/current/routine-vacuuming.html
Estes documentos embasam as cautelas; não são validação jurídica individual da política nem orçamento de provedor.
