# F1.24 — Aviso de vínculo e recuperação de organização no login

Usuários existentes recebem uma notificação ao serem vinculados a outra organização. O aviso informa organização, função, vínculo e o endereço de login, usando a conta existente. Novas identidades mantêm o convite de definição de senha pelo Supabase.

O envio acontece após a auditoria do vínculo. Falhas no provedor não desfazem a associação: a interface informa o resultado e disponibiliza Enviar aviso do vínculo para membros ativos e gerenciáveis. O servidor resolve destinatário e organização; exige permissão de convite, escopo ativo e hierarquia de atribuição. A chave de idempotência por vínculo evita duplicação de tentativas dentro da janela do Resend. Aceitação pelo provedor não comprova entrega na caixa postal.

Configuração: RESEND_API_KEY no backend Railway, com Sending access no domínio verificado. MEMBERSHIP_EMAIL_FROM é opcional; padrão Expert Energy <nao-responda@notificacoes.expertenergy.com.br>. FRONTEND_URL deve ser HTTPS. Nenhuma chave deve ir ao frontend. Referência: https://resend.com/docs/api-reference/emails/send-email

O login explícito recupera uma organização ativa quando o contexto anterior foi desativado: consulta vínculos do próprio usuário, usa a troca de organização autorizada e auditada e valida o contexto novamente. Administradores globais mantêm seu fluxo. Renovação de sessão e formulários em andamento não trocam organização automaticamente.

Validação: testes de notificação, rejeição do provedor, falha de rede, configuração ausente e autorização; 7 verificações da recuperação de contexto; testes backend e builds frontend/backend.
