# Auditoria técnico-jurídica assistida EVA

O fluxo contratual complementa a conferência existente de faturas. Não aprova valores, publica fechamentos, resolve controvérsias nem substitui a revisão profissional. Referências catalogadas e índices jurisprudenciais não são tratados como normas examinadas. Uma conclusão de validade integral não é gerada automaticamente.

## Crédito e escopo

Cada verificação agrupa original e relatório em um crédito documental. O primeiro original já ocupa esse crédito no armazenamento; o relatório gerado não adiciona outro. Uma nova verificação, com outra data-base ou biblioteca, reserva um crédito adicional. Retomar, abrir e perguntar sobre a mesma análise não criam outro crédito documental. Tokens de IA continuam sujeitos ao orçamento próprio da organização.

O documento original deve estar verificado, em armazenamento privado, na empresa e unidade selecionadas. Permissões e licença são reconferidas no pedido e em cada etapa do worker; a sessão operacional do Owner deve permanecer válida. Limites: 15 MB, 100 páginas, 2 MB de texto, 150 blocos e 20 trabalhos ativos por organização. Apenas um trabalho jurídico recebe lease por vez no worker existente.

## Fila e recebimentos incertos

POST retorna protocolo HTTP 202. Texto digital usa o extrator existente em worker thread antes do OCR prebuilt-read. Cada leitura e bloco de IA têm checkpoint persistente. Consultas GET de uma operação OCR aceita reutilizam o identificador do provedor. Interrupção após uma chamada paga, antes do checkpoint, exige conferência técnica; não se repete OCR ou IA automaticamente. Reinício conserva os blocos já registrados. Perguntas idênticas reaproveitam a resposta salva; recebimento incerto não dispara nova IA silenciosamente.

## Biblioteca oficial

A entrega inicial contém 17 referências e quatro conjuntos de trechos revisados: Código Civil, Lei 15.040/2024, Portaria MME 50/2022 e Contratos CCEE 2026.5.1 (itens indicados na fonte). A cobertura é parcial. As referências ANEEL e os índices de precedentes permanecem catalogados até conferência de texto, edição e vigência. O acesso oficial ao texto da REN 1000 retornou 403 durante a pesquisa; nenhum conteúdo inacessível foi declarado analisado.

Owner publica versões imutáveis mediante justificativa e confirmação da fonte. Publicação requer URL oficial HTTPS, vigência e hash dos trechos. Precedente vinculante exige decisão específica, processo/tema, julgamento, publicação, status, modulação e aderência. Fontes com revisão superior a 30 dias não iniciam novas análises pagas. O relatório preserva fontes, edição, hash, data-base, páginas, ressalvas e limites da cobertura usada.

## Implantação e reversão

1. Aplicar 20261333 e 20261334 após preflight do schema e do guard de capacidade. A migração aborta se o trecho conhecido do guard mudar; não o substituir integralmente. Preserva os wrappers anteriores de consumo.
2. Publicar API, frontend e o worker EVA existente, inicialmente com flags desligadas.
3. Ativar `LEGAL_AUDIT_ENABLED=true` na API e worker; `LEGAL_AUDIT_WORKER_ENABLED=true` somente no worker. Não criar outro processador EVA.
4. Conferir saúde, permissão, catálogo, biblioteca, protocolo, arquivo privado e jornada sintética. Não consumir créditos de clientes para testes automáticos.
5. Para conter o novo fluxo, desligar as duas flags. Não remover tabelas, histórico ou fontes; jobs e relatórios permanecem preservados. A conferência de faturas continua no fluxo anterior.

## Validação e métricas

Testes locais isolados: `node test/legal-audit-sql.cjs` no backend; Jest para legal-audit e azure-invoice.connector; `node test/legal-audit.cjs` e `node test/ocr-audit.cjs` no frontend. O teste PDF gera documento sintético e compara bytes determinísticos.

A tela compara, por organização, a janela escolhida e os sete dias anteriores: recebidos, OCR concluído, ocorrências, p50/p95 de OCR e primeira proposta. Medidas incluem fila/provedor e não aprovação humana. Não representam ganho demonstrado ou SLO sem amostra comparável. A liberação deste recurso não conclui as etapas B–G do plano de estabilidade: amostragem 24–72h, exportação/alertas, outbox, carga/falhas e rollback ainda exigem evidências próprias.
