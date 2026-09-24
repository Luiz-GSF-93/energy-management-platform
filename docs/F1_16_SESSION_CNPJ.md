O frontend descartava o refresh token do login e as telas permaneciam com um token vencido. Agora a sessão é renovada antes do vencimento, com aviso e login da mesma conta na própria tela quando necessário, preservando o formulário montado. A operação do administrador na organização também é renovada com autorização e auditoria do servidor. Escritas que falharam não são reenviadas automaticamente.

Corrige o fundo branco no formulário de Documentos e permite tentar carregar novamente após renovar o acesso. Cadastro de clientes valida CPF/CNPJ nos dois lados e consulta CNPJ numérico pela BrasilAPI ao sair do campo, preservando campos editados. Inclui validação alfanumérica e fallback manual para indisponibilidade; dígitos válidos não significam cadastro ativo.

Validação: 53 suítes / 527 testes backend, testes frontend de renovação concorrente/isolamento/logout e sessão legada, lint e builds aprovados localmente e no Codespace. Sem migração de banco. E-mail/Resend permanece pendente, sem alterações.

Limites: sessões antigas precisam de novo login uma vez para guardar refresh token. Formulários são preservados durante renovação na página aberta; fechar/recarregar ainda descarta campos e arquivo. Consulta alfanumérica externa não suportada pelo provedor atual.
