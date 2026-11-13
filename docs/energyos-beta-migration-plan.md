# EnergyOS — plano de migração sem parada planejada

Atualização: 13/11/2026. Produto em BETA. Esta tabela registra evidências; deploy concluído não comprova SLO nem estabilidade prolongada.

## Responsabilidade e alcance

O Owner / Administrador da Plataforma é responsável pelo acompanhamento global e pelos ajustes gerais. O Owner possui acesso a todos os módulos; o monitor não exige uma licença da própria plataforma. As operações continuam identificadas por organização e auditadas. Os demais perfis conservam suas permissões.

As organizações acompanham a própria estabilidade em modo de consulta. Os ajustes gerais alcançam organizações com licença ativa, incluindo novas organizações que se tornem elegíveis. Isso não autoriza aprovação financeira automática, alteração de licenças por administradores de organização ou repetição de efeitos com resultado incerto.

O painel do Owner lista somente organizações não excluídas com licença ativa dentro da vigência. Contabiliza separadamente fila manual, resultado incerto, documentos em processamento, decisão humana, fontes financeiras pendentes e recibos de fechamento antigos sem lease ativo correspondente. Não há conteúdo OCR ou valores financeiros nessa visão agregada. O detalhamento dos módulos permanece nos ambientes correspondentes.

## Status A–G após esta entrega

| Etapa | Estado | Evidência e trabalho restante |
| --- | --- | --- |
| A — Auth e correção compatível | Recuperação imediata validada | Sessão preservada durante falhas, login e retomada demonstrados. Small 2 GB aplicado com autorização; banco e Auth recuperados. Página pública `/status` permite verificar disponibilidade sem login. Estabilidade prolongada depende de B. |
| B — observar 24–72 horas | Em andamento; janela não concluída | Logs limitados de CPU, memória, event loop p95/p99 e etapas; visão de backlog por organização. A janela deve registrar versões/deploys e reinícios. Ainda faltam baseline completo, falhas externas correlacionadas e evidência de 24–72 horas. Percentis de event loop não são percentis de duração de fechamento. |
| C — preparação manual assíncrona | Implantada | Intenção durável com HTTP 202 e protocolo no worker EVA existente. Sem duplicação de worker. Flags mantêm o caminho legado desligado/ligado conforme rollout; clientes antigos recebem orientação para atualizar quando o modo assíncrono está ativo. Recibos incertos não provocam nova execução automática. Migração `20261315` e PRs 636–640 com testes correspondentes; histórico CCEE serializado na PR 641. |
| D — Collector/Prometheus/Grafana | Validação isolada aprovada / produção pendente | Stack isolado e exportador privado com limites, kill switch, testes de falha/recuperação e canários de privacidade. Exportação em produção permanece desativada. Alertas externos permanentes ainda não habilitados. Ver `energyos-observability-isolated.md`. Nenhuma assinatura adicional foi criada nesta entrega. |
| E — outbox/consumidores/broker | Parcial / pendente | Filas PostgreSQL, leases e trilhas duráveis existentes. Outbox e consumidores por todas as etapas, broker gradual e comparação sem dupla gravação/OCR ainda pendentes. |
| F — carga e falhas | Pendente | Testes descartáveis cobrem isolamento, permissões, perda de resposta, limites e duplicação. Ainda falta ensaio representativo de carga com documentos sintéticos anonimizados, rede, Auth, reinício de worker e reordenação. |
| G — saída BETA | Não atingida | Exige jornadas e isolamento aprovados, ausência de escrita financeira duplicada, recuperação demonstrada, SLO medido e rollback testado. Não é tecnicamente correto prometer ausência absoluta de falhas. |

## Evidências da etapa atual

A preparação comercial abria seis meses × dois escopos de histórico CCEE em paralelo a cada conferência. A leitura agora segue a mesma ordem e escopo, uma requisição por vez, com prazo de transporte e sem cache entre preparações. `CCEE_HISTORY_READ` mede duração e falhas em agregado sem identificadores.

Uma medição somente de tamanhos de um snapshot preservado encontrou cerca de 7,88 MB de fontes financeiras, dos quais 7,68 MB eram resultados OCR, contra cerca de 53 KB de biblioteca tarifária. Não atribuir o volume principal à biblioteca com base nessa amostra. A redução futura de evidências precisa de referências imutáveis e testes de equivalência; não remover comprovação financeira para ganhar desempenho.

## Pendências financeiras preservadas

A execução comercial da Cerealista em maio/2026 tem nove recibos de rascunho gravado e uma etapa sem confirmação. Houve alteração de fontes desde a reserva. A recuperação que exige ausência de gravação não é aplicável: conciliar os efeitos existentes antes de avançar. O rascunho legado da Cerealista em abril/2026 também exige conferência específica do recibo PREPARING. Estes casos não autorizam apagar históricos, repetir todas as gravações ou publicar valores incompletos.

## Rollout e reversão

A migração do monitor é aditiva e somente de leitura para os usuários; não muda licenças, funções, documentos ou cálculos. API e frontend podem ser revertidos sem eliminar filas e trilhas. Se for necessário conter processamento, interromper novas intenções e drenar/reconciliar as existentes antes de desligar coordenação. O Small de 2 GB deve permanecer enquanto se mede capacidade; não reduzir recursos durante tarefas ativas sem avaliação.

A visão de estabilidade atualiza enquanto a página está aberta e conectada. A página pública expõe somente disponibilidade sanitizada de banco e Auth. Alertas externos permanentes permanecem na etapa D. O Owner responde pela operação contínua; esta entrega não cria envio automático de mensagens a terceiros.

## Separação dos disparos de publicação

API e worker usam o diretório de origem `/backend`. A lista versionada em `railway.json` é a referência dos padrões, aplicada explicitamente ao campo `watchPatterns` de cada serviço pela API oficial do Railway. Não depender do carregamento automático desse arquivo: a configuração efetiva deve ser consultada no serviço. Alterações apenas em `frontend/` ou `docs/` devem preservar as instâncias. Incluir novos diretórios compartilhados nos padrões se a arquitetura passar a depender de arquivos fora de `/backend`.

A configuração mantém os comandos e variáveis próprios de cada serviço. Não altera recursos, réplicas, chaves, rede, permissões ou cálculos. Evitar reinícios desnecessários não substitui os testes de drenagem, reordenação, rollback e falhas previstos em F e G.

Referência: [watch paths do Railway](https://docs.railway.com/builds/build-configuration). Os padrões partem da raiz do repositório mesmo quando há Root Directory definido.

## Continuidade BETA 20261113.9

O scheduler retoma backlog ativo após um segundo e acorda pollers bloqueados quando libera capacidade, mantendo a admissão global padrão de uma tarefa. Fila vazia e falhas mantêm backoff; nenhum recibo financeiro é repetido por essa alteração. Isto reduz espera artificial entre tarefas, não o tempo computacional do OCR/IA nem garante um prazo total de fechamento.

As etapas ganham histogramas cumulativos com buckets fixos, sem guardar durações individuais. A exportação OTLP é opt-in, privada, sem espera na rotina de negócio, sem fila de reenvio e com prazo de dois segundos. A etapa D passa a ter stack de validação isolada; habilitação em produção e operação contínua continuam pendentes. A janela B deve registrar esta nova versão e permanecer aberta até completar o baseline representativo.

## Evidências de continuidade

PR #644: oito checks aprovados, 59 testes direcionados, build do backend, regressões de filas e permissões e builds limpos do frontend. O stack real isolado verificou histograma de 10.000 operações CPU sintéticas, dashboard provisionado, ausência dos canários de privacidade e queda/recuperação do Collector sem bloquear o trabalho sintético. Isso não é ensaio de 10.000 documentos nem teste financeiro representativo. A exportação em produção permanece desativada.

O recorte anterior à release .9 abrangeu 218 amostras de API e 215 de worker, cerca de 3h37/3h34. Não completa a etapa B. A admissão padrão de uma tarefa foi mantida; a espera por capacidade usa ordem de chegada entre pollers. Resultados financeiros incertos continuam exigindo reconciliação, sem reset ou replay.

A aplicação dos padrões de deploy conferiu que os demais comandos, diretório de origem e configurações do ambiente permaneceram iguais. A lista deve persistir como configuração do serviço, pois o CLI oficial anunciou depreciação de Config as Code em favor de IaC, com suporte aos arquivos antigos até 01/12/2026. Esta entrega não executa uma migração indiscriminada de IaC de todo o projeto.

## Continuidade BETA 20261113.10 — Owner na fila durável

A operação explícita do Owner em uma organização passa pelo mesmo protocolo assíncrono HTTP 202; deixa de executar a preparação pesada na requisição web. O contexto fica vinculado ao job e é revalidado no worker com a identidade Owner existente, usuário ativo, sessão de operação, unidade e licença. Não cria vínculo interno nem amplia permissões de operadores, gestores ou administradores de organização. O modo de membro continua sujeito ao limite individual, mesmo quando o mesmo usuário também é Owner.

A migração 20261319 é aditiva e preserva o RPC antigo como contexto de membro para instâncias anteriores. A auditoria distingue a origem da plataforma. Revogação, bloqueio, exclusão, ambiguidade do perfil global ou expiração da sessão impedem a execução delegada. Resultados incertos e efeitos financeiros continuam exigindo reconciliação; o Owner não ganha um caminho para ignorar esses recibos. Diagnósticos conhecidos de timeout registram somente códigos fixos de etapa, sem texto bruto de erro, documento ou credencial.

Testes SQL descartáveis usam a função Owner real e as migrações existentes, verificam 100 entregas repetidas do mesmo protocolo sem duplicar a intenção, compatibilidade de membros, sessão/licença, revogação, auditoria e preservação de incerteza. Não equivalem a carga de documentos/OCR/IA nem encerram F ou G.
