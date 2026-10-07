# Controle de validade da integração WhatsApp

O Dashboard administrativo no contexto global mostra emissão, vencimento, dias restantes, antecedência configurável (1–60 dias; padrão 15), links da Meta e Railway e instruções de renovação. Não aparece no portal, em organizações nem em sessões de operação de organização.

GET /api/v1/admin/dashboard/whatsapp-renewal exige permissão global de consulta de organizações. PATCH exige permissão global de atualização de organizações e validação estrita dos campos. A função SQL revalida o ator global e a permissão. As tabelas possuem RLS sem políticas de acesso direto para anon/authenticated; gravações ocorrem pela função exclusiva ao service_role. Alterações usam revisão otimista, lock e auditoria na mesma transação.

O sistema registra somente metadados de validade. Nunca recebe o token neste formulário. Campos adicionais são recusados pela API e pela função SQL. A variável WHATSAPP_ACCESS_TOKEN permanece no Railway. Datas são declaradas pelo administrador e não atestam autenticação/entrega. Não existe seed de vencimento presumido.

Estados: validade não registrada; dentro do prazo; renovar em breve (dias restantes <= antecedência); vencido (<=0); sem expiração programada. Calendário America/Sao_Paulo. Aviso no dashboard, atualização a cada minuto enquanto visível. Não cria automação externa nem envia e-mail/WhatsApp de renovação.

Após gerar e substituir o token e concluir o deploy, o administrador registra as datas efetivas e pode ajustar a antecedência. Tokens sem expiração programada podem ser revogados. Envio de teste é uma operação separada, com destinatário autorizado.

Validação: 14 testes Jest do dashboard, 10 verificações PGlite de isolamento/RLS/auditoria/conflitos; builds e validação visual em produção no fechamento.
