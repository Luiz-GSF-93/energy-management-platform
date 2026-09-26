# F1.58 — Prévia consolidada do cliente e honorários

A comparação por unidade ganha uma consulta explícita do cliente inteiro na mesma competência. A API lê todas as unidades atualmente cadastradas no escopo da organização/cliente e reutiliza a composição operacional da F1.57. Uma unidade pendente bloqueia todos os valores financeiros consolidados.

## Regra confirmada

- A = soma dos componentes ACR revisados de todas as unidades.
- L = soma dos componentes ACL operacionais revisados, antes dos honorários.
- Economia operacional = A − L; valores negativos são preservados.
- Fixo = valor mensal integral × quantidade de unidades, sem rateio.
- No híbrido, variável = percentual × máximo(A − L, zero), sem deduzir o fixo.
- Somente o variável é dividido pelos percentuais da regra mensal, que deve incluir exatamente todas as unidades, inclusive participação zero, e somar 100%.
- O variável é arredondado uma vez para centavos. Rateio por maiores restos conserva todos os centavos, com desempate pelo identificador da unidade.
- ACL após honorários = L + fixos + variável. Diferença preliminar = A − ACL após honorários.
- Percentual indisponível se ACR for zero. Prejuízo não vira economia zero; somente o variável possui piso zero.

Exemplo: duas unidades com ACR total de R$ 20.000 e ACL operacional de R$ 10.000, fixo de R$ 1.000 por unidade e variável de 20%. Fixo total = R$ 2.000; variável = R$ 2.000; honorários = R$ 4.000; diferença preliminar após honorários = R$ 6.000. Com rateio de 25%/75%, as parcelas variáveis são R$ 500/R$ 1.500, conservando fixo de R$ 1.000 em cada unidade.

## Consulta e interface

Contratos → cliente em operação → Preparar apuração → Conferir competência → Prévia consolidada do cliente → Consolidar todas as unidades.

A tela apresenta consolidado, memória por unidade, fontes/revisões, regra mensal e pendências. Atalhos levam aos parâmetros da unidade ou aos honorários. Respostas antigas após trocar cliente/competência são descartadas; totais não são calculados no navegador.

API GET /api/v1/calculation-preparation/customer recebe customerId e month, exige a mesma permissão de consulta de contratos e licença do módulo. Paginação explícita evita truncamento; até quatro unidades são consultadas em paralelo, com limite de 100 unidades por prévia síncrona. Acima disso retorna erro, nunca consolidado parcial. Se o conjunto de unidades mudar durante a leitura, exige nova consulta. Não altera permissões nem banco.

## Limites

Prévia somente leitura, sem faturamento, envio de mensagens ou publicação de economia. O conjunto considera todas as unidades atualmente cadastradas; não presume exclusões históricas. Tributos específicos dos honorários, completude documental, créditos ainda sem tratamento, congelamento das fontes, aprovação e publicação permanecem etapas posteriores. A leitura não é uma transação congelada; alterações exigem nova conferência.

## Validação

Testes de cálculo: exemplo confirmado, múltiplas unidades, compensação de prejuízo, valor fixo integral, piso somente no variável, percentual exato, centavos residuais, ACR zero, rateio incompleto, vigências e fontes inválidas. Testes de serviço: isolamento, cliente excluído, licença, DTO, paginação, falha de unidade e alteração do conjunto. Testes de interface: prévia/pendências, navegação, respostas tardias, erro e troca de contexto.

Verificação concluída: 125 testes de backend, 77 verificações de interface, builds de backend/frontend, lint dos componentes alterados e diff check aprovados. Nenhuma alteração de registros de negócio em produção foi necessária.
