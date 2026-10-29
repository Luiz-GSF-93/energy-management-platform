# Envios incorretos e conferência de fontes

Em Documentos, o administrador ou gestor autorizado pode usar **Encerrar envio
incorreto** em um original pausado, ainda sem documento arquivado, fechamento,
leitura externa em andamento ou lease. O motivo e a confirmação são obrigatórios.
O arquivo sai da fila ativa; original, hash, cotas e eventos são preservados.
O histórico privado fica em **Envios incorretos encerrados**, sem progresso fictício
de 100%. O Portal continua exibindo somente a fila ativa autorizada.

Notas corretas são identificadas e processadas independentemente. Não associe a
unidade errada para liberar uma nota. A falta do valor do fornecedor é uma causa
do grupo fornecedor; não é motivo para solicitar cadastro de biblioteca ACR.
Ausências reais de tarifa ou tratamento fiscal continuam visíveis.

A ação privada `eva_intake_administration/reconcile_preparation` permite ao gestor
ou administrador reconferir uma execução de intake UNKNOWN somente quando as
preparações comerciais estão comprovadamente PREPARED/PARTIAL, a mesma fatura
continua íntegra e não há aprovação financeira do mês. Registra os recibos e o
motivo antes de retomar com a leitura existente. Não reconcilia escritas financeiras
RUNNING/UNKNOWN, não repete OCR/IA e não aprova/publica valores. A explicação IA já
tentada não é executada novamente.

A migração 20261245 aplica o mesmo predicado de exclusão da fila aos dois runtimes
revisados de consulta, public e portal_scope, e atualiza somente a assinatura da
função pública alterada. Não amplia clientes/unidades nem modifica autenticação.
