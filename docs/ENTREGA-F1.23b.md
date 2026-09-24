# F1.23b — Correção da alteração de acesso

A confirmação de desativação falhava porque user_roles.user_id é text em produção e o identificador do ator da RPC é uuid. A migração corretiva normaliza apenas essa comparação, preservando permissões, isolamento entre organizações, auditoria e cotas.

A migração é idempotente e aborta se a definição esperada não for encontrada. O teste agora reproduz o tipo text da produção, demonstra o erro 42883 antes da correção e aplica a correção duas vezes.

Validação: 22 verificações SQL passaram. No Supabase, a operação real foi executada em uma transação de diagnóstico e revertida integralmente; o usuário permaneceu ativo. A migração corretiva foi aplicada em produção. Não é necessário alterar o frontend ou reiniciar o backend para esta correção.

Teste no navegador: atualizar Usuários, escolher Desativar e confirmar. O resultado esperado é Inativo apenas nesta organização.
