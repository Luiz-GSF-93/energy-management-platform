# F1.87 — Conferência auditável de identidade e competência

Em Documentos > Conferir identidade e competência, a nova seção permite ao Gestor/Administrador conferir razão social, CNPJ, UC, endereço, competência e ambiente. Registra justificativa, autor autenticado, data, versão e evidências originais; preserva a confiança fornecida pelo OCR.

Somente texto compatível com cadastro atual, com página identificada e sem conflitos, pode ser confirmado. Duplicidade bloqueia confirmação. Ausências e divergências permitem registrar necessidade de correção. PDF e justificativa são obrigatórios. O cadastro não é alterado para coincidir com a fatura.

Cada registro vincula o snapshot do cadastro e o job OCR. Mudanças invalidam a aplicabilidade atual, preservando o histórico. Bloqueios de linha conferem o cadastro novamente na gravação; versão esperada impede sobrescrita concorrente; request_id permite repetição idempotente.

Migração: 20260927_f1_87_ocr_identity_reviews.sql. Tabela append-only, RLS, acesso SELECT/INSERT exclusivo do serviço, gatilho com proprietário confiável e search_path restrito. Nenhuma atualização de jobs ou resultados concedida.

Validação: testes do serviço, comparação e autorização; 18 verificações SQL sob service_role; interface real em JSDOM (justificativa, recibo, histórico, UC literal e mudança cadastral), regressões dos painéis de consumo/demanda. Ajustado teste legado de limites de escrita para fornecer o autor exigido desde F1.84.

Próximos checkpoints: consolidar conferências vigentes com reconciliação de demanda, tarifas, tributos e totais; persistir decisão de homologação; integrar somente os dados liberados a parâmetros, dados/custos mensais e preparação, sem substituir registros existentes. Esta etapa não homologa automaticamente o layout nem libera importação.

Validação em produção: o painel carregou os seis campos da Del Rei. Ausência de confiança ou confiança intermediária permite conferência humana explícita com origem válida; UNVERIFIED_SOURCE e confiança abaixo de 45% permanecem bloqueadas. Ajuste coberto por 55 testes de identidade e build backend.
