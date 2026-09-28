# F1.118 — Reativos faturados por posto e bandeira explícita

A leitura CPFL já reconhecia reativos, mas o comparativo só aceitava reativo total em kVArh. A integração agora registra quantidades faturadas em kWh por posto separadamente do consumo ativo e do reativo legado em kVArh. O ACR aplica seus parâmetros aprovados às mesmas quantidades físicas.

## Entrega
- Quantidades opcionais reactiveBilledPeakKwh e reactiveBilledOffPeakKwh, compatíveis com versões históricas de sete campos. Ausência não equivale a zero; validação exige ambos os postos e impede mistura com reactiveTotal.
- Extração CPFL requer uma linha por posto, evidência e confiança superior a 85% nos campos essenciais, mesma referência e identidade/consumo conferidos, conciliação da fatura e quantidade × tarifa exata em centavos.
- Integração atômica gera/atualiza rascunho mensal e duas tarifas ACL REACTIVE em R$/MWh, com conversão exata da tarifa original de oito casas. Versões validadas, demandas ACL/ACR e consumos são preservados. IDs de documento/job, hash, revisões, autor e evidências ficam no registro imutável.
- Consultas isoladas por organização; RBAC e licença reaproveitados; RPC somente service_role. Token de prévia, revisão e bloqueios de concorrência impedem sobrescrita/duplicação. Aprovação mensal e de parâmetros continua separada da importação.
- Fórmula tariffs-1.4 suporta REACTIVE em R$/kWh ou R$/MWh por posto e TARIFF_FLAG por consumo validado. Não infere bandeira a partir de rótulo livre OTHER. Nova opção Bandeira tarifária no cadastro permite revisão auditada dos parâmetros existentes, mantendo valores.
- Painel de integração em Acompanhar homologação e Preparar apuração; campos aparecem nos Dados mensais.

## Evidência de cálculo
Ponta: 0,9716 kWh × 0,36023055 R$/kWh = R$ 0,35.
Fora ponta: 121,4116 kWh × 0,37599373 R$/kWh = R$ 45,65.
A tarifa ACR cadastrada não é substituída pela tarifa ACL. Nenhum tributo já embutido é acrescido novamente. Destaques tributários ausentes permanecem não identificados e não são convertidos em zero.

## Validação
246 testes Jest, 24 verificações PostgreSQL/PGlite, 12 verificações da interface da integração e regressões de homologação/dados mensais. Builds de backend e frontend, git diff --check.

## Limites de homologação
A entrega não publica fechamento financeiro. Contrato do fornecedor, bases tributárias atualizadas, revisão dos parâmetros OTHER das bandeiras e demais pendências do diagnóstico precisam ser concluídos. Não classifica todos os layouts como homologados nem altera registros financeiros históricos. A nova migração é aditiva, sem atualizar dados existentes.
