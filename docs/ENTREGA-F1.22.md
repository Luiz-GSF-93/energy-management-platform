# F1.22 — Recuperação pela gestão de usuários

A área Usuários de uma organização oferece “Enviar recuperação de senha” para contas ativas sob gestão do ator. Antes de enviar, mostra o e-mail cadastrado e explica que a senha é compartilhada pelos acessos da conta às suas organizações. A ação reaproveita o fluxo de recuperação F1.21, validado pelo titular em produção.

## Autorização e comportamento

- POST /api/v1/admin/users/:userId/recovery-email exige ORGANIZATION_USERS_UPDATE, sessão e contexto de organização.
- O servidor resolve o vínculo na organização atual, rejeita vínculo inativo e valida a hierarquia pela função do destinatário.
- Administrador da organização só pode ser alvo de outro usuário quando o ator opera como administrador da plataforma. O próprio usuário autorizado pode solicitar para si.
- Destinatário e redirecionamento não vêm do formulário. Campos extras são rejeitados.
- A ação não altera senha, papel, vínculo, licença ou estado de ativação. O destinatário conclui pelo link de uso único.
- Pedidos gerenciados e públicos compartilham o limitador de recuperação. O fluxo público mantém respostas sem enumeração; o gerenciado informa quando o provedor não confirma o envio.
- Logs estruturados do backend registram ator, organização, alvo e resultado da solicitação, sem e-mail, senha ou token. A retenção segue os logs do provedor de hospedagem; ainda não há painel de histórico desses eventos no banco.

## Validação

56 suítes / 572 testes aprovados. Builds backend e frontend e lint aprovados. Testes cobrem isolamento da organização, vínculo inativo, hierarquia, contexto de plataforma, autorrecuperação, falha de consulta, campos injetados, permissão de atualização, limites compartilhados e erro do provedor.

## Teste manual

Entrar numa organização, abrir Usuários, localizar uma conta ativa e clicar em Enviar recuperação de senha. Conferir o destinatário e confirmar o envio. O usuário deve abrir o e-mail mais recente, definir a senha e entrar novamente. Cancelar a confirmação não envia e-mail.

Este é um novo link de recuperação de uma conta já provisionada; não é um novo vínculo nem um reenvio do convite original. Portal do cliente, ciclo completo ativar/desativar, métricas de acesso, MFA e demais fases do Prompt Mestre seguem pendentes.
