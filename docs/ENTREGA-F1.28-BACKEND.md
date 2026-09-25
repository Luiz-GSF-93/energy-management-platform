# F1.28 — Dados elétricos e condições de fornecimento

Campos adicionais por unidade: subgrupo, classe, Mercado Livre, demandas e tarifas ponta/fora ponta, tarifa reativa e último ajuste. Mantém grupos legados sem conversão automática; ao informar subgrupo, exige grupo A/B compatível. Azul exige as duas demandas.

Contratos: tabela de períodos de até um ano, contínua e cobrindo toda vigência, valores finais ou bases aguardando índice; modos FIXED/INDEXED/MIXED. Índice exige data-base e regra. Garantias com tipo, valor e instituição; Outro exige descrição. Campos editáveis em rascunhos e preservados após ativação. Registros anteriores mantidos. Não aplica índices econômicos automaticamente.

Validação: 624 testes/58 suítes, build backend e 34 verificações isoladas de PostgreSQL/PGlite usando serviços compilados. A fixture antiga recebeu a coluna name já existente nas unidades. Inclui preço por dois anos, garantia, escopo, rejeições de intervalos e preservação após ativar. Testes não enviam dados de produção.
