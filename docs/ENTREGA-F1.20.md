# F1.20 — Visualização privada de documentos

Acrescenta Visualizar ao lado de Baixar na lista de documentos. Abre PDF ou imagem em nova aba usando URL assinada de 60 segundos, sem forçar download. A nova rota GET /api/v1/documents/:id/preview reutiliza licença, permissão, isolamento organizacional e verificação do arquivo existentes. Falhas fecham a aba de carregamento e exibem mensagem; troca de organização descarta a resposta.

Migração F1.19 aprovada pelo titular e aplicada: dois perfis Gestor canônicos atualizados com auditoria. Nenhuma migração adicional para visualização.

Validação: suíte completa do backend, testes específicos de assinatura inline e bloqueio de documentos de outro tenant/não verificados; builds backend/frontend e lint aprovados. Teste visual em produção após deploy.

Como testar: Documentos → Visualizar abre o arquivo em nova aba; Baixar mantém o comportamento anterior. Navegador deve permitir a nova aba. OCR e processamento energético permanecem etapas futuras.
