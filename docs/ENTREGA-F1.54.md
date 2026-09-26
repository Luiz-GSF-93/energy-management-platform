# F1.54 — Energia ACL por contrato, take-or-pay e compra extra

## Comportamento

O custo regular do fornecedor passa a ser calculado pelo volume da competência e pelo preço contratual vigente. A NF regular é evidência de conciliação, sem somar o mesmo custo novamente. Esta etapa integra o componente do fornecedor à comparação preliminar; não publica uma apuração financeira completa.

- Mínimo = volume contratado no mês × percentual mínimo / 100.
- Máximo = volume contratado no mês × (100 + tolerância superior) / 100.
- Volume regular faturável = máximo(mínimo, mínimo(consumo medido, máximo)).
- Compra extra = máximo(0, consumo medido − máximo).
- Contrato 100 MWh, mínimo 70%, tolerância 30%: 60 MWh faturam 70; 120 faturam 120; 140 faturam 130 e exigem valor de compra extra de 10 MWh.
- O preço vigente é o mesmo para ponta e fora ponta. A cobertura contratual é distribuída proporcionalmente aos volumes medidos; mínimo não consumido e compra extra aparecem separados.
- Volume mensal explícito ou distribuição sazonal anual/mensal. Não existe divisão automática do volume contratual por 12.
- Preço final vigente ou preço-base mais índice acumulado documentado. Preço final não recebe índice novamente. Índices não são buscados externamente.
- Campos de condição usam vigência e histórico imutável. Uma nova versão exige motivo e predecessor atual. Não se convertem percentuais legados automaticamente.

## Operação

Em Contratos → cliente → Fornecedor Mercado Livre, abra Faturamento automático / take-or-pay em um contrato ativo/aprovado. Gestor ou Administrador confirma volume, mínimo, tolerância superior, preço, tratamento tributário e fonte. O acesso operacional do administrador da plataforma também é permitido.

No comparativo, a coluna ACL das rubricas Energia (TE) recebe os valores do contrato. O card Fornecedor detalha os volumes, mínimo, compra extra e eventual divergência da NF. Links levam às correções. Compra extra sem valor validado deixa o total do fornecedor pendente.

Ao abrir Fornecedor, a plataforma verifica o último ciclo encerrado no fuso America/Sao_Paulo e solicita registro/validação do volume pendente. É um aviso na aplicação ao consultar essa área, sem envio agendado de e-mail.

## Integridade e limites

- Organização, cliente, unidade e licença verificados no backend; fonte e validação preservadas.
- Nova tabela supplier_billing_rules: RLS ativa, sem acesso anon/authenticated; serviço lê/insere, não atualiza nem exclui. Trigger preserva versões e contexto contratual.
- Migração aditiva: não altera contratos ou valores empresariais existentes.
- Mês aberto, sobreposição de contratos/preços, vigência parcial, reajuste sem fonte, medição em rascunho, compra extra não conciliada e tratamentos tributários incompatíveis impedem confirmação do componente.
- A TE ACL manual deixa de compor o subtotal da distribuidora. Referências tributárias antigas dependentes dessa TE não são substituídas silenciosamente; ficam pendentes de revisão na memória tributária.
- O cálculo é determinístico no backend com coeficientes inteiros e arredondamento monetário. Frontend apresenta valores retornados, sem recalcular totais.
- Custo total ACL/ACR, bases tributárias do fornecedor, economia líquida consolidada, honorários variáveis e publicação versionada geral permanecem na sequência da Fase 4 do Prompt Mestre. Esta entrega não afirma concluir essas partes.

## Validação

Builds backend/frontend aprovados. 39 testes de cálculo e limites; regressão dos serviços de contratos, incluindo 51 verificações da preparação; 31 verificações isoladas de banco/serviço (migração idempotente, versão, isolamento e permissões); 11 verificações de interface. ESLint dos componentes alterados aprovado. Banco de teste PGlite em backend/test/database; não cria dados empresariais em produção.

## Teste no navegador

1. Confirme condições de um contrato ativo/aprovado, com a fonte real e vigência correta.
2. Registre e valide consumo total, ponta e fora ponta na competência.
3. Em Preparar apuração, confira unidade/mês e veja Energia (TE) na coluna ACL e o card Fornecedor.
4. Consumo acima do máximo: registre/valide a compra extra em Custos mensais e confira novamente.
5. Uma NF regular divergente gera pendência de conciliação; não é somada ao custo contratual.
