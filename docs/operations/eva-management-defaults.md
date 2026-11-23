# Honorários recorrentes na preparação EVA

O administrador/gestor pode confirmar uma regra mensal como padrão recorrente do contrato. Somente regras explicitamente marcadas serão usadas nas competências posteriores; regras antigas não são promovidas automaticamente. O padrão mantém a base (por unidade ou consolidada com rateio). Valores e percentual continuam vindo do contrato vigente.

A preparação autorizada materializa uma versão mensal imutável, com origem e operador registrados. Exceção mensal explícita prevalece. Contrato deve cobrir o mês completo; duplicidade de vigências e rateio incompatível exigem revisão. Fechamentos aprovados e suas fontes são preservados. Isso não aprova, publica ou cobra valores.

Implantação: aplicar 20261352_management_fee_defaults.sql; publicar API, worker e frontend; habilitar EVA_MANAGEMENT_DEFAULTS_ENABLED=true na API e worker. Confirmar o padrão na tela de honorários e testar uma competência posterior. Recuo: desabilitar a flag; preservar todas as versões registradas e revisar fontes antes de outra preparação. Não reverter histórico financeiro.

Reserva e finalização de preparação têm recibo limitado a 90s; aplicação do padrão a 12s (função SQL limitada a 8s). Perda de resposta não comprova rollback e nunca causa reenvio automático. O diário/protocolo deve ser reconciliado antes de retomar uma escrita incerta. Aprovação financeira não usa esse novo comando.

Notas recebidas são apresentadas como recebidas. A confirmação fiscal permanece vinculada ao conjunto de notas e hashes; não é copiada para outra NF sem evidência. Tarifa, tributos e cobertura devem corresponder à competência e fonte atuais. Não há nova chamada de OCR/IA para derivar honorários.
