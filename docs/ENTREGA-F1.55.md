# F1.55 — Tarifas com tributos já inclusos

## Problema e comportamento

Tarifas GROSS com códigos embutidos aprovados eram bloqueadas pelo subtotal, mesmo quando o cadastro já declarava o tributo como INCLUDED. A memória agora confere as referências explícitas e admite o valor bruto uma única vez, sem extrair impostos nem acrescentá-los novamente.

Cada declaração INCLUDED conserva fonte, revisão e rubricas incluídas/excluídas. Os códigos do cadastro e da memória precisam coincidir; cada tarifa do cenário deve estar classificada. Tributo calculado sobre preço bruto, código sem declaração, isenção conflitante, referência desatualizada, rascunho, competência sem medição validada e cobertura parcial continuam bloqueados. NET e GROSS podem coexistir somente com bases explicitamente separadas.

## Interface e utilização

Em Contratos → Preparar apuração, o quadro da distribuidora mostra **Tarifas aprovadas**, **Tributos a acrescentar** e os códigos **Já inclusos nas tarifas**. Em Conferir composição e fontes, cada tarifa bruta identifica seus tributos. A Memória tributária apresenta a declaração de já incluído com as revisões das rubricas. Tributo já incluído não significa isenção nem imposto zero.

Para uma tarifa bruta existente: conferir códigos embutidos em Parâmetros; no tributo da mesma unidade/cenário/vigência, usar Já incluído e referenciar as tarifas correspondentes; excluir explicitamente as demais; revisar/aprovar conforme as permissões; executar novamente Conferir competência. Se houver outros impedimentos, o subtotal continua sem valor e mostra os motivos.

## Arquitetura e segurança

Memórias somente leitura, sem alteração de registros financeiros, migração ou mudança de permissões. Escopo por organização, cliente, unidade e cenário. Fórmulas tax-memory-1.4 e distributor-subtotal-1.1. Soma de centavos exatos no backend, sem cálculo financeiro no navegador.

A documentação de arquitetura foi alinhada às decisões confirmadas: limite máximo do fornecedor como tolerância acima do volume contratado; fixo de gestão integral por unidade; percentual sobre economia consolidada antes do fixo; rateio somente da parcela variável.

## Validação

- Build backend e frontend aprovados.
- 192 testes do cálculo tributário e subtotal aprovados.
- Interface: 16 verificações do subtotal e 19 da memória tributária aprovadas.
- ESLint nos dois componentes alterados aprovado.
- 111 testes de regressão de contratos e tarifas aprovados (303 testes de backend nesta entrega).
- Nenhum dado de negócio foi criado ou alterado para teste em produção.

## Etapa e limites

Continua a Etapa 4 do Prompt Mestre, motor de apuração. Este subtotal é da distribuidora, não o custo total ACL/ACR. Ainda faltam a composição tributária do fornecedor/custos, consolidação financeira completa do cliente, honorário variável e snapshots com validação/publicação. Não há economia final nem fechamento automático nesta entrega. OCR, API CCEE e dashboards financeiros publicados permanecem etapas seguintes.
