# Preenchimento e conclusão com evidências

Perguntas como “o que precisa preencher para concluir validação?” consultam o plano atual da fatura, em vez de responder somente quem valida/aprova. A resposta informa os valores preparados, as propostas tributárias, as fontes divergentes, a nota do fornecedor e a diferença de volume, com atalhos para as respectivas decisões.

Após as conferências essenciais existentes, a preparação automática cria rascunhos de tarifas ausentes, declarações tributárias ausentes, revisão de dados mensais e CIP comprovada. Consumos usam a evidência confirmada atual; reativo faturado mantém a unidade da rubrica. As parcelas faturadas incluem total calculado no backend a partir das duas parcelas classificadas. Nunca são usadas como demanda medida.

Versões validadas permanecem imutáveis e vinculadas pela nova revisão. Um rascunho existente não é editado automaticamente. Os índices de um único rascunho e os bloqueios de versão já existentes no SQL protegem concorrência. Falha ou resultado incerto interrompe o lote, exige consulta ao histórico e não se repete automaticamente. Nenhuma migration nova.

A demanda medida fica proposta pelo quadro de medição completo, usando o maior valor entre postos, com histórico divergente visível e confirmação obrigatória antes da alteração. A nota enviada é selecionada quando única; o valor contratual é identificado como sugestão, não como valor extraído da NF. Tratamento tributário não comprovado continua exigindo seleção. Não se presumem perdas, isenção, tributo zero ou compra adicional.

O operador aceita os preenchimentos em lote após conferir as fontes; pode editar a justificativa ou solicitar revisão nos formulários existentes. Aprovação de parâmetros, validação financeira dos dados/custos e aprovação/publicação da apuração seguem exclusivamente os serviços financeiros e perfis já autorizados. A consulta de suporte não grava nem aprova. CCEE e PLD continuam aguardando habilitação/agendamento.

Regressões incluem a pergunta reportada, evidência ausente, restrição de organização/perfil/licença, fontes atuais, ações de navegação sem gravação, propostas sem confirmação humana automática, preparação mensal sem tarifas faltantes, preservação das versões validadas, repetição e falha parcial. O lint global possui pendências anteriores fora deste escopo; executar lint dos arquivos alterados e registrar separadamente o resultado global.
