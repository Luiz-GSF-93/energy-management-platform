# EVA 2C2 — execução privada, desligada

Este incremento não altera rede, cria índices, concede funções Azure, lê segredos,
envia normas, publica conteúdo ou modifica o chat atual. A infraestrutura Search
isolada existente permanece intacta. A escolha do segundo Owner continua adiada;
a aprovação independente das releases é obrigatória no banco e não foi removida.

## Fluxo

Owner prepara um comando vinculado à release exata `APPROVED_PRIVATE`. A revisão,
os hashes e os dois Owners precisam continuar válidos. Há somente um comando por
release, inclusive depois de retirada, evitando nova tentativa com outro UUID.
O banco reserva uma lease transacional e limita fragmentos e tokens por comando.
Uma preparação ou lease não prova envio externo. Cada tentativa externa é
reservada antes da chamada. Recibo de embedding fica privado e imutável antes
do POST do Search; vetor não aparece nos endpoints de detalhe ou financeiros.

Execução inicial faz embeddings, upload `published=false` e GET de conferência
por ID determinístico. Confere conteúdo, hashes, versão, escopo e vetor, aceitando
somente a pequena tolerância numérica de 1e-6 para representação float do índice.
Falha, timeout ou resposta parcial ficam UNKNOWN. Restart não reenvia automaticamente.
Lease expirada autoriza somente reconferência explícita por outro comando do Owner.
Reconferência é GET: nunca refaz embedding ou upload. Registro ausente/divergente
continua UNKNOWN; autorização para novo envio é uma fase distinta.

A tarefa externa é iniciada pelo endpoint privado do Owner e continua no processo
do backend depois de retornar `queued`. Não há scheduler nem reinício automático.
Processo encerrado perde a tarefa em memória; a lease persistida permanece como
evidência ambígua para reconferência. A expiração não é prova de ausência de envio.

## Dados e autorização

Migração 20261030 cria três tabelas com RLS forçado, sem acesso direto de anon,
authenticated ou service_role. Eventos e recibos imutáveis; comandos possuem
estado/lease controlados pela RPC privada. Preserva cinco tabelas e RPCs 2C1.
RPC usa ator autenticado pelo backend e confere Owner ativo/role global no banco.
Financeiro consulta somente agregados; não acessa releases, vetores ou execução.
Não há concessão de perfil de plataforma ou aplicação de licença.

Endpoints sob `/api/v1/admin/eva/search-executions`: lista com filtros/paginação,
detalhe/histórico paginado, preparação, retirada, execute, reconcile e metrics.
O estado/evento esperado impede decisões sobre tela desatualizada. UI guarda UUID
da tentativa e exige consulta antes de preparar outra quando a resposta é incerta.

## Flags e credenciais futuras

Entrega com todas as novas flags ausentes/desligadas:
`EVA_SEARCH_EXECUTION_ENABLED`, `EVA_SEARCH_EXECUTION_CALLS_ENABLED`,
`EVA_SEARCH_EMBEDDING_CALLS_ENABLED`. Preservar INDEX/QUERY_CALLS desligadas.

Index fixo `eva-official-pilot-v1`; conector Search usa endpoint, tenant e aplicações
INDEX/QUERY já definidos no contrato 2C1. Embedding oficial tem configuração isolada:
`EVA_SEARCH_EMBEDDING_ENDPOINT`, `EVA_SEARCH_EMBEDDING_DEPLOYMENT`,
`EVA_SEARCH_EMBEDDING_CLIENT_ID`, `EVA_SEARCH_EMBEDDING_CLIENT_SECRET`.
Usa tenant Search, autenticação Entra no recurso OpenAI existente e deployment de
text-embedding-3-small (1536 dimensões), sem credencial/cota de uma organização.
A identidade de embeddings e seu grant no OpenAI serão apresentados e aprovados
na configuração externa, junto às identidades Search; não são concedidos aqui.
Não gerar ou inserir segredos por código/chat. Entrada direta pelo usuário.

Configuração de rede futura precisa de aprovação: público filtrado nos três
IPs estáticos reconferidos do Railway + Entra, sem bypass; não é Private Endpoint.
IPs Shared não identificam exclusivamente o software. Reader/Contributor em
escopo mínimo do índice; Contributor inclui remoção de conteúdo, embora o EnergyOS
não exponha comando de remoção. Nenhum runtime Owner/Contributor de gerenciamento.
Índice vazio/esquema exige operação administrativa própria, fora do executor.

## Custos e limites

O limite de tokens é conservador pelo tamanho em bytes UTF-8 de cada texto. Não é
limite monetário. Homologação paga requer tarifa, limites e aprovação específica.
Registros de `send` são tentativas reservadas, não prova exata de cobrança externa.
Tokens dos recibos são consumo conhecido; erros podem ter consumo não confirmado.
Custo monetário permanece null/NOT_CONNECTED até evidência/tarifa/fatura conectadas.
Custos e performance mostra agregados Owner/Financeiro, sem texto ou segredo.
Search, embeddings, tráfego e geração têm fontes e orçamentos separados no catálogo.
Não atribuir todos ao orçamento R$600 nem alterar cota de IA das organizações.

## Validação e migração

`node test/eva-search-execution.cjs` usa PGlite descartável e compõe o fixture
de preparação para testar autorizações reais, isolamento, estados, orçamento,
duplicação, lease, quarentena, paginação, histórico e recuperação sem reenvio.
`eva-search-execution.spec.ts` testa transporte desligado, sequência de reservas,
falhas e divergências remotas sem chamadas reais. Rodar regressões, builds e UI.
Migração compartilhada somente após inventário, comparação de ACL/RLS/dados,
dry-run; executar uma vez, sem seeds ou mudanças de registros históricos.
Rollback por flags, sem drop/delete. Índice e RAG permanecem desligados.
