# F1.27 — APIs de configurações contratuais

Honorários e serviços não devem usar os campos de compra de energia. Esta etapa adiciona APIs específicas no módulo de contratos: honorários por cliente (fixo/híbrido), intermediação/outros serviços com contraparte, escopo e regra descritiva, e histórico de preços por vigência de contrato de energia. A interface será publicada em etapa imediatamente posterior para evitar rotas indisponíveis.

Todas as rotas exigem organização, permissões de contratos e licença free_market_management. Pais são validados dentro da organização. O backend não recebe organização pelo corpo. Honorários pertencem ao cliente como um todo; serviços podem abranger cliente ou unidade validada. Valores e datas têm validações específicas. Não é calculada cobrança automática nem marcada aprovação de cálculo.

Migração aditiva: application_rules em management_contracts, tabela service_agreements e proteções de histórico. Não altera registros existentes. RLS e revogação de acesso anon/authenticated/PUBLIC nas três tabelas; service_role recebe leitura/inserção. Gatilhos impedem alterações/exclusões de configurações históricas e sobreposição de períodos de honorários/preços. Honorários são serializados por cliente e preços bloqueiam o contrato pai. Novas vigências requerem término definido. Nenhum dado real foi criado ou excluído para testes.

Validação: 58 suítes / 624 testes backend, build backend; 19 verificações de PostgreSQL isolado com PGlite, incluindo repetição da migração, isolamento, histórico imutável, sobreposição e permissões de tabela. A migração foi aplicada com sucesso no Supabase autorizado ygvukbovagyvjavocypr.

Limites: ainda não há motor de apuração, correção/encerramento antecipado de vigências registradas, aprovação de preços, aditivo contratual completo ou rateio de honorários por unidade. Os valores já registrados não podem ser sobrescritos. Registros antigos com períodos abertos podem impedir vigências sobrepostas e exigem tratamento futuro explícito. Rollback deve desativar as rotas/telas, preservando tabelas e dados; não apagar o histórico.
