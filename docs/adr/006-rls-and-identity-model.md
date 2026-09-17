# ADR 006: Row Level Security (RLS) e Modelo de Identidade

**Data**: 2026-09-17  
**Status**: Approved (Decisão de Arquitetura, sem implementação)  
**Fase**: 5.3 (Auditoria + Decisão Deferred)  

## Contexto

Fase 5.0–5.2 implementaram Organizations CRUD (READ/CREATE) com autorização exclusiva em NestJS (`RoleGuard` + `@RequirePermission`). A auditoria de Fase 5.3 revelou que:

1. RLS está habilitado (`rowsecurity = true`) em `organizations`, `customers`, `documents`, `user_profiles`.
2. Policies de `organizations` usam `USING true` (sem isolamento).
3. Backend usa `SUPABASE_SERVICE_KEY` que ignora RLS (Supabase docs: "service_role ALWAYS bypasses RLS").
4. `user_profiles` está vazio (0 usuários), mas `auth.users` tem 2 usuários.
5. Não há trigger automático de auth.users → user_profiles.

## Problema

### 1. Falta de Modelo de Identidade
- Dois usuários existem em `auth.users`, mas nenhum em `user_profiles`.
- Sem `user_profiles`, policies que usam `auth.uid()` não podem determinar `organization_id` do usuário.
- Sem sincronização, novos usuários não serão automaticamente vinculados a organizações.

### 2. RLS Inoperante Atualmente
- Policies existem mas são `USING true` (sem restrição).
- Backend usa `service_role` → ignora RLS (intencional para operações administrativas).
- Se um cliente externo usa `SUPABASE_ANON_KEY`, o comportamento com RLS ainda não foi testado (não comprovado se terá acesso restrito ou global).

### 3. Autorização Exclusivamente em NestJS
- `RoleGuard` + `@RequirePermission` protegem endpoints (CREATE, UPDATE, DELETE).
- RLS não protege acesso ao banco direto com `service_role`.
- Risco de security bypass se credenciais mudarem ou se cliente se conectar diretamente com anon key.

## Decisão

### Não Fazer em 5.3
- ❌ Seed artificial de `user_profiles` (sem evidência de vínculo org/user).
- ❌ Alterar/criar policies (dependem de modelo de identidade definido).
- ❌ Migration SQL.
- ❌ Mudar `SUPABASE_SERVICE_KEY` para JWT do usuário (requer redesign, a ser decidido em 5.3.x).

### Fazer em 5.3
- ✅ Documentar achados de auditoria (este ADR).
- ✅ Registrar débito técnico de RLS.
- ✅ Manter autorização NestJS como defesa primária por enquanto.

### Próximos Passos (Deferred)
1. **Definir modelo de identidade**: Como `auth.users` vinculam a `user_profiles` + `organization_id`?
   - Opção A: Trigger automático on_auth_user_created.
   - Opção B: Seed manual ou migração.
   - Opção C: Backend cria `user_profiles` após login (ex., na função `auth.service.ts`).

2. **Decidir sobre `SUPABASE_SERVICE_KEY`**:
   - Manter atual (admin operations bypassam RLS): requer RLS restritiva como defesa 2ª camada.
   - Migrar para JWT do usuário: requer `user_profiles` e policies corretas.

3. **Implementar RLS restrictiva**:
   - Policy de `organizations`: admin_platform vê todas; demais veem só `organization_id` próprio.
   - Testar isolamento via cliente anon + JWT (não no SQL Editor).
   - Validar que backend + RLS = defesa em profundidade.

4. **Retomar Fase 5.3 (Implementação)**:
   - Migration SQL para policies.
   - Seed ou trigger para `user_profiles`.
   - Testes de isolamento (E2E com clientes anon/JWT).

## Justificativa

- **Evitar seed artificial**: Mascararia falha de provisionamento.
- **Não mudar policies sem modelo**: Uma policy baseada em `organization_id` depende de dados válidos em `user_profiles`.
- **Testes com JWT real**: SQL Editor executa como admin; não testa `anon + RLS` corretamente.
- **Autorização NestJS é segura agora**: `RoleGuard` protege até RLS estar implementada.

## Impacto

- ✅ Fase 5.0–5.2 (Organizations READ/CREATE) continuam funcionando.
- ✅ Autorização NestJS mantém proteção.
- ⏳ Fase 5.4 (UPDATE/DELETE) pode prosseguir com mesma autorização NestJS.
- 🚧 RLS será defesa 2ª camada após modelo de identidade definido.
- 📝 Documentar como **débito técnico**: "RLS ativo mas não operante; implementação pendente de modelo de identidade".

## Referências

- Supabase Docs: [API Keys](https://supabase.com/docs/guides/getting-started/api-keys) – "service_role has BYPASSRLS".
- Supabase Docs: [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security).
- Auditoria 2026-09-17: Queries verificaram `rowsecurity = true`, policies `USING true`, `user_profiles` vazio, backend com `SUPABASE_SERVICE_KEY`.

---

**Próxima Ação**: Fechar ADR 006, fazer commit, registrar como decisão arquitetural. Fase 5.4 (UPDATE/DELETE) pode prosseguir em paralelo com mesma proteção NestJS.
