# F1.96 — Tributos incluídos na TUSD OCR

Painel de homologação apresenta ICMS, PIS e Cofins destacados na TUSD ponta e fora ponta, com soma decimal exata e ausência preservada. Permite criar três declarações TAX/INCLUDED em rascunho somente após aprovação dos dois parâmetros TUSD originais, com valores, postos e vigência compatíveis, identidade/consumo atuais e evidência válida.

O servidor deriva escopo, bases e valores. As referências fixam IDs e revisões aprovadas. Lote único, IDs determinísticos, bloqueio de declarações existentes, token de prévia e autoria/auditoria existentes. Não aprova parâmetros e não adiciona tributos novamente. Os destaques são evidência em notas, não alíquota inferida nem cobrança extra. CDE, outras componentes e cenário ACR não estão abrangidos.

Migração 20260927_f1_96_included_tax_optional_rate.sql permite alíquota informativa ausente somente em INCLUDED, alinhando banco ao motor. Mantém exigência para INSIDE/OUTSIDE, aprovações, escopo e auditoria. Idempotente, falha se a função encontrada tiver formato inesperado. Aplicada e verificada em produção (included_rate_optional=true).

Validação: builds backend/frontend; 174 testes de integração TUSD e memória tributária; teste DOM de gravação e confirmação; 157 verificações isoladas de banco incluindo migração repetida, ausência de alíquota incluída e rejeição da ausência em nova incidência.

Del Rei 2026-08: tarifas TUSD ainda em rascunho. A criação dos tributos fica bloqueada até revisão/aprovação das bases. Homologação financeira permanece pendente.
