# F1.97 — CDE escassez hídrica por posto

Integração dedicada no painel de homologação: mostra descrição e confiança, quantidade, tarifa bruta, valor e ICMS/PIS/Cofins destacados. Somente cria dois rascunhos ACL quando identidade e consumos estão conferidos, competência e totais conciliados, campos com evidência confiável, quantidades iguais aos consumos conferidos e quantidade × tarifa igual ao valor impresso em centavos.

Conversão exata R$/kWh para R$/MWh mantém oito casas da origem. IDs determinísticos, lote atômico, token de prévia, bloqueio de parâmetros existentes, origem/documento/hash, autor e auditoria. Não substitui registros nem aprova automaticamente.

Motor de prévia passa a reconhecer CDE_WATER_SCARCITY, usando o consumo do posto; tributos GROSS preservados sem nova adição. Continua exigindo medições e parâmetros aprovados. Conciliação tributária e subtotal final permanecem sujeitos às bases completas.

Del Rei agosto/2026: R$ 57,19 na ponta e R$ 501,34 fora ponta. Descrições têm confiança de transcrição de 29,9% e 24,6%; por isso a integração permanece bloqueada para revisão, sem mascarar incerteza com números de alta confiança. Nenhum rascunho CDE criado automaticamente nesta fatura.

Testes: builds backend/frontend, 146 testes de integração/motor/subtotal e teste DOM. Casos reais reproduzem valores exatos, baixa confiança bloqueia, quantidade divergente bloqueia e repetição não duplica. Nenhuma migração de banco nesta etapa.
