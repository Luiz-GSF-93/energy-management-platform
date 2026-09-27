# F1.99 — Conferência auditada da descrição CDE

Em Acompanhar homologação → CDE, o botão “Conferir descrição CDE no PDF” abre a fatura original e as duas descrições para conferência. Gestor ou administrador com permissão OCR registra o resultado e a evidência. O recibo mostra autor, data e versão; após salvar, o formulário fica bloqueado até solicitar nova revisão. Falha de atualização não apaga o recibo de salvamento.

A confirmação preserva o OCR e sua confiança original. O histórico é vinculado a organização, documento, cliente, unidade, competência, hash do arquivo, trabalho OCR, versão do layout, linha, posto e valores da operação. Mudança de evidência exige nova conferência. A última decisão “Precisa de correção” impede a integração.

Somente a baixa confiança da descrição pode ser suprida por confirmação humana vigente. Unidade, quantidade, tarifa e tributos continuam exigindo origem e confiança >85%; conciliação aritmética, totais, cadastro, identidade, consumo e bloqueio de duplicidade continuam obrigatórios. A integração cria rascunhos com referências às conferências; não aprova a apuração.

Migração: 20260927_f1_99_ocr_cde_reviews.sql. Histórico append-only, autor obrigatório, justificativa, confirmação PDF, chave idempotente, controle de versão e RLS; acesso direto de anon/authenticated vedado. Trigger SECURITY DEFINER com search_path fixo permite travar as fontes sem ampliar privilégios da API sobre OCR. Nenhum dado existente é substituído.

Testes: conferência, fonte, integração, validação de valores, permissões, replay, conflito de versão, imutabilidade e testes DOM de CDE/consumo/demanda/identidade. Builds backend/frontend. A fatura Del Rei permanece sem confirmação automática feita pelo agente; a conferência deve refletir a leitura real do operador no PDF.
