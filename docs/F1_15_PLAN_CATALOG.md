O administrador da plataforma agora pode criar, editar e desativar planos com limites de usuários, unidades e documentos e módulos habilitados. Na organização, uma nova licença pode copiar a versão vigente de um plano; alterações posteriores no catálogo não modificam licenças existentes.

Inclui auditoria transacional, controle de versão para impedir gravações desatualizadas, isolamento por organização e limite de membros ativos no banco. Licenças antigas sem limite de usuários preservam seu comportamento. O catálogo começa vazio, sem preços ou planos fictícios.

Validação: 50 suítes / 506 testes backend; 21 verificações de banco; builds backend/frontend e lint aprovados no Codespace. Migração 20260924_f1_15_plan_catalog.sql aplicada com sucesso no Supabase antes da publicação.

Limites desta entrega: não inclui cobrança, troca automática de plano de licença existente ou conclusão de módulos analíticos. E-mail/Resend permanece pendente por solicitação do usuário. Revisão identificou divergência entre permissões Gestor/Operador em operacao.pld.sync, a corrigir em etapa própria sem enfraquecer a autorização.
