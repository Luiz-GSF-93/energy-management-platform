# F1.19 — Funções atribuíveis e hierarquia

A lista de funções oferecia opções que o responsável não podia atribuir. Agora o endpoint filtra pelo conjunto de permissões do contexto autenticado, preservando o bloqueio de Administrador da organização para quem não opera como administrador da plataforma.

Inclui migração F1.19 para adicionar operacao.pld.sync ao Gestor canônico, alinhando o papel com o Operador sem contornar a verificação de subconjunto. Atualiza apenas funções exatamente iguais ao padrão anterior; funções personalizadas e globais são preservadas. Alterações são auditadas. Migração autorizada pelo titular e aplicada em produção em 24/09/2026 após ensaio com rollback. Pós-validação: dois perfis Gestor atualizados, dois registros de auditoria, 40 permissões canônicas e Operador contido no Gestor.

Validação: 54 suítes, 537 testes e build do backend aprovados. Teste PGlite cobre hierarquia, isolamento de funções personalizadas/globais, auditoria, reaplicação e rollback com catálogo incompleto. Sem alteração de frontend.

Teste manual: abrir Usuários com perfil Gestor; após aplicação da migração padrão, Operador deverá estar disponível. Administrador da organização permanece exclusivo da operação do administrador da plataforma. Convites de teste exigem destinatário autorizado.

Pendentes: homologação com sessão própria de Gestor, recuperação/reenvio de acesso e demais fases do Prompt Mestre.
