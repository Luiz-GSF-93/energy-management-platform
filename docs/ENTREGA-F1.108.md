# F1.108 — Preservação de revisões

O formulário enviava JSON previamente serializado a apiRequest, que serializa o corpo novamente. A API recebia uma string em vez do objeto e recusava a gravação. Agora o formulário entrega o objeto diretamente.

Mantidos escopo, permissão, justificativa, autor, integridade e chave de idempotência para repetição segura. Revisões continuam rascunhos, sem aprovação financeira.

Validação: teste de interface exige corpo objeto, verifica repetição da mesma chave e confirmação explícita; testes do serviço cobrem histórico imutável e isolamento.
