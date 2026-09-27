# F1.85 — Comprovante e estado salvo das conferências OCR

## Problema e alteração

Em Classificar parcelas de demanda, a chave React incluía o ID da última revisão: recarregar o histórico recriava o formulário e eliminava a mensagem de sucesso. Nos dois fluxos (demanda e consumo), o formulário retornava a uma seleção editável após salvar e o histórico permanecia recolhido.

O componente compartilhado OcrReviewField utiliza agora o recibo autenticado da resposta POST, contendo ID, campo, origem, autor, data e versão. Ele mostra sucesso e inclui o registro no histórico imediatamente, preservando-o mesmo se a consulta GET subsequente falhar. Histórico aberto, checkbox marcado e desabilitado para a conferência atual. Alterações posteriores exigem Registrar nova revisão, preservando versões anteriores.

Mensagens explicam o que falta antes de habilitar Salvar. Respostas sem recibo não confirmam salvamento; retries mantêm a chave idempotente. Duplo envio protegido por referência síncrona. Atualizações de histórico ignoram respostas superadas. Reabertura encerra o estado de rascunho de uma nova revisão; mudança da origem exige nova conferência.

## Escopo e validação

Nenhuma migração ou alteração do motor financeiro. As conferências continuam sem aprovar identidade, tributos ou apuração. Não foram criadas decisões em produção em nome do operador. Na consulta inicial da fatura Del Rei, os históricos de consumo e demanda estavam vazios.

13 scripts de regressão frontend OCR aprovados (os dois fluxos alterados foram repetidos após ajuste de reabertura), incluindo rede indisponível, retry idempotente, falha no GET após POST confirmado, autor/data, histórico aberto, checkbox bloqueado, nova revisão, reabertura, mudança de origem e segurança de texto. Build de produção e ESLint dos componentes alterados aprovados.
