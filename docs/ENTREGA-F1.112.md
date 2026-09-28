# F1.112 — Integração automática das parcelas OCR

Em Preparar apuração, a memória de demanda passa a oferecer Integrar parcelas e tarifas automaticamente. O backend obtém quantidades, tarifas e valores da evidência atual; o navegador envia somente o token da prévia.

Uma transação grava as parcelas em Dados mensais e duas tarifas brutas ACL R$/kW em Parâmetros de cálculo, com a vigência da competência, autor e origem. Se a versão mensal já estiver validada, cria uma nova versão em rascunho vinculada à anterior; se ainda for um rascunho OCR sem parcelas, acrescenta as parcelas nele. Nenhuma versão validada é sobrescrita. A versão anterior, os eventos e as conferências ficam preservados.

A integração exige identidade, consumo e duas classificações atuais (utilizada/não utilizada), CPFL Paulista ACL Verde, conciliação financeira e confiança elegível. Confere soma e produto decimal no banco. Bloqueia tarifas existentes, revisão desatualizada, mudança de cadastro, unidade/competência incorreta e evidência alterada. Repetições retornam os mesmos registros. Falha parcial desfaz a operação inteira.

Migração 20260927_f1_112_ocr_split_demand.sql: proveniência imutável com RLS, execução exclusiva pelo serviço existente e verificação das conferências novamente na validação mensal e aprovação das tarifas. Não amplia acesso de usuários ou de organizações.

A tela confirma a gravação e exibe a versão de destino. Revisões históricas continuam apenas para consulta e não ganham ações de integração. Dados e parâmetros são rascunhos; aprovação financeira e fechamento não são executados por esta ação. Demanda medida e tratamento de ICMS ausente não são inferidos. Sem novas chamadas Azure.

Testes: serviço com token, autor, contexto, origem alterada, duplicidade e permissões; PostgreSQL/PGlite com transação, rollback, duas tarifas exatas, versão anterior imutável, histórico, bloqueio de validação desatualizada e RLS; interface com sucesso, erro e prevenção de reenvio.
