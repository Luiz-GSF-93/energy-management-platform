# F1.25 — Aviso de reativação

Ao confirmar a reativação de um usuário em uma organização, o backend envia pelo Resend um aviso com organização, função, vínculo e link de login. O envio ocorre somente depois da alteração auditada no banco; falhas de e-mail não desfazem o acesso confirmado. Cada reativação recebe uma chave de envio distinta do convite inicial.

O frontend distingue envio aceito pelo provedor de envio não confirmado e orienta usar Enviar aviso do vínculo quando necessário. Aceitação pelo Resend não comprova entrega na caixa de entrada.

Validação: 57 suítes e 586 testes backend aprovados, build backend, lint e build frontend aprovados. Cobertura de ordem da confirmação, rejeição de reativação, desativação sem aviso e conteúdo do e-mail. Sem migração de banco ou nova variável.

Teste em produção: em uma organização, reative um usuário de teste inativo e confira o aviso na tela e o e-mail recebido. Nenhum acesso real foi alterado automaticamente para este teste.
