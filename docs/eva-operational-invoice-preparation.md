# Preparação operacional da fatura pela EVA

O painel operacional da preparação usa o OCR preservado, vínculo da unidade/competência e biblioteca ACR já selecionada pelo servidor. Não chama o motor de fechamento com status fictícios de validação.

`calculation-operational-proposal.ts` monta um resultado versionado, persistido no JSON existente da execução. O total da distribuidora exige total único e conciliação MATCH do layout, com fonte monetária verificada. Operações detalhadas preservam o sinal dos créditos; subtotais e linhas informativas não são somados novamente. Excesso de linhas não gera truncamento silencioso. A energia do fornecedor usa o valor proposto atual já calculado pelo motor de referências. Honorário fixo e percentual conservam suas fontes e só os três valores comerciais continuam editáveis.

As rubricas ACR usam `tariffProduct` com os consumos atuais e as tarifas da biblioteca compatível. A soma é identificada como parcial; não é custo final ou economia. Demanda medida/contratada não substitui demanda faturada; parcelas utilizada/não utilizada só entram em par completo com quantidades ACR explícitas. Uma quantidade ausente fica em observações, sem zero inventado. Impostos, CIP e nota do fornecedor não são acrescidos novamente.

A base idempotente passa a v5. Execuções anteriores permanecem imutáveis; os valores comerciais elegíveis são restaurados pela RPC autorizada. Nenhuma nova tabela, migração, grant, flag, licença ou alteração do corpus. Reservas RUNNING/UNKNOWN seguem sem reenvio automático.

Na interface, a proposta é mostrada antes dos detalhes avançados. “Ver dados e fontes” expande a própria proposta; “Fechamento e validação financeira” abre os controles formais em separado. A consulta financeira pode manter impedimentos enquanto os registros estiverem em rascunho; isso não impede mais a apresentação das rubricas calculáveis da proposta. Publicar ou aprovar continua no fluxo autorizado.

Testes: cálculo decimal kWh/MWh, fontes inválidas, total duplicado, créditos, zero explícito, ausência de demanda faturada, par de parcelas, sobreposição ALL/postos, falta de vínculo, não duplicação de CIP/nota/impostos, preservação de fontes e interface sem encaminhamento da revisão operacional ao fechamento legado. A suíte de isolamento/idempotência SQL existente continua obrigatória.
