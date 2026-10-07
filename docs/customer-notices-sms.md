# Avisos aos clientes e SMS

Os avisos ficam em **Operação → Notificações → Avisos aos clientes**. Relatórios continuam em sua configuração própria, com frequência e contatos já existentes. Novas configurações de avisos começam pausadas e exigem revisão de destinatários antes da ativação. O cadastro de contatos não ativa envios por si só.

Eventos disponíveis por cliente/unidade: solicitação criada ou atualizada, agenda atualizada, lembrete nas 24 horas anteriores ao prazo e resumo ACL aprovado e publicado. Eventos internos e rascunhos ACL não publicam resultados aos clientes. Mensagens levam somente um aviso genérico e a URL pública de entrada no portal, sem anexos, valores financeiros, descrição operacional ou links privados. SMS acompanha o canal e-mail. Relatórios PDF/Excel são enviados somente por e-mail.

## Implantação

Aplicar em ordem após as migrações de relatórios, operações, ACL e WhatsApp:

1. `20261007_sms_delivery.sql`
2. `20261007_customer_notices.sql`

As tabelas têm RLS e acesso direto revogado inclusive ao `service_role`. Apenas RPCs específicas podem configurar, reservar e finalizar envios. Cada envio revalida organização, licença, permissões do responsável, cliente/unidade ativos, política/versionamento, contato/canal autorizado e origem atual imediatamente antes da transmissão. Alterar ou pausar a política invalida envios reservados. Alterar contatos exige salvar pausada e revisar novamente.

Há unicidade por evento/origem/versão/contato/canal e também por destino. Reservas impedem concorrência. Timeout, resposta incerta ou interrupção após o início da transmissão geram `UNKNOWN`, sem reenvio automático. Avisos expiram em 24 horas. Ativar uma política não envia o histórico anterior; lembretes só consideram registros criados/atualizados após a ativação. SMS antigos bloqueados não são reativados pela migração.

## Railway — configuração Twilio

Valores não secretos da conta Expert Energy:

- `TWILIO_ACCOUNT_SID=AC<ACCOUNT_SID>`
- `TWILIO_MESSAGING_SERVICE_SID=MG<MESSAGING_SERVICE_SID>`
- `TWILIO_STATUS_CALLBACK_URL=https://energy-management-platform-production.up.railway.app/api/v1/integrations/sms/status`
- `TWILIO_AUTH_TOKEN`: inserir diretamente no Railway; nunca em código, navegador do cliente ou chat.

Manter inicialmente:

- `TWILIO_SMS_ENABLED=false`
- `TWILIO_SENDER_APPROVED=false` — mudar somente após confirmar aprovação do remetente **EnergyOS** no Brasil.
- `CUSTOMER_NOTICES_ENABLED=false`

`REPORTS_DELIVERY_ENABLED` controla a fila de relatórios existente, separadamente. Os dois controles Twilio precisam estar `true` para qualquer envio SMS. Sem credenciais/aprovação, SMS não é reservado para transmissão. O backend passa um `StatusCallback` específico de cada envio ao criar a mensagem; não é necessário inventar um callback genérico na tela de registro do remetente.

O callback aceita somente assinatura `X-Twilio-Signature` validada pelo SDK oficial com Auth Token, todos os parâmetros do formulário e a URL pública exata configurada. Não usa Host/X-Forwarded-Host recebidos para validar. Confere Account SID, Message SID e delivery UUID; o histórico combina recibo e SID final para evitar vincular outro envio. Eventos repetidos são idempotentes e entrega confirmada não regride para “enviada”.

## WhatsApp e e-mail

O mesmo número WhatsApp da plataforma é utilizado, com modelos específicos:

- solicitações: `energyos_solicitacao_cliente`
- agenda/prazo: `energyos_lembrete_prazo`
- publicação ACL: `energyos_adesao_atualizada`
- relatórios: `energyos_relatorio_disponivel` (fila existente)

A fila de avisos libera WhatsApp somente quando todos os três modelos de avisos estão aprovados em `pt_BR` e não exigem parâmetros/mídia. Aprovação é consultada na Meta; um campo de configuração não substitui essa consulta. O alerta administrativo de custos permanece separado. E-mail usa `RESEND_API_KEY` e `REPORTS_EMAIL_FROM` existentes, com chave de idempotência durável por aviso.

Antes de ativar envios reais: confirmar remetente Twilio aprovado, configurar credenciais, revisar contatos e canais, fazer um único teste autorizado para o administrador e verificar recebimento/recibo. Não ativar destinatários de clientes como parte do teste.

## Verificação

- Jest: assinatura oficial Twilio, parâmetros futuros, conta incorreta, URL alterada, falhas e ausência de aprovação; transportes de avisos e regressão de relatórios/WhatsApp.
- PGlite: `node backend/test/database/verify-customer-notices.mjs` cobre isolamento, políticas pausadas, idempotência, contatos/permissões/licença revogados, origem/versão alterada, expiração, recibos e lembretes futuros.
