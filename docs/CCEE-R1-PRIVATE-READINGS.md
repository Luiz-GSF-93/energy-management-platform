# CCEE R1 — preparação privada (19/10/2026)

## Entrega e limites

R1 acrescenta a área **Dados CCEE** no backoffice, gestão versionada de vínculos,
fila persistida de pontos/medições/PLD, calendário oficial revisado e métricas
agregadas em **Custos e performance**. Não aprova fechamentos, publica PLD,
transmite contratos ou presume autorização a partir do sucesso de uma consulta
de perfil. R2 (resultados contábeis), R3 (transmissão/webhooks) e demais serviços
continuam fora desta entrega.

As quatro flags abaixo devem permanecer `false` na entrega técnica:

```
CCEE_DATA_WORKSPACE_ENABLED=false
CCEE_PRIVATE_READ_ENABLED=false
CCEE_SYNC_WORKER_ENABLED=false
CCEE_OFFICIAL_CALENDAR_ENABLED=false
```

Ausência da variável equivale a desligado. Não alterar `CCEE_READ_ENABLED`,
credenciais, perfil padrão, flags EVA/SMS, corpus ou preços existentes. Com as
flags desligadas não há coleta automática, download do calendário ou trabalho
de fila. A consulta de métricas agrega somente registros locais.

## Banco e autorização

Aplicar antes do backend a migração
`backend/src/database/migrations/20261113_ccee_private_readings.sql`.
O prefixo segue a sequência já existente do repositório; a data desta entrega
é 19/10/2026. Executar uma única vez, como migração versionada, em transação,
com limites de lock e statement. Conferir previamente a existência das tabelas
de intake, dados mensais, agenda e equipe da plataforma.

Quatro tabelas novas: `ccee_integration_jobs`, `ccee_integration_events`,
`ccee_calendar_versions`, `ccee_calendar_items`. RLS habilitada e nenhum acesso
direto para anon, authenticated ou service_role. RPCs com search_path fixo e
autorização atual no banco. Histórico de eventos e itens é imutável.

`ccee_unit_authorizations` recebe vigência, perfil principal, modalidade de
representação, serviços explicitamente autorizados, base de medição e medidor.
Vínculos antigos não ganham autorização inferida. Aprovação/revogação cria
nova revisão e exige revisor diferente do autor. Organizações, licença,
cliente/unidade ativos e vínculo mais recente são reconferidos na execução.

Permissões novas, **sem concessão automática**:

| Permissão | UUID |
| --- | --- |
| ccee_data.view | f5364101-4486-42c2-a90f-807937ac3011 |
| ccee_data.manage | f5364101-4486-42c2-a90f-807937ac3012 |
| ccee_data.review | f5364101-4486-42c2-a90f-807937ac3013 |

Cliente/portal e perfis globais não recebem intake privado. A operação da
plataforma usa a sessão organizacional já existente. Financeiro vê métricas
agregadas; administrar fonte pública não concede acesso a clientes.

## Conectores e preparação

`CceePrivateConnector` resolve hosts fixos e credenciais no servidor, usa mTLS,
TLS 1.2, valida certificado, namespace SOAP e XML sem entidades/DOCTYPE.
Não aceita URL de usuário, redirect, retry automático ou escrita remota.
Pontos retornados são limitados ao ponto do vínculo revisado. Medições são
coletadas por dia de competência encerrada; unidade, fuso, duplicação, intervalo,
qualidade HCC e cobertura horária são conferidos. Valores ausentes não viram
zero. Faltantes permanecem parciais e exigem medidor; layout incompatível falha
sem incorporar dados. Intervalos de cinco minutos não estão homologados.

Cada execução guarda horários, contagem de requisições/bytes, hashes e
Transaction IDs disponibilizados pela fonte. Timeout por requisição: 25 s;
resposta: 2 MiB; paginação de pontos: 20 páginas/1.000 itens. Worker: uma execução
local por vez, lease de três minutos, fila limitada e deduplicada. Lease
expirado registra falha sem retomar/repetir silenciosamente. Autorização é
revalidada antes de chamadas e antes de persistir conteúdo privado.

Medição final completa pode preparar **rascunho** no módulo mensal existente
somente com base sem perdas comprovada, permissão de contratos e reconciliação.
Preserva rascunho existente e versões validadas. Não infere demanda, ponta,
fora-ponta ou reativos faturados. Consumo SCDE não substitui automaticamente a
fatura. Intake fica PENDING; não há aprovação financeira implícita.

PLD reutiliza a prévia existente, com média aritmética horária, cobertura e
hashes; não é preço ponderado de liquidação nem publicação de preços.

## Calendário oficial

Coletor separado, somente HTTPS `www.ccee.org.br/documents/` ou
`/o/ccee/documentos/`, sem parâmetros, credenciais ou redirect. Arquivo máximo
5 MiB; parser SheetJS CE 0.20.3 do fornecedor oficial, em processo isolado,
128 MiB/10 s, sem credenciais, macros ou avaliação de fórmulas. Usa apenas
valores de células preservados no arquivo. Limites de planilhas/células/saída
evitam importações ilimitadas.

Owner informa mapeamento explícito de colunas para título, competência,
aplicabilidade e data/hora. Linhas ambíguas ficam em quarentena. A R1 **não
homologou o layout real do calendário 2026**: datas sem hora explícita, matrizes
ou formatos não reconhecidos exigem curadoria/adaptação antes de aprovação.
Não presume horário final do dia, feriado ou obrigação universal.

Outro Owner revisa a versão integral. Diferenças de itens/prazos aparecem na
prévia. Associação privada exige vínculo com escopo AGENDA, responsável válido,
permissão operacional e versão vigente; chama `save_operation_record` na mesma
transação, criando compromisso OPEN. Não marca obrigação cumprida na CCEE nem
reescreve agendas concluídas.

## Custos

Métricas Owner/Financeiro: execuções, completas/parciais/falhas, tentativas,
bytes e duração. Interrupção antes da finalização pode deixar métricas
incompletas. Nenhuma API de faturamento foi conectada; custo real desconhecido
não aparece como zero. O catálogo existente recebe o modelo **CCEE · integração,
processamento e tráfego**. Registrar o componente e o orçamento antes da
homologação; não duplicar custos compartilhados de Railway/banco e não usar
o orçamento do Azure Search. Avisos de 80% seguem o orçamento validado e os
lançamentos efetivos no catálogo já existente.

## Validação e implantação

Fixtures sintéticas: Jest CCEE/catálogo, SQL PGlite (incluindo as migrações
reais dos módulos mensais/agenda), interface JSDOM, builds Nest/Next e CI
`ccee-private-readings.yml`. Testes cobrem isolamento, licença/permissão,
representação parcial por escopo, revisão independente, leases, revogação,
duplicação, XML, lacunas, quarentena e preservação de rascunhos. Não equivalem
a homologação SOAP com cliente real ou XSD vigente na CCEE.

Ordem: banco → backend → frontend, flags false; conferir versões e health.
Rollback operacional: desligar somente as quatro flags novas, pausar novas
solicitações e preservar histórico. Não remover tabelas/evidências para rollback.

Fase posterior delimitada: conferir vínculo/unidade do piloto escolhido pelo
Owner, escopo e perfil principal no SCDE, testar período autorizado, conciliar
com fatura, homologar layout/calendário e custos. Nenhuma consulta real foi
necessária para implementar/testar esta entrega.

Referências técnicas usadas na preparação:

- https://github.com/devccee/postman-collections
- https://github.com/devccee/guia-medicoes
- https://www.ccee.org.br/en/calendario
- https://docs.sheetjs.com/docs/getting-started/installation/nodejs/
