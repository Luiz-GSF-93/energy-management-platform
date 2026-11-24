# Auditoria + OCR: pesquisa contextual

Ctrl+K ou Command+K abre pesquisa restrita ao módulo e à organização ativa. Filtros começam com empresa/unidade/tipo/documento selecionados e podem ser ampliados. Busca usa textos originais preservados nas verificações, sem OCR/IA, novo crédito ou alteração de relatório. Termos combinados com AND e flexão em português; acentos normalizados. Resultado contém arquivo, empresa, unidade, página e trecho.

Backend revalida membro interno/Owner em operação, permissão e licença pelo mesmo gate da auditoria. Somente documentos vinculados às análises e com hash atual são elegíveis; não consulta conteúdo de outros módulos. Resposta paginada em 20 trechos, entrada limitada e timeout de 5s no banco. Rotas sem cache. React escapa texto literal, inclusive markup no original. Troca de organização, fechamento e mudança de filtro abortam consultas e descartam respostas antigas.

Aplicar migração 20261359 antes de publicar API e frontend. Rollback: reverter código de interface/API; função de leitura pode permanecer sem chamadas, ou DROP FUNCTION com assinatura exata após rollback. Sem mudança em dados financeiros, documentos ou cotas.
