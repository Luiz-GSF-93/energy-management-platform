# F1.103 — Aprovação única com substituição atômica

O erro de sobreposição ocorria porque a nova declaração TUSD + CDE exigia retirar a anterior manualmente antes de aprovar. Agora o mesmo endpoint de aprovação resolve versões OCR explicitamente vinculadas em uma transação: valida bases atuais, retira a anterior com justificativa automática e aprova a nova. Qualquer falha reverte ambas as alterações e seus eventos.

## Segurança e histórico
- Vínculo estruturado supersedes_parameter_id; a migração vincula somente propostas F1.102 não ambíguas, ainda em rascunho. O evento identifica o autor de sistema, sem atribuir a migração a uma pessoa.
- Procedimento SECURITY INVOKER executável somente pelo service_role. RBAC, licença e ator autenticado continuam no endpoint. Escopo, fonte, cenário, período, rubrica e vínculo são novamente validados no banco.
- Bloqueio por escopo, linhas das versões e bases. Exige quatro bases aprovadas e atuais (TUSD/CDE, ponta/fora ponta), preservando as duas bases anteriores. Nenhum valor aprovado é sobrescrito.
- Valida revisão otimista. Repetição de aprovação já concluída retorna a versão aprovada, sem repetir eventos. Sobreposição sem vínculo explícito continua bloqueada.
- Não libera o fechamento completo sem as demais entradas/validações; automatiza a substituição dos parâmetros OCR, não declara homologação total.

## Interface
Aprovação direta por “Validar e aprovar” ou “Aprovar e substituir versão anterior”, sem segunda confirmação. O resultado mostra o recibo e atualiza a situação da versão anterior. Retirada isolada mantém justificativa e confirmação próprias.

## Validação
28 verificações PGlite com o serviço real: migração idempotente, escopo, licença, revisão, bases atuais, privilégios, autor e eventos, idempotência e falha deliberada após retirada para comprovar rollback. 122 regressões CDE/TUSD, teste DOM de aprovação e builds backend/frontend.

Migração: 20260927_f1_103_atomic_parameter_replacement.sql.
