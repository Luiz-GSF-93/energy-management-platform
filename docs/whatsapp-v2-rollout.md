# Modelos WhatsApp V2

Este ajuste permite usar os modelos com cabeçalho EnergyOS, rodapé Powered by Expert Energy e botão estático de login aprovados pela Meta. Não cria modelos na Meta, não ativa políticas, não concede acesso e não reenvia mensagens antigas.

## Seleção por fluxo

| Fluxo existente | Modelo V2 | Seleção |
|---|---|---|
| Solicitação ao cliente | energyos_solicitacao_cliente_v2 | WHATSAPP_TEMPLATE_VERSION=v2 |
| Agenda ou prazo | energyos_lembrete_prazo_v2 | WHATSAPP_TEMPLATE_VERSION=v2 |
| Adesão ACL aprovada e publicada | energyos_adesao_atualizada_v2 | WHATSAPP_TEMPLATE_VERSION=v2 |
| Relatório disponível | energyos_relatorio_disponivel_v2 | WHATSAPP_REPORT_TEMPLATE |
| Alerta administrativo de custos | energyos_alerta_custos_v2 | WHATSAPP_ALERT_TEMPLATE |

Sem o seletor V2, os avisos continuam nos modelos originais. O relatório aceita apenas os dois nomes EnergyOS explicitamente permitidos; continua exigindo WHATSAPP_REPORT_TEMPLATE_APPROVED=true. O alerta usa seu adaptador existente, com um parâmetro de texto no corpo. Avisos aos clientes só aceitam modelo aprovado em pt_BR, sem parâmetros ou mídia; botão permitido apenas com URL exata https://app.expertenergy.com.br/auth/login e texto Acessar EnergyOS. Duplicidade, paginação ambígua e falha da Meta não concedem aprovação.

## Implantação controlada

1. Concluir testes e revisão do diff; implantar o código compatível antes de alterar variáveis.
2. Conferir os cinco modelos V2 na conta de produção 1079860628232165.
3. Aplicar WHATSAPP_TEMPLATE_VERSION=v2, WHATSAPP_REPORT_TEMPLATE=energyos_relatorio_disponivel_v2 e WHATSAPP_ALERT_TEMPLATE=energyos_alerta_custos_v2. Preservar credenciais, destinatários, flags e políticas existentes.
4. Homologar somente com o administrador que autorizou o teste, sem conteúdo financeiro ou dados de clientes. Aceitação pela API não comprova entrega: conferir evento assinado delivered/read no webhook.
5. Somente após homologação, revisar as políticas de cada fluxo pelos procedimentos existentes. Aprovação de modelo não autoriza destinatários.

Rollback: remover WHATSAPP_TEMPLATE_VERSION ou definir v1; restaurar nomes originais de relatório/alerta. Não requer alteração de banco. A tabela global de status permanece protegida; nenhum acesso de organização ou Portal é acrescentado.

O cadastro de equipe da plataforma e a conciliação de custos por organização exigem uma etapa separada de permissões e leitura dos registros. Não estão implementados neste adaptador.
