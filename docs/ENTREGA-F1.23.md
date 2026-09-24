# F1.23 — Ativação e desativação por organização

A lista de usuários passa a oferecer Desativar nesta organização e Reativar nesta organização, com confirmação do destinatário e efeito. O vínculo e seu histórico são preservados; os vínculos em outras organizações e a identidade de autenticação permanecem independentes.

PATCH /api/v1/admin/users/:userId/status recebe somente status active/inactive. A organização e o ator vêm do contexto autenticado. Desativar exige USERS_DELETE; reativar exige USERS_UPDATE. O servidor confere a função do alvo e suas permissões. Somente o administrador da plataforma em operação pode gerenciar um admin_org. Não é possível alterar o próprio acesso por essa ação.

A nova RPC restrita a service_role revalida o ator, a hierarquia, a função e o estado esperado. Usa o mesmo bloqueio por organização da quota de licenças. Desativar o último responsável (admin_org ou gestor ativo) é recusado por esse fluxo. Reativação respeita o trigger existente de limite de usuários de licenças vigentes. Organizações sem limite vigente mantêm a política anterior; esta etapa não muda as regras comerciais da licença.

Status e auditoria são confirmados na mesma transação. Falha de auditoria reverte a mudança. O DELETE legado delega à mesma implementação, preservando rota e resposta. Os testes da antiga compensação foram substituídos por testes da transação e regressão da rota.

## Instalação

Aplicar 20260924_f1_23_membership_status.sql antes de publicar o backend. A instalação cria somente uma função; não ativa nem desativa usuários existentes. Ensaio BEGIN/ROLLBACK aprovado no Supabase de produção. Não altera o template de e-mail nem envia mensagens.

## Validação

- Regressão backend: 56 suítes, 570 testes aprovados.
- Backend build, frontend lint e frontend build aprovados.
- Banco isolado: isolamento por organização, hierarquia, último responsável, concorrência detectada por estado/função, quota, rollback de auditoria e execução restrita.
- Testes reais de desativação/reativação ficam para o titular, usando usuário de teste gerenciável. Nenhuma conta real foi alterada pelo agente.

## Teste no navegador

1. Como administrador da plataforma, abra uma organização e Usuários.
2. Num usuário de teste, clique Desativar nesta organização e confira a confirmação; Cancelar não altera o vínculo.
3. Confirme a desativação. O estado passa a Inativo e o acesso às operações dessa organização deve ser recusado.
4. Clique Reativar nesta organização e confirme. O usuário volta a acessar com a função anterior, se houver vaga na licença.
5. O próprio usuário não oferece a ação. Para o último responsável, mantenha outro responsável ativo antes de testar.

A validação é desta etapa incremental. Portal do cliente, OCR completo, indicadores energéticos e demais módulos do Prompt Mestre continuam sujeitos às próximas entregas.
