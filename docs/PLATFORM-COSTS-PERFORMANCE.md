# Planos, consumo e custos da plataforma

Bot-Energy + RAG é um módulo opcional do catálogo. A cota inicial sugerida é US$ 10 por empresa/mês e é copiada para a licença com a versão do plano. Editar o catálogo não altera contratos existentes: o administrador aplica a nova versão à licença. Suspensão, expiração, licença ambígua ou cota ausente bloqueiam novas chamadas antes da transmissão. Permissões de usuário continuam obrigatórias.

O mês contábil da IA é o mês calendário UTC, sem acumulação de saldo. Cada chamada reserva o máximo antes de usar o provedor. A conciliação devolve a diferença entre reserva e consumo estimado. Resposta inválida, falha de rede e resultado desconhecido mantêm a reserva; não há tentativa automática de duplicar chamadas ou apagar consumo. A cota de uma empresa não é emprestada a outra. A capacidade global acompanha as cotas vigentes; elevar limites não compra TPM/RPM nem garante latência do provedor. O piloto Expert Energy mantém US$ 50 enquanto sua licença estiver vigente, até receber um plano com cota própria.

## Dados e unidades

O painel global exige contexto de plataforma e a permissão existente de consulta aos planos. Alterações exigem a permissão de administração dos planos e o administrador global confirmado novamente no banco. Nenhuma nova permissão é concedida. As tabelas de custos têm RLS e acesso apenas por serviço de backend.

- Tokens de entrada/saída e custos estimados: uso confirmado pelo Azure, separado de reservas pendentes. Requisições antigas sem módulo ficam sem classificação; não se inventa atribuição.
- OCR Document Intelligence: cobrança por páginas, distinta da interpretação generativa da fatura por tokens.
- CPU da API: CPU do processo, com 100% correspondente a um núcleo. Memória do processo/container, filesystem e contadores cumulativos da rede são coletados a cada minuto. Não representam métricas de outros serviços.
- PostgreSQL: tamanho real do banco. CPU/RAM do Supabase e do frontend Vercel precisam de seus provedores de métricas; ausência é exibida como não conectada.
- Infraestrutura: registros auditados por competência, fatura/estimativa, moeda e origem. Custos diretamente atribuídos à empresa são separados dos compartilhados, sem rateio implícito.
- Câmbio: informado pelo administrador com data. Não é inventado nem tratado como zero. Receita é a mensalidade informada na licença. A contribuição exclui custos compartilhados ainda não atribuídos, impostos e outras despesas, portanto não é lucro líquido.

## Alertas e operação

Alertas mensais por empresa em 80%, 95%, limite atingido e projeção acima da cota; alertas de capacidade da API; deduplicação por empresa, mês, nível e canal. O envio possui registro persistente e recibo do provedor. Envios abandonados ficam UNKNOWN para conciliação, sem repetir automaticamente. Resend usa chave de idempotência. WhatsApp precisa de `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_GRAPH_VERSION` e `WHATSAPP_ALERT_TEMPLATE` aprovado em pt_BR com um parâmetro de corpo (a mensagem de alerta). Configure segredos somente no Railway; nunca no frontend, código ou conversa.

Documentação dos provedores: https://resend.com/docs/api-reference/emails/send-email e https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-message-templates/ . Aceitação de envio não comprova entrega ao destinatário.

Ative `BOT_ENERGY_LICENSE_MODE=true` depois de aplicar a migração F6 e implantar o backend. As chaves e deployments Azure existentes permanecem. A lista manual de organizações deixa de ser o controle comercial quando o modo de licenças está ativo; o gate de licença e a reserva no banco passam a autorizar cada chamada. Normas DRAFT continuam excluídas do RAG.
