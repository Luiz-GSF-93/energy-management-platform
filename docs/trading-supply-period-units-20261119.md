# Trading Hub — unidades, vigências e validade horária

A cotação nova usa `supplyVersion:3`; propostas usam `proposalVersion:3`. Os registros anteriores mantêm os campos e a interpretação dos períodos originais. A API anuncia `supportsSupplyV3` e `proposalValidityVersion`, permitindo publicar a interface compatível antes de concluir a API.

- A vigência tem datas inicial/final. A divisão usa ano-calendário e meses inclusivos: novembro/2027 a fevereiro/2028 = 2 meses em 2027 + 2 em 2028. Nenhum ano ultrapassa 12 meses; não se trata de prorrata diária.
- Referência ACL obrigatória por ano antes de abrir/enviar. Rascunhos podem ter referências pendentes.
- Uma ou mais unidades ativas do mesmo cliente e organização, até 50 unidades e 500 combinações unidade/ano. Oferta completa por unidade/ano, com condições comerciais por unidade. Ranking nominal separado por unidade/ano; aprovação é do pacote completo, sem atribuição parcial automática.
- O consumo médio é do conjunto. Não se inventa volume nem economia por filial a partir desse total. Os gráficos históricos expandem os preços da matriz sem usar o primeiro preço como preço global.
- O cadastro atual possui CNPJ no cliente, sem coluna CNPJ na unidade. Quando o operador opta por compartilhar, o documento do cliente é apenas referência para confirmar/ajustar o CNPJ de cada filial nesta cotação. Não altera cadastros. A opção Não remove CNPJs da projeção enviada ao fornecedor.
- Validade exata em Brasília; horário convertido usando America/Sao_Paulo. Legado com somente data vale até o fim daquele dia. Convite e rodada não são prorrogados pela validade do preço. Gatilhos impedem aprovação/contratação de preço vencido e limitam o prazo da decisão à validade comercial.
- Garantias: sem exigência, carta fiança, seguro garantia, caução e outro com explicação. Faturamento em DU após emissão da NF, modalidade boleto/transferência/outro com explicação. PDF não é alterado.
- Propostas/anexos agrupados pelo identificador da cotação. Originais e auditoria preservados. Os novos campos não enviam e-mail por si mesmos.
- A visão do cliente e a prévia usam o mesmo recorte autorizado por unidade/ano. Acesso de aprovação no portal exige autorização para todas as unidades do pacote.

## Implantação e reversão

Aplicar 20261341 e 20261342, depois API/interface compatíveis. Migrações aditivas e reaplicáveis, sem reescrever cotações ou propostas antigas. Preservam RLS, funções privadas, autenticação por convite e isolamento por organização. Não apagar as matrizes numa reversão. Para correção emergencial, suspender criação/envio de novas rodadas e publicar correção compatível; uma versão antiga que só conhece preço único não representa adequadamente dados V3.

## Verificações

Testes de API: matriz completa, limites, anos, validade horária, ranking nominal, dados públicos sem campos privados. Testes DOM: múltiplas unidades, CNPJ opt-in, períodos anuais, garantias e cobrança, conversão Brasília, campos obrigatórios e ausência de disparo implícito. Banco PGlite: escopo, vigências, invalidação horária, autorização de todas as unidades, projeção por recorte, privilégios e reaplicação. Os testes usam dados sintéticos; não enviam propostas nem e-mails reais.
