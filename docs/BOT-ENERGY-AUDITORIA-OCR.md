# bot-energy — Auditoria OCR

A área dedicada consulta faturas por cliente, unidade, competência e versão, usando o catálogo privado existente. As APIs continuam exigindo organização, RBAC e licença. Contratos mantém seus formulários, valores e regras.

Cards exibem somente campos, fontes e situações consultados no backend. O olho abre a conferência; a caixa com seta abre a área relacionada. Ver o documento não confirma auditoria. Percentuais, valores de impacto e economia não são inventados. CCEE/PLD permanece aguardando habilitação.

Rascunhos mensais pendentes podem bloquear várias memórias de cálculo pela mesma causa. A tela apresenta os registros preenchidos e a próxima validação, mantendo todos os apontamentos no diagnóstico técnico. No Tennis havia 41 bloqueios e dois rascunhos mensais a validar; isso não equivale a 41 campos novos.

Validação conjunta: exige conferência humana explícita, plano atual e perfil já autorizado (gestor/admin_org ou platform_operation), usa os serviços mensais vigentes com revision/status e retorna recibos por etapa. Falha parcial interrompe o lote; atualizar antes de repetir. Não aprova parâmetros tributários nem publica apuração. Operador pode conferir campos e preparar correções conforme permissões vigentes; aprovação financeira permanece exclusiva.

Confiança OCR não muda por confirmação humana; ausência não é zero; tributos embutidos não são repetidos. Valores iguais com formatação decimal ou fonte textual diferente não reabrem a competência automaticamente. Fonte revisada anterior é preservada.

Validação: 60 testes backend, regressões DOM de Auditoria OCR/resolução/assistente, navegação, custos e conciliação; lint dos arquivos frontend alterados; builds Next/Nest. Sem migration nesta entrega.

Pendências mantidas: 46 erros e 20 avisos de lint global; CCEE aguardando agendamento/habilitação; validações e decisões financeiras humanas ainda necessárias. npm audit completo retornou 45 avisos (3 low, 5 moderate, 37 high) na instalação antiga do backend; npm audit --omit=dev retornou zero avisos em produção. Isso não substitui auditoria de segurança completa. Registrar análise de dependências de desenvolvimento em escopo próprio, sem npm audit fix --force incidental.
