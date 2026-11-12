# BETA 0.1.0-beta.20261112.4 — acompanhamento e medição por etapa

Esta entrega continua o plano de robustez. Mantém a fila durável, as decisões de
identidade justificadas e a separação entre conferência, aprovação e publicação.
Não considera concluída a janela de 24–72h nem a refatoração assíncrona manual.

## Experiência do operador

O painel existente em Documentos > Painel operacional da EVA mostra banco e
autenticação pela readiness pública já publicada. O pedido não usa cookies,
Bearer token, organização ou dados de documentos. Resposta inválida ou consulta
não confirmada é mostrada como desconhecida; indisponibilidade de um serviço
permanece distinta de divergência cadastral ou pendência financeira.

As consultas não se sobrepõem e têm prazo de 15 segundos. Falhas espaçam novas
consultas para 60 e depois 120 segundos; sucesso retorna a 30 segundos. A página
oculta ou offline pausa novas consultas e retoma ao retornar. O botão de consulta
manual não repete operações financeiras, uploads nem OCR. O backend limita a
leitura autorizada do painel a oito segundos e mantém os filtros de organização.

Durante uma falha técnica, a última consulta permanece visível com data/hora.
401/403 e mudança de organização removem a lista anterior. Uma resposta atrasada
de uma consulta cancelada não pode sobrescrever a seleção atual. A atualização
da tela não cancela o processamento do documento. Ações de conferir, justificar
e reconciliação continuam nos fluxos autorizados de Documentos/Contratos.

## Medição das etapas

`observeEvaStage` mede exclusivamente as etapas instrumentadas dos workers de
intake, OCR e explicação opcional: download, leitura XML/texto PDF, envio/consulta
OCR, identidade, cópia, fontes, checkpoint, rascunhos, fechamento e IA opcional.
Não instala OpenTelemetry e não muda o processamento síncrono manual da API.

O evento privado `ENERGYOS_RUNTIME_SAMPLE` ganha um array `stages`, com chave
fixa, execuções ativas, concluídas, falhas, medições válidas, duração média e
máxima por janela. Operações sobrepostas não são tempos aditivos. Uma conclusão
de etapa não significa fechamento financeiro aprovado nem documento concluído.
Uma etapa longa pode continuar ativa em diversas janelas até terminar.

Não são armazenados IDs, conteúdo, nomes de arquivos, chaves ou mensagens de
exceção. Há no máximo 14 chaves fixas por processo; os contadores concluídos são
drenados a cada amostra. Não há histórico por documento em memória nem log por
chamada. O original da exceção é propagado ao fluxo existente e a operação nunca
é repetida pelo medidor. Falhas de instrumentação não impedem o trabalho.

O mesmo `ENERGYOS_RUNTIME_OBSERVABILITY_ENABLED=false` desliga a coleta no
próximo início. Não há migração de schema, nova permissão, endpoint público ou
serviço contratado. Voltar à versão anterior é compatível com os dados atuais.

## Próximas decisões e critérios

Confrontar duração/falhas por etapa com CPU/RSS/event loop, idade da fila e
eventos duráveis do protocolo, cobrindo lotes e organizações distintas. Métricas
de um período ocioso não comprovam capacidade sob carga. Retenção e alertas
externos ainda dependem da etapa de observabilidade de infraestrutura.

A preparação manual assíncrona exige intenção durável, confirmação rápida e
consulta pelo mesmo protocolo; perda de confirmação de gravação deve continuar
em reconciliação, sem criar outro fechamento nem repetir cobrança de OCR.
Não substituir a fila por broker adicional antes de medir a necessidade.
