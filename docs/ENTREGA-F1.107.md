# F1.107 — Consumos validados na prévia por componente

A falta de demanda medida não deve ocultar TUSD energia e CDE quando seus consumos estão validados. A prévia tariffs-1.2 permite calcular TE, TUSD_ENERGY e CDE_WATER_SCARCITY em R$/kWh ou R$/MWh apesar do achado específico MEASUREMENTS_DEMAND.

Somente essa dependência é separada. Fonte/autor de validação, organização/cliente/unidade/competência, contexto elétrico, histórico, correções em rascunho, integridade decimal, soma dos consumos e postos tarifários continuam obrigatórios. Os demais componentes continuam sob a verificação integral das medições. Não há preenchimento ou inferência de demanda.

prepareMeasurements e prepareMonth conservam MEASUREMENTS_DEMAND como BLOCKER. A composição operacional e a prévia consolidada continuam sem liberar subtotal financeiro/economia enquanto houver pendências. O aviso da memória identifica que a prévia é parcial. Aprovações e dados persistidos não são modificados.

## Validação

330 testes em seis suítes: tarifas, medições, memória tributária, subtotal da distribuidora, composição operacional e consolidado do cliente. Build backend e diff check. Regressão da fatura de homologação: TUSD ponta 11.172,94; fora ponta 21.211,15; CDE ponta 57,19; fora ponta 501,34, preservando tributos embutidos e fontes/revisões. Demanda ausente continua sendo bloqueio de fechamento.

Sem migração de banco, alteração de variáveis ou reprocessamento Azure.
