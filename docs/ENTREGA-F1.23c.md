# F1.23c — Organizações anteriores ao provisionamento RBAC

REG Test não tinha os quatro papéis organizacionais. Default mantém um vínculo de bootstrap com admin_platform global, necessário para a sessão global legada e incompatível com a listagem operacional.

A migração restrita às duas organizações cria apenas papéis ausentes a partir do resolvedor canônico, com auditoria. Não altera permissões existentes ou membros. A listagem omite apenas o vínculo global admin_platform estruturalmente válido; leitura individual e mutações continuam exigindo papéis organizacionais. Papéis inválidos continuam sendo rejeitados.

Validação: 8 testes SQL de idempotência, isolamento e preservação; 56 suítes e 574 testes backend aprovados; compilação backend. REG Test abre a operação e o formulário de usuários com os quatro perfis.

Durante a validação em produção, uma normalização do vínculo legado revelou dependência da sessão global e foi revertida; a restauração foi auditada. A solução final preserva esse vínculo e a administração global.
