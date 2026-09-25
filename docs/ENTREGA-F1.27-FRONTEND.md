# F1.27 — Contratos e configuração energética por cliente

Substitui o formulário genérico por quatro áreas no Backoffice, mantendo a organização ativa e um seletor pesquisável de cliente visíveis:

- Distribuidora e unidades: instalação, distribuidora, grupo/modalidade, demanda kW, tensão e endereço. Usa a unidade existente, sem duplicar cadastro.
- Fornecedor Mercado Livre: contratos de compra/venda com volume, preço, vigência e reajuste; rascunhos e ativação existentes preservados. Contratos ativos permitem cadastrar e consultar preços por período sem sobrescrever o preço-base.
- Honorários: fixo ou híbrido, valor mensal, percentual apenas no híbrido, vigência e regras específicas. Abrangência do cliente como um todo, sem repetir o honorário em suas unidades. Revisão antes de registrar a vigência.
- Intermediação/outros: contraparte, objeto, abrangência (cliente/unidade), base de cobrança, valor e regras comerciais. Bases são informadas pelo usuário; não há cálculo ou cobrança automática.

Sem cliente selecionado, a interface oferece consulta consolidada da organização. Cadastros exigem seleção de cliente. Dados são remontados ao trocar de organização/cliente. Campos não salvos disparam aviso ao trocar cliente/área ou sair da página. Contratos anteriores de outros tipos continuam disponíveis somente para consulta, sem conversão automática para os novos cadastros.

Depende das APIs e migração de PR #26, já publicadas antes desta interface. Não requer variáveis ou nova migração. Validação: lint e build frontend aprovados; backend da etapa com 624 testes e 19 verificações de banco isolado aprovados. Fluxo visual será verificado em produção após publicação, sem gravar contratos reais de teste.

Limites: ainda não inclui motor de cálculo, rateio, aditivo completo, correção/encerramento antecipado de vigências imutáveis ou publicação ao portal Cliente. Honorários e serviços novos são registrados como vigências preservadas após confirmação. A edição de rascunhos de energia conserva as limitações da API anterior. Identificadores de contrato de energia/honorários continuam com a unicidade do banco existente.
