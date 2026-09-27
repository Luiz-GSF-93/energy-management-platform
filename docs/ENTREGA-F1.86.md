# F1.86 — Persistência das conferências OCR

Os dois gatilhos de conferência executavam SELECT FOR SHARE em document_ocr_jobs como service_role, que possui apenas SELECT. O PostgreSQL exige UPDATE para esse bloqueio e retornava 42501 antes de registrar o histórico.

A migração executa somente os gatilhos existentes com os privilégios do proprietário confiável, search_path restrito a pg_catalog e referências públicas qualificadas. Não concede UPDATE sobre jobs/resultados à API e preserva todas as verificações de origem, organização, snapshot, concorrência e imutabilidade. Execução direta das funções revogada dos papéis de aplicação.

Validação: node backend/test/database/verify-ocr-review-permissions.mjs — 32 verificações; reproduz o erro original sob service_role antes da correção e testa ambos os fluxos após a migração.

Aplicar backend/src/database/migrations/20260927_f1_86_ocr_review_trigger_permissions.sql com o proprietário confiável das funções. Esta alteração não homologa a fatura nem altera medições ou apurações.
