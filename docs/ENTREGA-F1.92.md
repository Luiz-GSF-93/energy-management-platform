# F1.92 — Pendências específicas de demanda medida e reativo

Acompanhar homologação agora consulta automaticamente o quadro de medição, o histórico da mesma competência e as unidades das cobranças de reativo, junto à versão mensal atual. A leitura não grava dados nem escolhe um valor entre representações arredondadas. A consulta exige o mesmo acesso e licenças de documentos/contratos, com organização, unidade e competência vinculadas no servidor.

Na Del Rei agosto/2026, o quadro apresenta 203/235 kW e o histórico 202/234 kW. A interface identifica essa diferença sem declarar erro de faturamento nem usar as parcelas de demanda faturada como medição. As cobranças USD Consumo Reativo aparecem em kWh; o destino mensal espera energia reativa excedente em kVArh. Não há conversão automática entre grandezas. Demanda contratada, faturável, medida e histórico permanecem distintos.

Para tratar exceções, o complemento ou a correção manual de um rascunho OCR passa a exigir justificativa no backend e no formulário. A justificativa é limpa ao abrir nova edição, evitando reutilização silenciosa do texto anterior; o salvamento continua usando controle de revisão e auditoria com autor. Registros validados permanecem imutáveis. A origem apresentada informa que o registro foi iniciado por OCR e que complementos devem ser consultados no histórico.

Sem migração de banco e sem novas chamadas Azure. Testes cobrem divergência de representações, período, fonte ausente, duplicidade, zero explícito, unidades incompatíveis, preservação dos valores registrados, permissões e justificativa de edição. Não foram confirmadas medições nem aprovados resultados financeiros pelo agente. Integração de tarifas, custos, tributos e preparação final permanece pendente.

Validação concluída: 1.450 testes em 60 suítes de OCR/contratos, testes DOM do painel e da homologação, builds backend/frontend e git diff --check.
