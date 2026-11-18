# Trading Hub — códigos de acesso (18/11/2026)

O envio de convite e o pedido de código são etapas distintas. Abrir o link não envia OTP automaticamente, inclusive para evitar disparos por verificadores de links de e-mail. O código permanece associado ao destinatário original, convite, prazo e organização.

A tela passa a explicar as três etapas, mostrar o destinatário mascarado após a aceitação do envio, apresentar o remetente e orientar a conferência de spam/quarentena. O campo de código permanece disponível mesmo se a confirmação HTTP do envio se perder. Um intervalo visível de 60 segundos evita pedidos repetidos que substituam um código ainda válido. Nenhum código ou sessão é salvo em armazenamento persistente do navegador.

O backend confere o remetente antes de reservar um código e registra OTP_EMAIL_ACCEPTED, OTP_EMAIL_REJECTED ou OTP_EMAIL_UNKNOWN com referência do provedor e diagnóstico sanitizado. Não registra código, token ou corpo do e-mail. Falha no reconhecimento da gravação de auditoria não deve induzir o fornecedor a reenviar uma mensagem já aceita; nesse caso há um evento técnico sem dados de autenticação. O assunto identifica a cotação para distinguir códigos de rodadas diferentes.

Mantidos: validação do convite/licença/prazo/revogação, HMAC do código, máximo de 10 pedidos/dia por convite, intervalo mínimo no banco e validade de até 10 minutos limitada pelo convite. Não há ampliação de permissões, novos destinatários nem chave de API mais abrangente.

Aceito pelo provedor e entregue ao servidor destinatário não garantem a caixa de entrada: retenção em quarentena precisa ser confirmada com o destinatário. Não reenviar automaticamente mensagens de resultado incerto e não remover autenticação para contornar filtros corporativos.

Validação: 33 testes backend de portal, envio, limites e rastreio; DOM isolado com API simulada (destinatário mascarado, cooldown, não duplicação de pedido, reabertura e decisão comercial única); TypeScript e builds frontend/backend. Nenhum e-mail real enviado nos testes.
