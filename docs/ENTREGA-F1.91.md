# F1.91 — Integração da demanda faturada conferida

O painel Acompanhar homologação permite preencher a demanda faturável ACL do mesmo rascunho criado pela integração dos consumos, para Grupo A Verde. Todas as parcelas atuais precisam estar classificadas como utilizadas/não utilizadas e sem ambiguidade de posto/unidade. A soma não preenche demanda medida ou contratada, nem energia reativa.

A transação exige as nove conferências de identidade/consumo ainda válidas, cadastro ativo e sem duplicidade, contexto tarifário inalterado, rascunho OCR sem alteração nas medições e demanda faturável vazia. Usa revisão otimista, referências calculadas no servidor e autoria autenticada; o navegador envia somente o token. Registro existente, validado ou editado é preservado. Repetições retornam o recibo existente. A auditoria mensal registra a revisão; tabela imutável mantém as parcelas, classificações, evidências e autor. Mudança posterior nas conferências impede validar o rascunho até resolver a origem.

Acesso exige as permissões/licenças de documentos e contratos já existentes; gravação restrita a Gestor/Administrador com permissão de criação. Tabela com RLS e somente leitura para service_role; gravação exclusivamente pela RPC restrita. Outros enquadramentos são bloqueados, não convertidos automaticamente.

Validação: 587 testes OCR (30 suítes), 27 verificações SQL PGlite, testes DOM da integração e da homologação, builds backend/frontend. Migração aditiva aplicada. A função foi exercitada na Del Rei agosto/2026 com ROLLBACK e soma de 500 kW; nenhum registro do teste persistiu.

Continuam pendentes: demanda medida/reativo, parâmetros/tarifas/incidências, reconciliação dos custos/tributos, GD e preparação final. Não há aprovação financeira automática nem cálculo de tributos nesta etapa. A classificação fiscal da parcela não utilizada permanece separada e não se infere ICMS a partir da soma faturada.
