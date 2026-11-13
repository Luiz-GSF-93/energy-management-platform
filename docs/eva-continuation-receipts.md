# Continuação de documentos com leitura preservada

O recebimento do arquivo, a confirmação da identidade, a preparação de rascunhos e a aprovação financeira são recibos distintos. Uma falha na reconciliação da preparação não deve ser apresentada como falha no recebimento do arquivo.

## Comportamento

- A continuação envia uma única solicitação ao protocolo existente. Não envia novamente o arquivo nem chama OCR ou IA.
- A interface bloqueia cliques simultâneos, limpa a mensagem de sucesso anterior e aceita apenas o recibo da mesma solicitação no estado `AWAITING_SOURCES`.
- Após sucesso ou falha, consulta o andamento por GET. Não repete automaticamente o POST.
- Uma resposta de outro contexto não altera a empresa atualmente exibida.
- O worker existente é acordado somente após o recibo válido. A mensagem informa retomada registrada, sem prometer que valores foram aprovados.
- Abrir proposta e fontes é navegação de conferência; não executa aprovação ou nova leitura.

## Ocorrências diferentes

| Ocorrência | Tratamento |
| --- | --- |
| Fonte alterada | Atualizar o andamento e conferir a proposta, preservando o original. |
| Protocolo alterado | Consultar o recibo atual antes de solicitar outra continuação. |
| Gravação financeira anterior incerta | Reconciliação técnica dos efeitos; justificativa de identidade não comprova gravação. |
| Competência ocupada ou prazo SQL excedido | Consulta de andamento, sem espera indefinida ou repetição automática. |
| Resposta de rede não confirmada | Preservar o protocolo e consultar; ausência de resposta não prova rollback. |

Os códigos públicos e de log são fixos. Não incluem SQL, erro livre do provedor, documento, CNPJ, organização, pessoa ou valor financeiro. Permissões, licenças, vínculos, fontes, escopo e proteção contra aprovação duplicada continuam sendo verificados pelas mesmas funções autorizadoras.

## Proteção contra repetição no banco

A migração `20261320_eva_continuation_conflicts.sql` altera somente conflitos de negócio explicitamente levantados pelas rotinas selecionadas para `PT409`. Falhas reais de serialização do PostgreSQL continuam usando `40001`.

O uso de `40001` em exceções de negócio pode provocar repetições do PostgREST, conforme o [diagnóstico oficial do Supabase](https://supabase.com/kb/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b). A alteração não reinicia o banco nem encerra conexões existentes. Rotinas privadas de isolamento rastreadas não são reescritas: a migração exige revisão separada caso encontre uma delas.

A reconciliação de entrada recebe limite de oito segundos por comando e dois segundos para locks. Seus eventos preservam o histórico; ela não realiza OCR nem escrita de valores financeiros.

## Validação

Os ensaios usam banco descartável e documentos sintéticos. Verificam recibo incorreto, conflitos, perda de resposta, ausência de repetição, duplo clique, mensagem anterior, consulta por GET, compatibilidade de permissões e preservação de resultados financeiros incertos. Isso não substitui a janela BETA de 24–72 horas nem o teste representativo de carga e recuperação do plano A–G.
