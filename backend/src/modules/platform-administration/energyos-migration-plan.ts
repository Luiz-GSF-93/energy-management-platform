/** Release-controlled facts. Observation windows and SLOs are never inferred from deployment success. */
export const energyosMigrationPlan={
 updatedOn:'2026-11-13',responsible:'Owner / Administrador da Plataforma',
 organizationRole:'Acompanhar a estabilidade da própria organização em modo de consulta.',
 rolloutScope:'Melhorias gerais para organizações com licença ativa, incluindo novas organizações elegíveis.',
 ownerAccess:'Owner possui acesso a todos os módulos; contexto da organização e auditoria permanecem obrigatórios.',
 steps:[
  {id:'A',status:'Recuperação validada',description:'Correção compatível publicada; login e retomada confirmados após recuperação. Estabilidade prolongada depende de B.'},
  {id:'B',status:'Medição em andamento',description:'Logs de memória, CPU, event loop p95/p99 e etapas disponíveis. Janela de 24–72 horas e baseline representativo ainda não concluídos.'},
  {id:'C',status:'Implantada',description:'Preparação manual por intenção assíncrona e HTTP 202 no worker EVA existente, inclusive para o Owner operando uma organização. Contexto revalidado, flags e proteção contra repetição.'},
  {id:'D',status:'Monitoramento em produção / notificações pendentes',description:'Collector e Prometheus privados; Grafana HTTPS com autenticação exclusiva da plataforma. API e worker exportam métricas limitadas. Persistência após reinício validada. Configuração de canais de notificação e observação prolongada ainda pendentes.'},
  {id:'E',status:'Parcial / pendente',description:'Há filas e leases duráveis. Outbox e consumidores de todo o pipeline e ativação gradual de broker ainda pendentes.'},
  {id:'F',status:'Pendente',description:'Testes de falhas e isolamento existentes não substituem ensaio representativo de carga com documentos sintéticos anonimizados.'},
  {id:'G',status:'Não atingida',description:'Saída BETA depende de jornadas, isolamento, ausência de escrita duplicada, recuperação, SLO medido e rollback testado. Não há promessa de ausência absoluta de falhas.'},
 ],
};
