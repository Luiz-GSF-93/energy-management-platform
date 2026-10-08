# CCEE: camadas, dados privados e avisos Bot-Energy

Fluxo obrigatório: **CCEE Integration Service → Normalizer → Validation → Calculation Engine**. A interface recebe prévias, fontes, pendências e resultados; não interpreta SOAP nem implementa tarifas, perdas, impostos ou regras CCEE.

## PLD

`CceeService` consulta o fornecedor por TLS validado. O adaptador normaliza preços horários; a validação exige mês encerrado, quatro submercados, cobertura horária completa e valores não negativos. O motor neutro `calculateMonthlyMarketReference` calcula a média aritmética horária em R$/MWh, sem tributos.

A publicação exige permissão global de alteração de organizações, prévia conferida e nova consulta do backend. O digest cobre os valores normalizados; mudanças bloqueiam a publicação. `ccee_publish_pld_month` verifica novamente autorização, licença, proveniência, cobertura e vínculo, grava quatro submercados atomicamente e preserva a publicação. Repetições equivalentes são idempotentes. Uma correção de mês publicado exige um fluxo explícito de revisão futuro; este conector não sobrescreve preços. O leitor existente `energy_price_read` entrega somente o PLD da organização autorizada ao Dashboard e Portal.

## Estrutura de dados privados

Os contratos normalizados cobrem consumo, encargos, taxas, créditos, MCP, agenda e outras informações. Toda evidência conserva serviço, ID externo, revisão, competência, momento de coleta, hash e natureza provisória/final. Todo registro privado exige organização, cliente, unidade, perfil, ponto de medição e autorização versionada. Créditos conservam a direção CREDIT; valores ausentes não viram zero. Dados provisórios e tributação desconhecida permanecem pendentes.

`ccee_unit_authorizations` e `ccee_normalized_intake` são a fundação de armazenamento privado com RLS, vínculo confirmado entre organização/cliente/unidade, autorização revisada e bloqueio de versão revogada/superada. O intake é imutável e idempotente pela identidade da fonte. As tabelas não concedem acesso direto a anon, authenticated ou service_role. **Não há endpoint público de preenchimento desse intake nesta etapa.** As rotas de autorização e ingestão só serão habilitadas junto aos adaptadores reais, após confirmar representação e permissões.

`cceeCalculationDraft` encaminha dados finalizados a DTOs dos módulos mensais existentes, sem outro motor financeiro. Custos líquidos aguardam resolução tributária; o adaptador aceita custos brutos confirmados. Medições sem informação de perdas não são inferidas nem substituem automaticamente medições faturadas. A revisão concilia a fonte com documentos manuais e mantém versões anteriores. Agenda segue uma rota operacional própria, nunca o motor financeiro.

## Bot-Energy e fechamento mensal

`cceeAgendaDrafts` prepara agendas com cliente, unidade, competência, responsável, prazo, fonte e request id estável. O adaptador não publica nem salva automaticamente: a escrita deve passar por `OperationsService.save`, que verifica RBAC, plano, vínculo e autoria.

O endpoint `GET /api/v1/documents/bot-energy/agenda` usa o leitor autorizado da agenda existente e exige perfil backoffice, permissões de agenda/clientes/unidades e direito `free_market_management` da licença ativa. Consulta global, Portal e perfis de cliente são recusados. O Bot-Energy mostra lembretes internos para agendas abertas vinculadas a cliente e unidade: até sete dias antes, proximidade de três/um dia, hoje e vencidos há até trinta dias. Usa o prazo final cadastrado, mesmo quando o início da atividade pertence a outro mês. DONE/CANCELLED deixam de produzir avisos. A consulta falha explicitamente se a cobertura ultrapassar o limite do leitor; não apresenta uma lista parcial como completa.

O componente renova a consulta a cada cinco minutos e após alterações operacionais. Trocar organização, usuário ou permissões desmonta o contexto anterior; uma resposta de outra organização é rejeitada. O aviso não conclui fechamento, não comprova ausência de penalidade e não envia e-mail, WhatsApp ou SMS. Esses canais exigem o fluxo de despacho autorizado e destinatários conferidos; não foram ativados por esta consulta.

**Agenda oficial automática ainda depende da confirmação do serviço/adaptador e da aplicabilidade das obrigações às unidades.** Não presumir calendário por PLD, criar prazos genéricos mensais ou tratar eventos de webhook como calendário. Enquanto isso, os lembretes se baseiam na agenda registrada e identificam essa origem.

## Evidência real e limites

Em 08/10/2026, o backend de produção confirmou autenticação/perfil e a prévia de agosto/2026 com 744 horas por submercado: SE/CO 128,117500; Sul 128,100309; Nordeste 125,269919; Norte 126,702352 R$/MWh, sem tributos. Essa consulta não comprova acesso aos dados privados dos clientes nem publicação no banco.

Fontes: [Plataforma de Integração CCEE](https://www.ccee.org.br/documentos/plataforma-de-integracao), [coleções oficiais](https://github.com/devccee/postman-collections), [eventos e webhook oficiais](https://github.com/devccee/webhook). Seguir também `ARQUITETURA-CENARIOS-ACL-ACR.md` e o leitor existente documentado em `energy-price-dashboard.md`.
