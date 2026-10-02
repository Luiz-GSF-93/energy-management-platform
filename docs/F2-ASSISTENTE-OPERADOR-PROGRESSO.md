# Assistente OCR: validação operacional e progresso

Após extração Azure, o assistente prepara em paralelo conferências, histórico validado da UC, cadastros vigentes e propostas disponíveis. O progresso informa conclusões efetivas e tempo medido, sem percentual simulado. A meta de 5–10 segundos é para a preparação após OCR, não uma garantia de latência de upload, Azure ou de resolução de dados ausentes.

O perfil canônico `operacional` valida campos elegíveis com PDF, justificativa, fonte e autor autenticado. Parcelas de demanda exigem classificação explícita USED/UNUSED. Confirmação humana não aumenta confiança OCR. A permissão vigente de atualização de contratos permite somente os serviços auditados de preparação OCR em rascunho via assistente; nenhum catálogo RBAC é alterado. APIs genéricas mantêm permissões existentes. Gestor/admin permanecem responsáveis por validar registros financeiros, aprovar bases e aprovar/publicar apuração.

Formulários existentes são reutilizados dentro do assistente, com unidade/competência conferidas e proteção contra descarte de preenchimento. Ausência, conflito, dado sem confiança suficiente, configuração sem vigência e revisão específica não são presumidos. Novos cadastros exigem suas permissões existentes. O assistente não extrai honorário nem preço do fornecedor da fatura da distribuidora.

Antes de cada gravação são reconsultadas as fontes; alterações interrompem o lote. Gravações são individuais, não uma transação única: resultado parcial e necessidade de consultar histórico ficam explícitos. Nenhuma gravação incerta é repetida automaticamente. Registros existentes e versões publicadas são preservados.

As leituras duplicadas são compartilhadas somente dentro de uma inspeção; gravações nunca usam esse cache. Jobs de progresso são transitórios, vinculados a organização, ator, permissões e documento, com expiração de três minutos e limite de 64. Reinício ou atendimento por outra instância exige nova inspeção; para escalar em múltiplas réplicas será necessário armazenamento compartilhado de jobs. Isso não é uma fila financeira durável.

Não há migration nem modificação de produção no banco neste incremento. Apuração Cenourão publicada e ressalvas permanecem preservadas. CCEE aguarda validação do certificado/habilitação da Plataforma de Integração.
