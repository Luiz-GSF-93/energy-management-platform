# F1.110 — Memória de demanda em Preparar apuração

Preparar apuração recebe automaticamente as parcelas de demanda da extração da mesma organização, cliente, unidade e competência, com tarifas originais e classificação mais recente. Confere integridade da revisão e vínculo com arquivo, job e versão do layout. Alterações na evidência, correção posterior, histórico ambíguo ou baixa confiança mantêm a memória pendente.

A memória integra as fontes capturadas nas revisões preservadas e pode ser consultada posteriormente sem depender do OCR vivo. Não altera parâmetros, não utiliza a quantidade agregada como demanda medida e não soma esses valores no subtotal aprovado. A integração tarifária definitiva ainda precisa suportar quantidades utilizadas/não utilizadas separadas e tarifas com oito casas decimais, preservando o tratamento tributário próprio de cada parcela.

Sem migração, sem nova leitura Azure e sem aprovação financeira. Validação: testes de escopo, integridade, histórico e aritmética; frontend, snapshots e build.
