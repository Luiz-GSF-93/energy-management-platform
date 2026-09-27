# F1.100 — Resumo dos tributos incluídos na CDE

Após a confirmação auditada das duas descrições, a integração cria os parâmetros CDE em rascunho, preservando origem, autor e histórico. O painel agora mostra os destaques por posto e os totais de ICMS, PIS e Cofins das duas linhas CDE, além do valor bruto e do total de tributos já incluídos.

A soma usa centavos inteiros. Campos ausentes, sem origem verificável, com confiança insuficiente, precisão inválida ou linhas duplicadas ficam sem total; zero só é usado se explicitamente extraído. Linhas TUSD e créditos não entram no resumo CDE. Não altera parâmetros tributários existentes nem acrescenta cobrança à tarifa GROSS.

Del Rei agosto/2026: CDE R$ 57,19 + R$ 501,34 = R$ 558,53; ICMS R$ 100,53, PIS R$ 4,71 e Cofins R$ 22,13 já incluídos. Os dois rascunhos CDE foram criados após as confirmações do operador; aprovação dos parâmetros e ampliação da cobertura das declarações tributárias permanecem pendentes.

Validação: testes de soma exata, fonte, confiança, duplicidade, valores ausentes versus zero, integração e DOM; builds backend/frontend. Sem migração de banco.
