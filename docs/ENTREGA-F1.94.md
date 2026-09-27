# F1.94 — Rascunhos TUSD ACL a partir da fatura CPFL

Integração no painel de homologação, após conferências atuais de identidade e consumo. Exige unidade ativa ACL grupo A, layout CPFL Paulista, competência coerente, totais conciliados, duas linhas TUSD únicas, transcrição confiável e produto quantidade × tarifa igual ao valor impresso em centavos.

A tarifa bruta original em R$/kWh é convertida exatamente para R$/MWh. Exemplos: 0,98192227 → 981,92227; 0,21265684 → 212,65684. Sem arredondamento, alteração de schema ou perda de precisão. Confiança de palavras verifica transcrição, não aprovação semântica.

Um INSERT atômico cria os dois DRAFTs. IDs determinísticos impedem repetição do lote. Parâmetros existentes no período são preservados. O servidor deriva organização, cliente, unidade, valores, competência e autor; a requisição contém somente token da prévia. Cada parâmetro guarda documento, SHA-256, linha de origem, tarifa original e conferências. Triggers existentes registram histórico imutável. Aprovação continua separada.

GROSS com ICMS/PIS/COFINS incluídos: não somar novamente impostos destacados. Vigência somente no mês faturado. Nenhuma importação de ACR, fornecedor, demanda ou encargos adicionais nesta etapa.

Validação: builds backend/frontend, 839 testes em 38 suítes OCR/tarifas/memória tributária, 153 verificações de banco e teste DOM de prévia, envio, confirmação, duplicidade e falha.

Pendências: conciliação tributária detalhada, demais componentes/custos, demanda medida e reativo com unidade compatível. Esta entrega não declara homologação financeira completa.
