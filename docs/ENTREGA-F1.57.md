# F1.57 — Composição operacional ACL × ACR

A consulta de preparação agora reúne tarifas da distribuidora, energia contratual do fornecedor, mínimo não consumido, compra extra, custos mensais e tributos aprovados em um subtotal por cenário. Usa as fontes automáticas introduzidas na F1.56 e o mesmo validador de referências tributárias do subtotal da distribuidora.

## Comportamento

- Soma em centavos no backend, conservando o arredondamento de cada rubrica.
- Energia contratual, mínimo e compra extra entram uma vez. A NF regular permanece evidência de conciliação; não é uma segunda despesa.
- Bases tributárias e impostos usados na composição de outros impostos não são somados novamente.
- Tratamento por dentro, por fora e tributos já incluídos seguem as regras explicitamente aprovadas. Tributos incluídos não geram acréscimo.
- Cada origem precisa corresponder ao parâmetro, revisão e valor da memória operacional. Custos adicionais conciliam também os identificadores dos itens e a versão validada.
- Pendências cadastrais, fontes ausentes, rascunhos, revisões divergentes, créditos sem tratamento específico, custos manuais sem origem, valores não conciliados e vigências parciais bloqueiam o subtotal. Ausência não equivale a zero.
- Não aplicação tributária em lançamentos mensais ainda precisa de uma origem compatível; não é convertida automaticamente para valor líquido ou bruto.
- O quadro mostra os motivos e atalhos para revisar parâmetros, custos e pendências. O subtotal isolado da distribuidora permanece em seção expansível.

## Como conferir

1. Contratos → cliente em operação → Preparar apuração.
2. Selecione unidade e competência e clique em Conferir competência.
3. Consulte Composição operacional dos cenários.
4. Quando pendente, use os atalhos e valide as fontes. Quando disponível, confira distribuidora, fornecedor, custos adicionais, tributos e subtotal, com rubricas/fontes/revisões.

Esta consulta continua somente leitura. Não há alteração de permissões, migração de banco, criação de lançamentos, cobrança ou envio de e-mail.

## Limites e próxima etapa

O subtotal reúne componentes revisados; não afirma completude documental nem representa fechamento financeiro publicado. Honorários fixos e variáveis, economia consolidada do cliente e snapshots de aprovação/publicação ainda não estão incluídos. O fixo continua integral por unidade; a base variável será a economia consolidada antes do fixo e somente o variável será rateado conforme os percentuais aprovados.

## Verificação

Testes de composição usam as funções reais de resolução das bases e memória tributária. Cobrem bases líquidas, imposto por dentro, valores brutos, mínimo, compra extra, ausência explícita, isolamento organizacional, versões divergentes, créditos e prevenção de duplicidades. Regressão do subtotal da distribuidora e das demais memórias mantém os comportamentos anteriores. A interface não realiza aritmética financeira e oculta subtotais quando a resposta está bloqueada ou incompleta.

Validação executada: 330 testes de backend, 16 verificações da nova interface, 28 do comparativo e 19 das bases automáticas. Builds de backend/frontend, lint dos componentes alterados e git diff --check aprovados.
