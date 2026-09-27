# F1.102 — Nova versão tributária após aprovação

Na verificação da F1.101, Del Rei já tinha sete parâmetros aprovados. As três declarações tributárias aprovadas referenciavam somente TUSD. Para preservar esses registros, a integração agora permite preparar um novo rascunho para cada tributo, com as quatro bases aprovadas TUSD + CDE.

- Mantém intacta a declaração aprovada; não a retira de uso nem aprova a substituta.
- Nova versão com ID determinístico por organização/documento/declaração anterior: uma inserção auditada, autor real e origem vinculada ao parâmetro anterior. Repetições retornam a mesma proposta.
- Permissões de cadastro e alteração obrigatórias. Reaproveita verificações de licença, escopo, evidência, prévia, bases e conflitos da F1.101.
- Se a proposta já foi editada e deixou de corresponder às quatro bases, pede revisão manual. A proposta continua identificada depois da retirada do registro antigo.
- Para efetivar a substituição: conferir a proposta, retirar a declaração anterior de uso com justificativa e aprovar a nova. Os bloqueios existentes impedem aprovações sobrepostas. Esse fluxo permanece uma revisão financeira explícita.
- Nenhuma migração. Inclui testes de preservação, idempotência, RBAC, revisão obsoleta e interface.
