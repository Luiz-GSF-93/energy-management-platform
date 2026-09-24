# F1.21 — Recuperação de senha

O login oferece “Esqueci minha senha”. O titular solicita o e-mail e define uma nova senha na página de recuperação. A API valida um token Supabase do tipo recovery antes de atualizar a senha; não aceita ID de usuário nem redirecionamento enviados pelo navegador. Nenhuma sessão é devolvida ao frontend.

## Configuração de produção

No Supabase, Authentication > Emails > Reset password, usar o modelo versionado em docs/email-templates/recovery.html e o assunto “Redefinir sua senha — Expert Energy”. O link aponta para /auth/reset-password#token_hash={{ .TokenHash }}&type=recovery. A página não consome o token ao abrir; captura o fragmento, remove-o da URL e o mantém somente em memória. Recarregar exige abrir o e-mail novamente. O modelo de convite permanece separado.

## Validação

- 55 suítes, 553 testes aprovados.
- Build backend, lint e build frontend aprovados.
- Cobertos: resposta sem enumeração de contas; token recovery obrigatório; token inválido/reutilizado sem alteração; rejeição de sessão ausente; senha 10–128; parâmetros extras; limites de tentativas; revogação após verificação.
- Teste real de recebimento e alteração da senha deve ser feito pelo titular, sem compartilhar senha ou link.

## Operação e limites

A aplicação limita por IP a 5 solicitações e 10 conclusões por minuto por instância. Os limites do Supabase também permanecem. Escalar múltiplas réplicas requer um limitador compartilhado. Falhas do provedor são registradas sem e-mail/token/senha e não revelam existência de contas ao solicitante. Após verificar o token, a sessão isolada tenta revogar globalmente os refresh tokens; falhas de revogação são registradas. JWTs já emitidos seguem sua expiração normal. Não há migração de dados ou alteração de papéis/permissões.

Reenvio de convite, MFA, portal do cliente e demais módulos do Prompt Mestre continuam como etapas separadas.
