# Retomada comprovada de preparação EVA — BETA .12

Uma leitura preservada não deve voltar ao OCR porque a confirmação HTTP se perdeu.
O estado UNKNOWN também não pode ser tratado como ausência de escrita: o histórico
da Cerealista continha nove confirmações de rascunhos antes da perda da resposta.

As migrações 20261321/22 acrescentam manutenção privada, sem EXECUTE para anon,
authenticated ou service_role. Não executam recuperação automaticamente. A função
de prova aceita somente a janela histórica auditada de 13/11/2026 antes de 20h UTC:
confirma o prefixo de recibos, os IDs determinísticos das tarifas ACR restantes,
valores, datas, versão da biblioteca, revisão e estado DRAFT, além dos recibos
posteriores que confirmaram a cauda. Exige fonte íntegra, OCR concluído, licença
vigente e ausência de operações financeiras concorrentes ou aprovadas.

A reconciliação acrescenta um registro PARTIAL com ator técnico verdadeiro; mantém
os eventos UNKNOWN originais e não altera valores. A retomada do intake exige a
versão exata da falha, uma proposta posterior da mesma unidade/fonte, e todas as
preparações comprovadas. Acrescenta auditoria e agenda AWAITING_SOURCES no worker
existente. Não muda o operador, permissões, original, justificativa ou leitura.
Repetir a mesma solicitação retorna o recibo existente. Uma nova falha exige nova
conferência. A aprovação/publicação financeira continua separada.

A migração 20261323 troca somente conflitos de aplicação explicitamente levantados
como 40001 por PT409 em quatorze rotinas EVA/cálculo revisadas. A API permanece
compatível com ambos durante o rollout. Serialização real do PostgreSQL conserva
40001; ACLs, filtros de organização e licenças permanecem. Rotinas encapsuladas por
portal_scope ou com handlers de serialização não revisados impedem a migração.
Isso evita que o PostgREST repita um conflito de negócio como transação serializável.

Implantar API/worker compatíveis antes de aplicar 20261323. Conferir leases antes de
migrar e antes de recuperar; invocar as funções privadas somente após comparar
prova e histórico atual. Não liberar a escrita se houver prova ausente/divergente.
Monitorar avanço e recibos finais, sem reenviar documento ou aprovar valores.
OCR não é repetido; uma primeira interpretação IA ainda pendente pode consumir a
cota normal. Não se promete custo zero nem ausência absoluta de falhas.

Validação: banco descartável com DDL real dos históricos e ID de produção,
recuperação idempotente, negativas de escopo/fonte/valor/concorrência/licença,
imutabilidade e digest financeiro; limites HTTP com uma única RPC; build e CI.
Os testes de transformação SQL usam rotinas sintéticas com assinaturas mínimas,
preservando atributos/ACLs e diferenciando conflito de aplicação e serialização.
Eles não substituem carga representativa nem a janela BETA de 24–72 horas.

A migra��o 20261324 permite que a execu��o posterior contenha somente a confirma��o de aloca��o integral de uma NF de fornecedor verificada, da mesma organiza��o/cliente/compet�ncia e unidade (ou NF compartilhada). Isso n�o modifica a prova dos IDs/valores ACR. A execu��o original permanece sem overrides; outras altera��es manuais continuam recusadas.
