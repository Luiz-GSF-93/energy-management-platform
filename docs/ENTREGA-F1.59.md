# F1.59 — Revisões preservadas por unidade

## Comportamento
Na conferência ACL × ACR, o bloco Revisões preservadas da unidade permite registrar uma revisão interna com motivo, consultar o histórico paginado e abrir os valores e pendências tal como foram capturados. Autor é mostrado por nome, com indicação explícita se o diretório não fornecer um nome.

A preservação consulta novamente o motor existente no servidor. O cliente envia somente unidade, competência, motivo e chave de repetição segura. Dados ausentes permanecem ausentes; pendências não são convertidas em zeros. Novos ajustes geram nova revisão. Não há edição, exclusão, aprovação, publicação ou faturamento nesta entrega.

## Persistência e escopo
Tabela calculation_review_snapshots, isolada por organização, cliente, unidade e competência. Versões sequenciais por unidade/mês; trava transacional na numeração; chave de solicitação única por organização. Trigger impede UPDATE e DELETE, inclusive pelo proprietário em operações normais; service_role tem apenas SELECT e INSERT e não TRUNCATE. Anon e authenticated não possuem acesso direto. Endpoints mantêm TenantGuard, permissões existentes de contratos e entitlement free_market_management.

Fontes internas incluem contexto da unidade, parâmetros, contratos, preços, serviços, medições, custos, honorários e regra de fornecimento usados pela preparação. A resposta pública não expõe as linhas brutas dessas fontes. JSONB preserva o resultado; SHA-256 com ordenação canônica de chaves é verificado antes de abrir/repetir uma revisão. Paginação usa cursor de versão (20 itens).

O intervalo de coleta é registrado. As consultas de origem não constituem uma transação única: a versão é uma evidência imutável dos dados lidos, não uma declaração de fechamento consistente de todo o mês. O consolidado financeiro do cliente da F1.58 não está congelado neste registro por unidade.

## Compatibilidade verificada
Inspeção somente leitura do banco de produção identificou monthly_energy_settlements vinculado a energy_contract_id, month e version_number, distinto de docs/supabase-schema.sql. Essa tabela legada foi mantida intacta. Não foi criado um segundo motor de cálculo.

Migração: backend/src/database/migrations/20260926_f1_59_review_snapshots.sql. Sem alterações de dados de negócio existentes, reenvio de e-mails ou apurações sintéticas em produção.

## Testes
- Backend: 58 testes de preservação, integridade, escopo, licença, idempotência, fontes, consolidação e regressão.
- Banco isolado: 21 verificações, incluindo migração repetida, versões, duplicidade, RLS/privilégios, bloqueio de alteração/exclusão e tentativa de aprovação.
- Interface: 83 verificações (17 de revisão, 22 do consolidado, 28 do comparativo e 16 da composição); resposta tardia de outra unidade, repetição da solicitação e permissão somente leitura.
- Builds de backend e frontend; lint e git diff --check.

## Próximas etapas
Continuamos na Etapa 4: faltam completar os tratamentos financeiros pendentes, preservar o consolidado do cliente com fontes consistentes, e implementar aprovação/publicação financeira. OCR, integração CCEE e dashboards com resultados publicados continuam etapas posteriores.

Migração aplicada em produção e verificada por consulta somente leitura: RLS ativo, trigger presente, acesso direto negado a anon/authenticated, service_role sem UPDATE/DELETE/TRUNCATE. Tabela vazia após implantação; nenhuma revisão de teste criada em produção.
