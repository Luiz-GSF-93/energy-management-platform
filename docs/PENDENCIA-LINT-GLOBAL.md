# Pendência registrada — lint global

Status: adiada por solicitação do usuário em 04/10/2026. Não faz parte da correção de conclusão do Tennis Country.

Baseline anterior: 46 erros e 20 avisos. Erros: 18 `set-state-in-effect`, 7 `error-boundaries`, 14 `unused-vars`, 2 `explicit-any`, 3 `no-redeclare`, 2 `no-global-assign`.

São apontamentos de qualidade e confiabilidade, não uma contagem de vulnerabilidades. O resultado não comprova ausência de problemas de segurança. Os arquivos desta entrega devem passar no lint do escopo; não declarar lint global aprovado.

Retomar em entrega própria: reproduzir o lint, classificar por risco, priorizar atribuições globais e falhas de renderização, corrigir em etapas sem alterar tenant/RBAC/licença ou aprovação financeira e testar os fluxos afetados. Aceite: lint global sem erros e regressões dos módulos alterados aprovadas.

CCEE/PLD permanecem adiados até agendamento e habilitação da integração.
