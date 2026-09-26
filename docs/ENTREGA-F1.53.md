# F1.53 — Honorários: fixo por unidade e rateio exclusivamente variável

## Regra confirmada pelo cliente
O fixo contratual é integral por unidade, nunca rateado. No híbrido, o percentual incide sobre a economia consolidada do cliente após os demais custos e antes dos honorários. O fixo não reduz essa base. Somente a parcela variável é distribuída por percentuais por unidade, totalizando exatamente 100%.

Exemplo de regra (não é resultado de produção): duas unidades, fixo de R$ 1.000 por unidade, economia consolidada antes de honorários de R$ 10.000, percentual de 20%, rateio variável 25%/75%: variável de R$ 2.000; honorários por unidade de R$ 1.500/R$ 2.500; total R$ 4.000. A soma do fixo é R$ 2.000.

## Entrega
- Cadastro guiado e cadastro de honorários com rótulos e orientações corrigidos.
- Regra mensal vinculada a contrato, cliente, organização e competência. Confirmação explícita do fixo por unidade evita reinterpretar silenciosamente contratos antigos.
- Modelo fixo não aceita rateio. Híbrido exige todas as unidades do cliente, inclusive participação zero, e soma exata de 100% no variável.
- Confirmação por gestor, administrador da organização ou administrador da plataforma em operação autorizada, além da permissão de atualizar contratos e módulo licenciado.
- Histórico imutável: correção exige versão predecessora atual e justificativa. Concorrência controlada por bloqueio transacional e chave única.
- Conferência mensal apresenta o fixo integral após confirmação, contrato, versão, fonte e acesso à regra da competência.
- Rateio monetário exato em centavos, por maiores restos; empate pelo identificador da unidade. Essa função é exclusiva da parcela variável.

## Limite desta entrega
A parcela variável e o total híbrido continuam pendentes da consolidação dos custos de todas as unidades do cliente. Nenhuma economia isolada de unidade é usada como substituto. Não há cobrança, fechamento ou publicação financeira automática. Valores de perda/economia negativa e exceções contratuais ainda precisam de tratamento explícito quando a consolidação for conectada.

## Banco e validação
Migração: backend/src/database/migrations/20260925_f1_53_management_allocations.sql. Aplicada em 25/09/2026 ao projeto energy-management-production; RLS ativo, trigger de preservação presente, zero regras criadas pela implantação. Identificadores legados de cliente/contrato/unidade são textuais, preservados sem conversão de tabelas existentes.

Validações: 90 testes Jest de memória e conferência; 32 verificações isoladas de banco/serviço, incluindo migração reaplicável, isolamento, permissões e imutabilidade; 18 verificações do cadastro guiado; 11 verificações de interface dos honorários. Builds backend/frontend e lint dos componentes alterados passaram. Nenhum cadastro financeiro de produção foi criado ou aprovado nos testes.

## Teste no navegador
Contratos → selecionar cliente → Honorários da gestão → Regra mensal dos honorários. Selecionar contrato ativo que cubra todo o mês e competência; consultar e configurar. Confirmar fixo por unidade, fonte e, no híbrido, percentuais apenas do variável. Na preparação mensal, conferir a mesma unidade/competência para ver a memória. O rateio zero de uma unidade não reduz o seu fixo.

## Prompt Mestre
Permanece na Fase 4, Faturas e Motor. Próximos passos: consolidar custos por cliente/unidade, integrar variável e economia ACL/ACR, versionar apurações e fluxo de validação/publicação; posteriormente OCR e dashboards conforme a arquitetura. Esta entrega não conclui o motor nem o Prompt Mestre.
