# F1.104 — Conferências atuais em Preparar apuração

A preparação consultava apenas a extração original e exibia consumo e parcelas de demanda como pendentes, mesmo após conferência e integração. Agora consulta os mesmos endpoints autenticados de Documentos e apresenta conferências atuais, autor/versão, integração dos consumos e da demanda faturada e acesso direto aos dados mensais da fatura.

A extração original, medições, histórico e GD continuam disponíveis em um bloco de evidências recolhido. A consulta não grava, não executa OCR e não aprova dados mensais ou fechamento. Uma integração histórica não oculta conferência invalidada por nova evidência. Falha de consulta limpa os resultados; respostas atrasadas de outro documento/competência não aparecem.

Validação: teste DOM com chamadas somente GET, estados integrado/preservado, autores, evidência alterada, ausência diferente de zero, falha, competência incompatível e troca de documento; build frontend.
