# Catálogo privado de serviços e custos

Entrega aditiva em Custos e performance. `PLATFORM_COST_SERVICE_CATALOG_ENABLED` permanece ausente ou `false` até homologação autorizada. A ativação desta capacidade não concede acesso a usuários nem consulta APIs de faturamento.

Owner registra revisões com justificativa; Financeiro autorizado consulta. Administrador operacional, Suporte e usuários de organizações não possuem acesso ao catálogo financeiro. O backend usa o ator autenticado e a RPC reconfirma perfil ativo e permissões a cada operação.

## Fontes e valores

O catálogo contém identificação declarada, ambiente, situação, origem, data de conferência, fonte HTTPS, observações e orçamento mensal opcional. Nunca registrar tokens, segredos ou URLs assinadas.

Os 15 modelos são exemplos para revisão do Owner, não registros criados, prova de contratação ou confirmação de preço zero. Incluem OpenAI, embeddings, OCR, Blob EVA, Search, Foundry, rede Azure, backend e PostgreSQL Railway, frontend, Cloudflare, WhatsApp, Asaas, Clicksign e backup. Novos serviços podem ser cadastrados sem alterar o código.

Valores financeiros continuam nos lançamentos de infraestrutura existentes. Uma revisão pode selecionar no máximo um lançamento por competência, até 24 referências. Um lançamento não pode pertencer simultaneamente a dois serviços atuais. Ao substituir estimativa por fatura, o lançamento anterior e a versão anterior permanecem intactos.

Os subtotais usam as seleções da competência e de todo o filtro, não apenas da página, separados por moeda e por fatura/estimativa. Não há conversão implícita, duplicação da telemetria de IA ou inclusão de orçamento nas despesas. Sem seleção significa **não informado**. O consolidado anterior permanece inalterado e considera seus próprios lançamentos.

## Histórico e recuperação

Duas tabelas privadas: `platform_cost_service_revisions` e `platform_cost_service_events`. Histórico imutável, código estável, versão esperada obrigatória para revisão e requisição identificada por UUID. A mesma requisição e ator recebem o resultado preservado; alteração do conteúdo com mesmo UUID é rejeitada. Escritas concorrentes usam trava transacional e versão esperada.

Na interface, falha de transporte preserva conteúdo e UUID, bloqueando edição e fechamento. O botão repete a requisição exata. Não abrir outro cadastro para contornar resultado incerto. Conflito de versão exige reconferir o serviço. Histórico em modal, 10 eventos por página; lista com 25 serviços por página e filtros explícitos.

## Validação e implantação

- Jest: validação de períodos, datas, metadados, IDs, URL, flag desligada e sanitização de erros.
- PostgreSQL descartável/PGlite: helpers reais de autorização, RLS, imutabilidade, concorrência, repetição idempotente, seleção financeira, moeda, orçamento, filtros e paginação.
- Interface real com respostas sintéticas: versão preservada, filtros, páginas, seleção mensal, falha incerta e consulta Financeiro.
- Compilações Nest e Next; auditoria de migração comparando dados, funções e ACL existentes antes/depois, sem sementes.

A homologação posterior deve cadastrar somente fontes conferidas, começando pelo Blob EVA já lançado. Chamadas Blob, credenciais Azure e APIs de faturamento continuam fora desta capacidade.
