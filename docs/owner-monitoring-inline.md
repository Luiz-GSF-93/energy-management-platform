# Monitoramento na tela inicial do Owner — 16/11/2026

O dashboard inicial do Owner mostra memória, CPU e p99 de event loop da API e do
worker EVA, com gráficos dos últimos 30 minutos. A página Estabilidade EnergyOS
compartilha a mesma apresentação e mantém a fila por organização. O link para o
Grafana completo permanece disponível com o login técnico existente.

Os indicadores dentro do EnergyOS usam a sessão atual do Owner. O GET existente
de estabilidade valida novamente o Owner ativo pela RPC estabelecida antes de
consultar qualquer métrica, inclusive dados em cache. A tela não recebe URLs
privadas, credenciais, etiquetas do provedor ou identificadores de processos.
Não há login anônimo, iframe ou compartilhamento da senha do Grafana.

A API usa somente um endereço privado fixo do Prometheus e uma consulta de leitura
com quatro métricas permitidas. Janela de 30 minutos, passo de um minuto, máximo
de 32 séries e 256 KiB de resposta. Timeout global de dois segundos, timeout de
consulta de um segundo, uma consulta simultânea e cache/cooldown de 30 segundos.
A consulta exige ENERGYOS_OWNER_MONITORING_ENABLED=true explicitamente na API; ausente ou false a desativa. Redirecionamentos
e transmissão de credenciais são proibidos. Falha de telemetria preserva a consulta
das organizações e não interfere no preenchimento ou aprovação financeira.

A escolha do processo usa a amostra mais recente por papel e mantém as métricas
da mesma instância. Dados ausentes não viram zero; amostras antigas continuam
identificadas, inclusive quando a resposta usa cache. Métrica recente não é uma
prova independente de disponibilidade do Auth ou de conclusão de uma fatura.

O frontend faz somente GET, com atualização enquanto a página está visível e
conectada. Troca de usuário/escopo e revogação eliminam os dados apresentados.
O detalhe da estabilidade reutiliza a consulta existente, sem um segundo poller
para o gráfico. A atualização de versão é BETA 0.1.0-beta.20261116.1.

Sem novas tabelas, serviços pagos, credenciais ou permissões. Rollback consiste
em reverter os arquivos e republicar API/frontend, preservando a base e os volumes.
Compatibilidade: frontend novo aceita ausência de métricas de uma API anterior;
frontend anterior ignora o campo novo. Worker e rotinas financeiras permanecem.

Validação: fronteiras de Owner, organização e revogação; seleção coerente de
instância; privacidade; corpo/tempo/cardinalidade limitados; ausência de credenciais
e redirects; cache, concorrência, indisponibilidade, dados antigos e faltantes;
UI com gráficos e limpeza após revogação; testes anteriores de filas e continuação.
Não representa conclusão da janela BETA ou garantia de ausência absoluta de falhas.
