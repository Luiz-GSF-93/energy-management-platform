# Teste da migração F1.6

Este teste usa PostgreSQL via PGlite com estrutura reduzida e dados fictícios de
duas organizações. Não acessa Supabase, rede ou credenciais durante a execução.
As definições de colunas, políticas, função e view foram extraídas do inventário
fornecido em 24/09/2026. Constraints, triggers, extensões e serviços Supabase não
são reproduzidos integralmente: o teste verifica a fronteira de privilégios.

Nesta pasta:

```sh
npm ci --ignore-scripts
node verify.mjs ../../src/database/migrations/20260924_f1_6_browser_authorization_boundary.sql
```

A instalação é independente das dependências de produção do backend.
Resultado observado: 70 verificações, PostgreSQL 18.3/PGlite 0.5.8.
O ambiente exportado usa PostgreSQL 17.6; homologação nessa versão e testes
reais de API, login e permissões continuam necessários antes de implantação.

Cobertura: exposição da view na baseline; negação de SELECT/INSERT/UPDATE/DELETE
diretos nos cinco domínios; bloqueio de alteração de papéis e campos de segurança;
remoção de grants por coluna; perfil próprio sem recursão; apresentação editável;
acesso preservado do service_role; segunda execução; falha transacional em drift.
