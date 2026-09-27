# F1.105 — Confiança dos tributos nas parcelas de demanda

Os painéis Classificar parcelas de demanda e Demanda faturada após conferência passam a mostrar confiança verificável de ICMS, PIS e Cofins por parcela. Na falta de confiança direta, usam a menor confiança das palavras somente quando a transcrição cobre integralmente os trechos e páginas da célula, conforme o verificador existente.

O indicador é uma projeção separada dos snapshots assinados: não altera confiança original, valores, hashes, classificações, aprovações ou integrações anteriores. Origem ambígua, ausência de valores e transcrição incompleta continuam indisponíveis. Confiança direta baixa nunca é substituída por palavras com confiança maior; 85% ainda exige conferência. ICMS ausente não vira zero nem declaração de isenção.

Sem migração, escrita financeira ou novo processamento Azure. Testes cobrem origem, ausência, limites, preservação de hash e exibição.

Validação concluída: 99 testes backend, três verificações de interface (incluindo histórico e isolamento entre documentos), builds backend/frontend e git diff --check passaram.
