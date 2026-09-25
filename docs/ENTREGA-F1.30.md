# F1.30 — Parâmetros por unidade e vigência

Entrega inicial da Etapa 4A da arquitetura ACL × ACR. Não calcula faturas, impostos ou economia e não substitui revisão tributária. Não há importação automática de tarifas.

## Fluxo

Contratos → cliente → Parâmetros de cálculo → unidade → categoria (tarifa, tributo ou custo/crédito) → cenário ACL/ACR → rubrica → valor, fonte e vigência. Salvar rascunho, revisar e aprovar. A consulta permite filtrar unidade, categoria e situação. Nova vigência copia os dados para outro rascunho e exige novas datas. A rubrica mantém identificador estável para identificar sobreposição.

Tributos: ICMS/PIS/Cofins/IOF e rubricas adicionais. Percentuais, tratamento por dentro/por fora/já incluído/isento/não aplicável; base e justificativa explícitas. Isento/não aplicável têm alíquota ausente, distinta de zero. Tarifa/custo bruto exige declaração dos tributos embutidos. IOF requer descrição da operação ou justificativa de não aplicação. Não são fornecidas alíquotas padrão. Custos são por unidade, com débito ou crédito; honorários continuam nos contratos próprios.

## Histórico e integridade

Aprovados não podem ter seu conteúdo editado. Retirar de uso exige justificativa, preserva revisão/evento e permite aprovar um substituto no mesmo período; não há exclusão. A retirada deverá afetar somente novas apurações: snapshots de resultados futuros permanecem vinculados à revisão originalmente utilizada.

A aprovação impede sobreposição para organização/unidade/categoria/rubrica/cenário, considerando que posto Todos conflita com Ponta e Fora ponta. Ponta e Fora ponta podem coexistir. Intervalos incluem ambas as datas. Edição, aprovação e retirada exigem revisão esperada para prevenir sobrescrita concorrente. A validação SQL de aprovação serializa operações da mesma rubrica com advisory lock transacional.

A autoria vem do contexto autenticado e não do corpo da requisição. Toda consulta/mutação filtra organização; a unidade e o cliente ativo são conferidos novamente. São reutilizadas as permissões existentes de consulta/criação/edição de contratos e o módulo licenciado free_market_management. Não há nova concessão de acesso. As tabelas usam RLS e não têm privilégios para anon/authenticated; acesso mediado pelo backend. Auditoria é append-only, gravada pelo trigger com search_path fixo.

Valores transitam em amount_text, decimal sem expoentes, até 12 dígitos inteiros e 6 decimais. O banco também gera amount NUMERIC(18,6) a partir desse texto, evitando divergência. A interface usa amount_text; o futuro motor deve usar Decimal ou NUMERIC, nunca a representação JavaScript de amount para operações monetárias.

Contexto da distribuidora, grupo/subgrupo, modalidade, UF, classe e situação no Mercado Livre é capturado da unidade ao salvar/aprovar. Tarifas públicas globais e dados legados não são alterados.

## Limites e próxima entrega

Base de incidência, isenções e tributos embutidos são registrados como regras e evidências textuais nesta primeira entrega. Isso não é uma fórmula executável nem prova de que todos os componentes estão cadastrados. Antes do motor, a próxima parte da Etapa 4 deve converter regras revisadas em composição estruturada de base, dependências entre rubricas, créditos e exclusões; validar completude por cenário/competência; implementar rateios e arredondamento; vincular medições e faturas aprovadas.

Não somar custos deste cadastro com o mesmo custo importado/contratado sem conciliação de origem. Rubricas adicionais usam OTHER_ seguido de identificador; cadastrar o mesmo custo com outro identificador não é detectado semanticamente e deve ser evitado na revisão. O motor deve verificar duplicidades de origem antes da publicação.

A aprovação aqui confirma o cadastro de um parâmetro; não publica resultados financeiros. O motor, consolidação financeira, OCR e API CCEE permanecem pendentes conforme ARQUITETURA-CENARIOS-ACL-ACR.md.

## Validação e implantação

Migração aditiva 20260925_f1_30_calculation_parameters.sql, testada duas vezes em banco isolado antes de produção. Testes incluem valor exato, campos inválidos, cliente/unidade de outra organização, licença, revisão desatualizada, conflito de vigência, imutabilidade, retirada, eventos e privilégios. Aplicar banco e backend antes da interface.
