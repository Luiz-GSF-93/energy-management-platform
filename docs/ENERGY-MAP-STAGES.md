# Mapa energético: entregas e pendências

Checkpoint de 5 de outubro de 2026. “Parcial” não equivale a etapa concluída.

| Etapa | Entregue | Pendente para aceite da etapa |
| --- | --- | --- |
| 2 | Adapter Mapbox permanente; endereço cadastral canônico; orçamento persistido; sugestão privada e confirmação humana auditada. Este incremento acrescenta fila PostgreSQL e worker independente da requisição HTTP, com acompanhamento GET limitado. | Handoff explícito do endereço OCR revisado ao cadastro, com origem, vínculo documento/unidade, controle de versão, justificativa e invalidação da localização anterior. Validar operação real do worker após implantação. |
| 3 | Existe publicação financeira em módulo separado; não constitui integração com o mapa. | Consumir somente indicadores validados/publicados; alertas com evidências e regras verificáveis; portal do cliente limitado à sua organização e unidades autorizadas. |
| 4 | Densidade de pontos confirmados; resumo por UF e perfis da página autorizada. | Agregações comerciais com autorização específica, consulta por raio e score com metodologia, fontes, versão e tratamento explícito de dados ausentes. |

## Fila de geocodificação (incremento da etapa 2)

Aplicar `20261005_f13_energy_map_geocoding_worker.sql` antes do backend. Mantém a API de despacho antiga para compatibilidade durante a implantação. Não altera endereços, localizações ou solicitações anteriores.

O POST admite uma solicitação QUEUED idempotente por organização/unidade/hash de endereço. O orçamento fixo é 10 admissões por organização/dia e 100 no total/mês; o contador conservador inclui falhas. O worker NestJS consulta a fila a cada cinco segundos, um job por tick, apenas na interseção das flags ENERGY_MAP_ORGANIZATIONS e ENERGY_MAP_GEOCODING_ORGANIZATIONS, com provider permanente configurado. Nenhum novo token ou serviço Redis é necessário.

Uma transação privada revalida licença, vínculo, permissão de escrita, cliente ativo, endereço e revisão atuais. Serializa admissão/despacho entre réplicas, trava unidade antes do job e grava PROCESSING com lease antes de liberar o endereço ao adapter. Solicitações vencidas há 24 horas falham sem chamada. Mudanças cadastrais tornam a solicitação STALE; acesso revogado a torna FAILED.

Somente endereço/cidade/UF vão à Mapbox. Resultado é REVIEW, nunca publicação automática. Um crash após reservar despacho pode gerar OUTCOME_UNKNOWN: não existe reenvio automático, evitando cobrança duplicada. Um operador deve investigar o histórico; não apagar nem reabrir silenciosamente o job. Falha ao persistir resultado também não repete a consulta externa.

O frontend consulta apenas GET por até 12 ciclos de cinco segundos; cancela ao desmontar ou trocar unidade/organização/endereço. Nenhum polling envia POST ou confirma coordenadas. Ao terminar o período, o usuário pode atualizar a unidade para conferir o resultado.

Testes: worker sem configuração/fora do piloto, resposta cruzada, falha/timeout, conclusão recusada, ticks concorrentes, shutdown; banco com idempotência, orçamento, lease, revogação, endereço alterado, licença, expiração e acesso RPC; UI com QUEUED/PROCESSING/REVIEW, cancelamento e limite de polling. Não executar chamadas pagas nem confirmar localizações durante testes automatizados.
