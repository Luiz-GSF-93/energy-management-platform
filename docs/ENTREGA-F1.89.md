# F1.89 — Acompanhamento da homologação OCR

## Entrega
Em Documentos, após Consultar leitura OCR, o botão Acompanhar homologação reúne identidade/competência (6 campos), consumo (3 campos) e parcelas de demanda faturada. Cada campo mostra a última conferência, autor, data e versão. Somente decisões para o hash da evidência atual contam; cadastro/evidência alterados exigem nova conferência. Correções posteriores prevalecem. Erros de consulta retiram o resultado anterior da tela.

O endpoint GET /documents/:id/ocr/homologation usa DOCUMENTS_VIEW e os serviços existentes de revisão, mantendo organização, documento, fonte imutável e licença. Nenhuma escrita ou alteração de permissões; nenhuma migração.

## Limites e sequência
O painel é acompanhamento das conferências; não é homologação financeira. A integração OCR em dados mensais, parâmetros, custos e preparar apuração permanece pendente e é explicitada na interface. Não consulta nem invalida lançamentos manuais existentes. Demanda faturada classificada não substitui medição. Próxima etapa: integração auditada e idempotente, com verificação transacional da identidade/evidência atual e preservação de registros existentes, seguida de reconciliação tributária e financeira. CPFL Paulista continua em homologação.

## Validação
566 testes backend OCR (28 suítes), incluindo 9 novos testes de progresso e escopo. Teste DOM frontend: histórico atual, autor, evidência alterada, falha de consulta remove estado antigo, atualização e ausência de escritas. Build frontend aprovado. Consumos atuais da Del Rei agosto 2026 conferidos em produção em modo leitura: 3 registros salvos, sem criação de aprovação pelo agente.
