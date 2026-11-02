# Trading Hub: envio e reenvio de convites

O Trading Hub exige `TRADING_RESEND_API_KEY`, exclusiva com Sending access ao domínio verificado `cotacoes.expertenergy.com.br`, e `TRADING_EMAIL_FROM` com endereço nesse domínio. A variável compartilhada `RESEND_API_KEY` não é usada como alternativa e deve permanecer preservada para os outros módulos. Nenhuma chave pode ser armazenada no frontend, repositório ou auditoria.

Aplique `20261217_trading_invitation_resend.sql` antes do backend. A migração adiciona controle de revisão/idempotência e diagnóstico, sem modificar os convites existentes. O reenvio está em Trading Hub > Cotações > Acompanhamento dos convites. Abrir o modal não envia. Confirmar exige destinatário/prazo conferidos e motivo; o servidor preserva ambos e invalida token, sessão e OTP anteriores. Respondidos, revogados e vencidos não são reenviados. Há intervalo mínimo de 60 segundos e proteção de dois minutos para uma reserva em andamento.

`ACCEPTED` significa aceito pelo provedor, sem comprovação de recebimento na caixa postal. `REJECTED` indica recusa explícita conhecida; HTTP 403 com `SENDER_DOMAIN_NOT_ALLOWED` exige corrigir o escopo da chave. `UNKNOWN` requer consulta ao provedor antes de nova tentativa. Não reenviar automaticamente em timeout. O mesmo identificador e revisão não geram outro envio.

Teste real somente com destinatário autorizado: conferir a variável no backend de produção sem revelar seu valor; abrir o convite pendente; confirmar Reenviar; consultar o resultado no acompanhamento/Resend; confirmar recebimento e usar o novo link/código no mesmo email. O link antigo não deve funcionar. A implementação e os testes automatizados não disparam e-mails reais.
