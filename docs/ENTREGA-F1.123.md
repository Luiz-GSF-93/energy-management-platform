# F1.123 — Evidências complementares antes do fechamento

Fornecedor Mercado Livre → Conciliar compra pontual permite registrar revisões pendentes com documento verificado da mesma organização, cliente, unidade e competência, mesmo antes de confirmar as condições do fornecedor e validar a nota nos custos mensais. SUM001 e MED003 podem ser referenciados com medição, perdas, resultado e ressalvas na justificativa, um documento por revisão. O histórico preserva todas as evidências.

O backend mantém contexto e hash calculados no servidor, autor autenticado, justificativa, predecessor e controles F1.122 de acesso/licenças/RLS. Fontes alteradas exigem nova consulta. Apenas PENDING aceita o contexto documental incompleto; APPROVED_NO_COST continua exigindo fontes financeiras validadas, nota conciliada e nenhuma outra pendência. Nenhum consumo, custo ou crédito é alterado por esse registro.

Não exige migração. Não implementa extração automática de MED003 nem encerra liquidação financeira. Para Del Rei, preservar consumo OCR; registrar perdas como evidência complementar e solicitar demonstrativo definitivo de contabilização/liquidação. A diferença de 0,001 MWh entre os totais exibidos requer ressalva de precisão, sem corrigir silenciosamente o documento.

Validação: testes de serviço/banco para evidência pendente, bloqueio de aprovação incompleta, documento de outro tenant e fontes alteradas; testes DOM de disponibilidade, status e hash; builds e regressão do motor de conciliação.

Resultado: backend e frontend compilados; 30 verificações serviço/PGlite, 17 DOM e 22 testes do motor aprovados.
