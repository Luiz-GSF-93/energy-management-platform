# F1.119 — revisão de tributos já incluídos

O formulário de parâmetros exigia alíquota para declarações INCLUDED geradas pelo OCR sem taxa adicional, impedindo a ampliação auditada das bases. A alíquota agora é opcional somente em INCLUDED; vazio é enviado como null e taxas informadas são preservadas. INSIDE/OUTSIDE continuam exigindo taxa. A regra do banco existente F1.96 já permite esta representação.

Validação: teste DOM de envio nulo, preservação de taxa informada, exigência nos demais tratamentos e regressão da aprovação auditada; build frontend.

Homologação Del Rei agosto/2026: bandeiras ACR classificadas explicitamente, valores preservados; bases ICMS/PIS/COFINS ACR atualizadas por revisões e histórico. Contrato do fornecedor ainda deve ser cadastrado para concluir o fechamento.
