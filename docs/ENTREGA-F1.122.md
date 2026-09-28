# F1.122 — Conciliação auditada da compra pontual

Fornecedor Mercado Livre → Conciliar compra pontual. A conciliação requer condições SPOT, medição validada e uma nota validada em Custos mensais cujo valor corresponda à quantidade comprada × preço final. O consumo OCR nunca é sobrescrito.

Uma revisão registra documento privado verificado da mesma organização/cliente/unidade/competência, justificativa, autor autenticado, data e versão imutável. PENDING mantém ou reabre a pendência. APPROVED_NO_COST confirma, sob revisão do gestor, que o documento explica integralmente a diferença sem cobrança ou crédito adicional. Havendo custo, outra compra ou correção, ajustar primeiro as fontes; esta entrega não presume uma operação financeira nem aceita tolerância implícita.

O cálculo verifica hash das fontes validadas e do documento. Uma revisão mais nova ou alteração de fontes invalida a aprovação anterior. Demais bloqueios continuam ativos. O valor da nota é alocado entre postos proporcionalmente ao consumo, conservando centavos; quantidade comprada, consumo e diferença são mostrados separadamente. A conciliação é capturada nas revisões da apuração e nas referências tributárias operacionais.

Segurança: ambas as permissões de contratos e documentos, licença de documentos e mercado livre, papel gestor/admin para escrita, tenant no servidor, documento contextual, CAS por predecessor, trava de concorrência no banco, RLS e somente SELECT/INSERT para service_role. Sem alteração de registros financeiros existentes.

Migração: backend/src/database/migrations/20260928_f1_122_spot_reconciliation.sql. Aplicar antes do backend.

Validação: backend build; 135 testes Jest de motor/conciliação/fontes/revisões; 24 verificações PGlite de serviço/banco (incluindo migração repetível e bloqueios de acesso/alteração); frontend build; 13 verificações DOM de conciliação e 33 regressões de notas/faturamento.

Del Rei agosto/2026: permanece pendente de comprovação dos 0,0882 MWh. A implantação não declara encerrado o custo nem aprova a diferença sem documento. Também depende de registrar/validar a nota em custos mensais e confirmar as condições documentadas do preço.
