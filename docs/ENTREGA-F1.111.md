# F1.111 — Parcelas de demanda no motor

O motor aceita parcelas explícitas utilizada e não utilizada da demanda única ACL Verde, com tarifas próprias e precisão de até nove casas em R$/kW. A soma das quantidades deve coincidir exatamente com o total faturado. Quantidades continuam limitadas a seis casas.

As duas tarifas precisam estar aprovadas para toda a competência. Demanda total e parcelas não podem ser calculadas simultaneamente. Se uma parcela for inválida, todo o conjunto fica pendente. Tributos embutidos não são acrescentados novamente. A falta de demanda medida continua bloqueando o fechamento, mas não impede esta prévia baseada em quantidades faturáveis validadas.

Cadastro: Dados mensais recebe as duas parcelas opcionais ACL; Parâmetros de cálculo recebe as duas rubricas e aceita a precisão da fatura. Correções de versões validadas exigem nova versão, mantendo autoria e histórico.

Migração 20260927_f1_111_split_demand.sql: precisão numeric(21,9), CHECK restrito a tarifas BRL_KW e guardas das quantidades. Sem reescrita de registros de negócio, aprovações, eventos ou permissões. Aplicada em produção, coluna confirmada como 21/9.

Validação: 261 testes de preparação/cálculo, 11 verificações DOM, 87 verificações PostgreSQL/PGlite com serviço real, build backend e TypeScript frontend. Reproduz 234,6400 × 10,70900103 = 2.512,76 e 265,3600 × 8,78135364 = 2.330,22. Testa ausência, contexto, soma, dupla contagem, precisão, imutabilidade e histórico.

Limite desta entrega: habilita o cálculo e a persistência. A memória OCR existente permanece apenas evidência. Ainda falta importar suas parcelas/tarifas para uma nova versão mensal e parâmetros com vínculo de origem, sem sobrescrever a versão 1 validada. Nenhuma aprovação financeira, publicação de fechamento ou nova chamada Azure realizada.
