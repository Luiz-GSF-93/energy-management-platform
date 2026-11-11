# EVA: capacidade e execução separada

O processo atual continua em COMBINED por compatibilidade. As mesmas validações de licença, consentimento, organização, delegação, integridade, lease e resultado incerto permanecem no claim e antes da execução. O agendamento não concede acesso. Aprovação e publicação seguem humanas.

## Proteções imediatas

- No máximo duas atividades automáticas EVA simultâneas por processo.
- Fila vazia aumenta o intervalo até aproximadamente 30 segundos, com pequena dispersão para evitar sincronização. Upload e resolução autorizados despertam o processo combinado em aproximadamente um segundo.
- Falha de infraestrutura aumenta o intervalo de 30 segundos até cinco minutos. Não há replay de escrita: a próxima execução passa novamente pelo claim durável e pelas verificações existentes.
- A contagem do sino de auditoria usa uma consulta específica, autorizada por organização e licença, sem carregar o histórico completo.

## Serviço separado preparado

Mesmo repositório e build do backend. Start command: `npm run start:eva-worker`. Uma réplica. Sem domínio público e sem healthcheck HTTP, pois o processo não abre porta. Somente agendamentos EVA são iniciados; CCEE, avisos, relatórios, auditoria e monitoramento continuam na API. A API usa `ENERGYOS_PROCESS_ROLE=API`; enquanto não houver worker ativo e verificado, manter `COMBINED` para não interromper filas.

O worker importa somente o módulo OCR e os três processadores de envios; não importa o módulo de autenticação e não precisa do segredo de assinatura JWT. As variáveis de integrações devem ser referências privadas existentes, sem copiá-las para documentação ou logs. Habilitar somente integrações necessárias ao OCR/IA. O serviço não pode publicar endpoints nem criar permissões de operadores. Não replicar configurações de organização para ignorar licenças: o banco continua a determinar elegibilidade e limites em cada job. As filas e os leases existentes coordenam as réplicas durante uma troca gradual.

Ativação: implantar primeiro o worker; verificar heartbeat/logs e progresso real de uma tarefa autorizada; só então mudar a API para API. Rollback: devolver API para COMBINED antes de parar o worker. Não apagar filas nem documentos.

Separar o processo não aumenta a capacidade do banco. Medir consultas e recursos do Supabase após a correção; não prometer eliminação de todos os limites nem contratar aumento de plano automaticamente. Referência de configuração inicial a aprovar: uma réplica, limite de 1 GB RAM e 1 vCPU. Custo por uso a conferir no Railway antes de ativar.

A referência privada `CALCULATION_AUTOFILL_ENABLED=${{energy-management-platform.CALCULATION_AUTOFILL_ENABLED}}` é obrigatória quando `EVA_AUTOMATIC_INTAKE_ENABLED=true`. O bootstrap valida essa dependência antes de reivindicar trabalhos. Uma configuração incompleta deve falhar na implantação, preservando a réplica anterior, em vez de arquivar faturas e interromper a preparação financeira. As flags de licença, contrato, fontes, CCEE e aprovação continuam independentes.
