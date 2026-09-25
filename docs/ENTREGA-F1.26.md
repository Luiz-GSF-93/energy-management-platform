# F1.26 — Operação de contratos no Backoffice

A API de contratos existente não tinha tela operacional. Esta entrega adiciona Contratos ao menu da organização e ao dashboard, com consulta, busca por número/fornecedor, filtro por cliente, cadastro em rascunho, edição dos campos já admitidos pela API e ativação explícita após confirmação. A unidade é selecionada dentro do cliente; o backend deriva e valida o cliente dentro da organização.

O formulário inclui número, fornecedor, tipo, volume MWh, preço R$/MWh, vigência, fonte, reajuste e observações. Erros de salvamento mantêm o formulário. Contratos ativos/históricos ficam somente para consulta, conforme a proteção já existente no backend. O menu e as ações respeitam permissões; a tela é remontada ao trocar de organização.

A verificação de licença/módulo free_market_management, antes aplicada somente no cadastro, agora também protege consulta, edição e exclusão no backend. Dados históricos permanecem armazenados. Sem nova migração e sem novas variáveis.

Validação: 57 suítes / 590 testes backend aprovados; build backend, lint e build frontend aprovados; 18 verificações de persistência em PGlite/PostgreSQL isolado aprovadas. Inclui negação de operações sem licença antes de consultar o banco, isolamento dos pais e proteção do histórico. Nenhum contrato de produção foi criado para testes automatizados.

Teste no navegador: entrar em uma organização com licença e Gestão do Mercado Livre; abrir Contratos; selecionar cliente/unidade; salvar rascunho; conferir valores; editar preço, volume, término ou observações; ativar após revisão; conferir que fica somente para consulta. A lista permite busca e filtro. Em outra organização os registros não devem aparecer.

Limites: esta entrega é a tela para o modelo existente, não a conclusão da etapa energética. Aditivos, histórico de preços por vigência, honorários e integração com cálculos seguem pendentes. Não há ação de exclusão na tela. Número de contrato ainda usa a unicidade global do esquema existente. Edição de rascunho preserva número, início, cliente, unidade, fornecedor e configuração de reajuste.
