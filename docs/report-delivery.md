# Envio de relatórios

A recorrência continua pausada até revisão de destinatários no backoffice. Somente novas ocorrências READY, criadas depois da migração, entram na fila de envio. Não há reenvio retrospectivo. O calendário gera o mês anterior publicado, sem inventar medições quinzenais.

O worker exige REPORTS_DELIVERY_ENABLED=true. E-mail exige RESEND_API_KEY e REPORTS_EMAIL_FROM de domínio verificado. Os PDFs/Excel selecionados são anexados somente ao e-mail do contato autorizado; não há URL pública ou documento financeiro no WhatsApp. Limite: quatro anexos e 12 MB de conteúdo base64 por envio.

WhatsApp exige WHATSAPP_REPORT_TEMPLATE=energyos_relatorio_disponivel e WHATSAPP_REPORT_TEMPLATE_APPROVED=true, além das configurações existentes do número. Habilitar somente após a Meta aprovar o modelo pt_BR de utilidade sem parâmetros:

“EnergyOS: um relatório solicitado pela sua organização foi preparado. Para consultar o documento e ajustar o recebimento destes avisos, entre em contato com seu Consultor.”

Modelo de custos da plataforma não é reutilizado para clientes. SMS permanece bloqueado até implementação Twilio, apenas aviso após e-mail aceito. Alertas operacionais e Adesão ACL ainda exigem seus próprios gatilhos e modelos; este worker atende relatórios.

Fila única por ocorrência/contato/canal e também por destino/canal impede duplicidade de contatos. RPCs exclusivas de service_role, RLS sem leitura direta. A organização e o ator são revalidados contra licença, permissão, política, unidade, cliente e contatos, inclusive imediatamente antes de transmitir. Não expor endereços, telefone, IDs do provedor ou conteúdo na listagem de histórico.

PREPARING expirado permite nova preparação; TRANSMITTING expirado vira UNKNOWN e não reenvia. Timeout/5xx/429 sem comprovante também UNKNOWN. Não há garantia de exatamente uma vez em rede externa. Conferir o provedor antes de autorizar uma nova ocorrência. Resend recebe chave de idempotência persistente. ACCEPTED comprova apenas aceite. DELIVERED/READ são eventos assinados da Meta vinculados por message_id e apresentados apenas dentro da organização dona do envio. A revogação após o início da chamada não desfaz uma transmissão já iniciada.

Validação: Jest do transporte/worker e PGlite verify-report-delivery.mjs, com contatos alterados, tenants cruzados, leases, filas duplicadas, RLS e interrupção de transmissão.
