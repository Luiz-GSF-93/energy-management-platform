# Portal: clientes e unidades autorizadas

O mesmo usuário externo Consulta pode ter vínculos explícitos com vários clientes da mesma organização e com unidades específicas de cada cliente. A seleção no Portal apenas escolhe um vínculo já autorizado; não concede acesso.

Em **Backoffice → Usuários → Acessos ao Portal por cliente e unidade**, um administrador/gestor interno com permissões de convite e consulta de licença seleciona usuário, cliente, unidades e justificativa. Cada alteração exige a revisão atual e um identificador de operação; concessões, restrições e revogações ficam auditadas. A licença e a cota de usuários de cada cliente continuam obrigatórias. O formulário não muda senha, papel, conta ou preferências de comunicação.

Novos vínculos usam uma lista explícita de unidades. Criar outra unidade não a adiciona automaticamente. Os vínculos exclusivos anteriores são migrados sem ampliar os direitos existentes; ao salvar pelo novo painel, passam à lista explícita escolhida.

O backend deriva organização e usuário da autenticação, valida cliente/unidades no banco e reconfere a revisão antes de devolver a resposta. Documentos, arquivos, atendimento, publicações, preços, projeções, EVA e totais são filtrados. Os totais restritos somam valores publicados das unidades permitidas, preservando os registros e hashes originais. Trocar empresa desmonta os gráficos e PDFs antigos; respostas atrasadas da empresa anterior são descartadas. Revogar acesso interrompe a consulta, inclusive se já estava em andamento.

As funções financeiras originais permanecem intactas. O runtime privado conserva assinaturas e exige que a fonte de cada função permaneça na revisão homologada. Uma futura migração que altere uma dessas fontes deve atualizar o runtime privado e repetir os testes de compatibilidade; a divergência bloqueia a nova consulta, em vez de executar uma regra de autorização antiga.

Ativação inicial: aplicar 20261240–20261243 com recurso desligado; habilitar `client_portal_policies.multi_customer_enabled` apenas na organização homologada; configurar `PORTAL_MULTI_CUSTOMER_ENABLED=true` e `PORTAL_MULTI_CUSTOMER_ORGANIZATIONS=org_default`. As demais organizações permanecem no fluxo anterior. Desativar a política mantém os vínculos e auditoria e bloqueia contas já geridas pelo novo escopo, sem voltar a um acesso mais amplo.

A sessão é temporária por aba. O EnergyOS não armazena a senha. Logout remove tokens/contextos; a expiração exibe dez segundos para renovar e volta ao login sem renovação. Revogação explícita encerra imediatamente; falha de rede não equivale a expiração.

Validação: `backend/test/portal-customer-access.cjs`, testes Jest de contexto/guardas/projeções/worker e `frontend/test/portal-customer-access.cjs`; o workflow de entrada do Portal executa esses checks e os builds. A homologação real usa somente leituras em transação com ROLLBACK, sem OCR/IA pago, mensagens, nova cobrança, aprovação financeira ou alteração de fechamentos.
