# Primeira etapa de robustez: linha de base do processo

Entrega BETA 0.1.0-beta.20261112.3. Esta etapa inicia a medição do plano de
reestruturação; não representa a conclusão das fases de arquitetura e dashboards.

## Escopo e privacidade

`RuntimeObservabilityService` pertence ao CommonModule compartilhado por API e
worker privado. A cada 60 segundos, emite `ENERGYOS_RUNTIME_SAMPLE` nos logs
privados existentes do Railway: papel do processo, janela, uptime, CPU, memória,
atraso p95/p99/máximo do event loop e pressão local dos pollers EVA.

CPU é calculada pelo delta de user+system durante a janela; 100% corresponde a
um núcleo e pode ultrapassar 100% com múltiplas threads. O atraso é amostrado com
resolução de 20 ms e inclui a resolução do timer; não equivale à latência HTTP.
Histograma sem amostras produz null. Os contadores de pollers não são backlog de
documentos; backlog, idade e estados vêm do painel operacional durável existente.

API/COMBINED também registram `ENERGYOS_DEPENDENCY_SAMPLE` com banco/Auth
up/down/unknown, reutilizando as sondagens limitadas e cacheadas da readiness.
Timeout do observador é 4 segundos; unknown significa não confirmado. O worker
privado não consulta Auth para gerar telemetria.

Nenhum ID de cliente, organização, usuário, documento, nome de arquivo, CNPJ,
conteúdo, URL, cabeçalho, segredo ou texto bruto de exceção é emitido. O monitor
não oferece endpoint HTTP, não exporta dados a outro serviço, não grava no banco
e não altera estados da fila nem cálculos financeiros. As métricas de recursos
do painel de custos existentes permanecem independentes.

## Limites e reversão

- Um histograma de memória limitada, reiniciado a cada janela; sem arrays de
  amostras acumuladas, filas de exportação ou arquivos temporários.
- Um ciclo por processo, sem sobreposição; timer unref e descarte no shutdown.
- Falha de coleta, logger ou dependência não rejeita trabalho de aplicação.
- `ENERGYOS_RUNTIME_OBSERVABILITY_ENABLED=false` desliga esta coleta no próximo
  início do processo. Ausente/true habilita; outros valores explícitos desligam.
- API passa a executar hooks de encerramento gracioso já utilizados pelo worker.
- Reverter a entrega restaura o código anterior; não há migração de schema.

O custo não é zero: inclui amostragem local, até dois eventos por minuto/API,
um por minuto/worker e sondagens de dependências na API. Comparar RSS/CPU e
latência antes/depois; desativar caso haja regressão sustentada. Logs podem ser
descartados pela infraestrutura; esta fase não constitui armazenamento de SLA.

## Retaguarda e critérios de avanço

Coletar uma linha de base de 24–72 horas em BETA, cobrindo envios e fila real.
Separar disponibilidade de Auth/banco, CPU/RSS/event loop da API e do worker,
backlog/idade/tentativas e pendências humanas. Uma justificativa de documento
não corrige indisponibilidade de infraestrutura.

Investigar p99 de event loop sustentado acima de 200 ms, crescimento de RSS e
CPU elevada junto com aumento da idade da fila; são limites iniciais de triagem,
não SLOs contratados nem prova isolada de saturação. Confirmar com os gráficos
de recursos do Railway e métricas de container do painel existente.

No incidente: consultar readiness e logs de dependências; verificar Supabase,
worker e últimos eventos do protocolo. Conferir o histórico antes de repetir
escritas incertas. Não reenviar OCR concluído nem aprovar valores para resolver
um timeout. Verificar login completo e documento retomado após a recuperação.

Próxima etapa: instrumentar por estágio e consolidar painel operacional com
ações seguras; depois testar preparação manual assíncrona com rollout e retorno
compatível. OpenTelemetry/Collector/Prometheus/Grafana, alertas externos e broker
permanecem no plano; não foram instalados por esta entrega. Não existe alerta
automático externo nem medição histórica de 24–72h concluída nesta etapa.

Referência: https://nodejs.org/api/perf_hooks.html#perf_hooksmonitoreventloopdelayoptions
