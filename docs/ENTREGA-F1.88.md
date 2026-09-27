# F1.88 — Reajuste anual dos honorários e serviços

Aproveita os contratos e planos existentes. Em cada vigência, **Reajuste anual e histórico** permite informar índice contratual, percentual acumulado (ou pendência), referência/fonte, competência de aplicação, antecedência e justificativa.

O servidor calcula o novo valor e registra uma versão imutável com autor. Correções da programação preservam a data; valores já aplicados não são sobrescritos. Índice ainda pendente pode ser confirmado posteriormente com auditoria. Datas usam o primeiro dia da competência, dentro da vigência, com intervalo mínimo anual. Não há proporcionalidade diária.

Honorários: corrige somente o fixo por unidade; mantém o percentual sobre economia consolidada antes dos honorários. Apuração e consolidado usam o valor vigente; índice pendente bloqueia a apuração. Serviços: reajuste disponível para valor mensal e preço por MWh; segue a composição mensal já existente, sem gerar cobranças.

Aviso automático no dashboard, dentro da janela configurada (padrão 30 dias), somente ao usuário ativo explicitamente vinculado ao cliente por exclusive_customer_id. Usuários compartilhados ou sem vínculo não recebem dados de outros clientes. O aviso informa contrato, unidade do valor, índice, referência e valor confirmado ou pendência. Consulta ao abrir o dashboard; não envia email.

A fonte e o percentual do índice são informados e conferidos pelo gestor. Integração automática a séries de índices não faz parte desta entrega. Sem índice confirmado não se inventa um reajuste de zero.

## Validação

840 testes de contratos, 17 verificações SQL com service_role/anon/authenticated, teste DOM de gravação, recibo, valor do servidor, autor e correção; builds backend/frontend.

## Pendências acordadas

Emissão e envio automático de nota fiscal/invoice, forma de pagamento e cobrança automática permanecem para implantação futura. Após esta entrega, retomar homologação OCR da fatura Del Rei.

Lint backend indisponível: repositório sem configuração ESLint. Permissões reais conferidas em produção, incluindo revogação explícita de privilégios herdados de UPDATE/DELETE/TRUNCATE para service_role.
