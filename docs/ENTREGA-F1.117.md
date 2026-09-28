# F1.117 — Demanda utilizada e não utilizada no ACR

O cenário ACR passa a aceitar parcelas explícitas de demanda única do grupo A Verde em Dados mensais, no motor tarifário e no gatilho do banco. A soma exata das parcelas deve coincidir com o total faturável; azul e grupo B não são convertidos em demanda única.

Em Dados mensais, a ação “Usar quantidades ACL no ACR (mesmas condições)” prepara as quantidades a partir da última versão validada, apenas na mesma unidade, competência e contexto elétrico e sem referência ACR já existente. A escolha documenta a premissa de iguais condições de demanda, versão e revisão de origem. Não usa valores digitados no rascunho como fonte e não copia tarifas ou tributos ACL. Salvar/validar segue o fluxo versionado com autoria e histórico existente.

Parâmetros de cálculo usa rubricas TUSD — demanda utilizada e TUSD — demanda não utilizada, cenário ACR, R$/kW e todos os postos para Verde. Ambas exigem tarifas aprovadas e cobertura do mês. O motor recusa a combinação das parcelas com demanda total, a ausência de contraparte e versões mensais não validadas. Mantém tratamento e códigos de tributos por rubrica; valores brutos não recebem tributos novamente.

Migração: 20260928_f1_117_acr_split_demand.sql, aplicada em produção. Não altera registros históricos, permissões, RLS, valores ou status de aprovação.

Validação: 344 testes Jest; 96 verificações isoladas PGlite/serviço (inclusive auditoria, imutabilidade e isolamento); 26 verificações DOM/reaproveitamento. Compilações backend/frontend.

A conclusão financeira da Del Rei ainda exige tarifas e tratamento tributário ACR e contrato de fornecedor válidos. Esta entrega não presume esses valores nem fecha a competência.
