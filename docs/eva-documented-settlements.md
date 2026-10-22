# Conciliação documentada do fornecedor e tarifa por ciclo

Ativação: `EVA_DOCUMENTED_SETTLEMENTS_ENABLED=true`, com a rota de fechamento contratual já habilitada e a migração `20261208_eva_documented_settlements.sql` instalada. O padrão é desligado; consultas antigas preservam a captura anterior.

A referência ACR usa as datas de leitura comprovadas. Mudança tarifária no ciclo aplica TP = soma(Ti × Pi)/D (REN1000, art.173§2). A leitura anterior é excluída e a atual incluída. Valores são calculados com inteiros e arredondados ao centavo somente ao final da rubrica. Cada parcela conserva biblioteca, versão, vigência, fonte e dias. Lacunas, sobreposições e base fiscal desconhecida continuam pendências específicas.

A seção de conciliação do fornecedor fica disponível apenas no backoffice autorizado, nas propostas ainda não aprovadas. Usa a nota verificada e o lançamento da mesma organização/cliente/unidade/mês. A conferência explicita volume, preço, alocação, composição fiscal da parcela regular e valores finais CCEE. A proposta fica vinculada ao hash da nota, ao conteúdo/revisão dos custos e à autoria; mudanças exigem nova conferência. O documento é conferido contra os bytes privados, sem chamada OCR/IA.

Contrato regular: o volume da compra excedente é descontado do consumo medido, e o saldo deve caber na flexibilidade do anexo. Preço regular vem da memória de índice verificada. PIS/Cofins incluídos não são acrescidos novamente; o ICMS usa a base, alíquota e método explicitamente confirmados. Compra integral avulsa utiliza a NF e não recebe índice/flexibilidade do contrato anterior. Diferença de volume permanece visível, sem ser atribuída automaticamente a perdas.

A captura atômica passa a incluir os metadados das notas do fornecedor na rota nova. Somente service_role executa a função; as permissões, isolamento e validação financeira anteriores permanecem no fluxo delegado. Nenhuma tabela nova e nenhum histórico aprovado é sobrescrito.

Salvar conciliação prepara outra proposta, sem aprovar, publicar, pagar ou gerar cobrança. Garantia financeira não é presumida despesa. Na homologação, verificar primeiro as fontes e os totais, depois realizar a decisão financeira pelo perfil responsável. Uma nova fatura mensal não comprova sozinha notas do fornecedor ou encargos externos ausentes.

Testes: `node node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/modules/ocr/documented-tariff-period.spec.ts src/modules/ocr/documented-supplier-settlement.spec.ts` e `node test/documented-settlements.cjs`, além dos testes de preparação, comparação, alterações, publicação e fontes, build backend e build frontend.

## ICMS padrão de energia

Novas propostas do fornecedor e aplicações da biblioteca usam ICMS por dentro: imposto = base líquida × alíquota ÷ (1 − alíquota). Preço contratual sem ICMS não significa cálculo por fora. A alíquota e a fonte continuam explícitas; valores finais de notas não recebem o imposto novamente.

A demanda utilizada e a não utilizada permanecem segregadas. Demanda não utilizada usa sua tarifa vigente e fica excluída da base do ICMS, independentemente da distribuidora. A validação da biblioteca e a memória tributária rejeitam inclusão indevida, sem alterar parâmetros ou fechamentos históricos. PIS/Cofins conservam seu tratamento próprio comprovado; a exclusão de ICMS não declara isenção de outros tributos.
