# F1.90 — Integração auditável de consumo OCR

Acompanhar homologação agora consulta e integra os três consumos conferidos da fatura em um primeiro rascunho de Dados mensais. Identidade atual (6 campos) e consumo (3 campos) precisam estar confirmados, com hashes atuais. Organização, autor e valores vêm do servidor. O navegador envia apenas o token da prévia.

A função transacional bloqueia revisão concorrente, origem alterada, cadastro inativo, duplicidade e qualquer registro mensal existente. Não substitui rascunhos ou versões validadas. Repetições retornam a integração existente. O histórico imutável preserva as nove conferências e o vínculo com documento/hash e autor. O registro recebe origem OCR_REVIEWED; a auditoria mensal existente registra a criação. A validação posterior revalida as conferências e o cadastro antes de aceitar o rascunho.

Demanda medida, reativo e demanda faturável permanecem não informados; classificação de parcelas faturadas não comprova medição. A integração não aprova a apuração financeira. Parâmetros/tarifas, custos/tributos, GD e preparação final seguem pendentes de integração específica e reconciliação. Cobrança automática e emissão fiscal permanecem futuras.

Segurança: leitura exige documentos e contratos; criação exige Gestor/Administrador e criação de contratos; licença free_market_management mais document_management nos serviços OCR. RLS e permissões de origem são preservadas. A tabela nova não permite INSERT/UPDATE/DELETE/TRUNCATE direto ao service_role; apenas a RPC estreita registra a integração. Navegador autenticado/anon não executa a RPC.

Validação: 576 testes OCR, 840 testes de contratos, 28 verificações SQL PGlite (inclui permissões padrão Supabase, alteração de revisão, preservação de existente e ausência de resíduo), dois testes de interface e builds backend/frontend. Migração aplicada antes da publicação. Teste da RPC real na fatura Del Rei agosto 2026 retornou DRAFT dentro de transação com ROLLBACK; sem aprovação financeira.
