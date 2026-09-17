# ADR 007: Identity Foundation Model

**Data**: 2026-09-17  
**Status**: Approved (Decisão de Arquitetura, Provisionamento Pendente)  
**Fase**: Identity Foundation (antes de 5.4 UPDATE/DELETE e RLS Hardening)

## Contexto

Auditoria de Fase 5.3 revelou a estrutura real de identidade e autorização do sistema. Fases 5.0–5.2 implementaram Organizations CRUD com autorização em NestJS. Agora é necessário estabelecer o fundamento de identidade/tenant antes de ampliar operações CRUD e implementar RLS.

## Estado Atual Comprovado pela Auditoria

### Autenticação
- ✅ **Fonte**: Supabase Auth (`auth.users`).
- ✅ **Método**: `signInWithPassword`.
- ✅ **JWT**: Assinado pelo Supabase, validado via `supabaseService.getClient().auth.getUser(token)`.
- ✅ **Usuários**: 2 registros em `auth.users` (teste@expertenergy.com.br, admin@expertenergy.com.br).

### Autorização (Role + Permissions)
- ✅ **Fonte efetiva**: `user_roles` (junção) → `roles` (tabela).
- ✅ **FK**: `user_roles.role_id` referencia `roles.id`.
- ✅ **Dados**: 2 registros em `user_roles`:
  - teste@ → role `consulta` (10 permissions).
  - admin@ → role `admin_platform` (45 permissions).
- ✅ **Armazenamento**: `roles.permissions` é array JSONB de UUIDs.
- ✅ **Validação**: TenantGuard busca via `user_roles`, RoleGuard valida em `@RequirePermission([PERMISSION_UUID])`.

### Tenant (Organização)
- ❌ **Fonte prevista**: `user_profiles.organization_id` (NOT NULL, text).
- ❌ **Status**: Coluna existe no schema, mas tabela está vazia (0 registros).
- ⚠️ **Fallback**: TenantGuard usa fallback `org_default` quando `user_profiles` está vazio.
- ⚠️ **Impacto**: Todos os usuários veem a mesma organização (org_default), isolamento de tenant não funciona.

## Arquitetura de Identidade Estabelecida

```
Supabase Auth
    │
    └── auth.users (userId, email)
         │
         ├─→ user_roles (user_id, role_id) [preenchido ✅]
         │      │
         │      └─→ roles (id, name, permissions[])
         │
         └─→ user_profiles (user_id, organization_id, role_id, ...) [vazio ❌]
                └─→ organization_id (text NOT NULL)
```

## Fluxo de Requisição Atual

```
HTTP Request + JWT
    │
    ▼
TenantGuard
    ├─→ Extrai JWT
    ├─→ Valida com Supabase Auth
    ├─→ Busca user_profiles.organization_id
    │   └─→ [FALHA] → fallback org_default
    ├─→ Busca user_roles → role_id
    │   └─→ [OK] → busca roles.permissions
    └─→ Monta tenantContext { userId, organizationId, role, permissions[] }
         │
         ▼
    RoleGuard + @RequirePermission
         │
         ▼
    Endpoint (autorização ok)
         │
         ▼
    SupabaseService (service_role, ignora RLS)
         │
         ▼
    Database
```

## Decisões Aprovadas

### 1. Autenticação ✅
- Manter Supabase Auth como fonte de verdade de autenticação (userId, email).
- Manter validação via `supabaseService.getClient().auth.getUser(token)`.
- Sem mudanças necessárias nesta camada.

### 2. Autorização (Role + Permissions) ✅
- Manter `user_roles` + `roles` como fonte de verdade de autorização.
- Manter validação em NestJS via `RoleGuard` + `@RequirePermission([PERMISSION_UUID])`.
- Sem mudanças necessárias nesta camada.

### 3. Tenant (Organização) ⏳ **PENDENTE**
- **Objetivo**: Preencher `user_profiles.organization_id` de forma determinística e rastreável.
- **Não decidir ainda**: Não implementar trigger automático, seed artificial, ou convite/admin flow.
- **Necessário**: Definir o fluxo de negócio:
  - Qual evento dispara a criação de um `user_profile`?
  - Quem determina a `organization_id` inicial?
  - Um usuário pode pertencer a múltiplas organizações?
  - Como é feita a atribuição de `role` por organização?

### 4. SUPABASE_SERVICE_KEY ✅
- Manter service_role como credencial do backend (ignora RLS por design).
- Autorização primária permanece em NestJS.
- RLS será defesa secundária após identidade estar resolvida.
- Futuro: avaliar migração para JWT do usuário (mudança arquitetural maior).

## O Que NÃO Fazer Antes de Definir Provisionamento

- ❌ Criar trigger `on_auth_user_created` (inventaria organização arbitrariamente).
- ❌ Seed artificial de `user_profiles` com org_default (mascararia o problema).
- ❌ Alterar RLS policies (dependem de `user_profiles` preenchido).
- ❌ Remover fallbacks de org_default/role: 'user' em TenantGuard (seriam quebrados).

## O Que Fazer Antes de Continuar

1. **Auditar fluxo de criação/convite de usuários**:
   - Existe um admin panel ou API para convidar usuários?
   - Há um fluxo de self-sign-up que atribui organização?
   - Como admin_platform é atribuído a admin@?

2. **Definir contrato de provisionamento**:
   - Exemplo: "Admin cria usuário → especifica org_id + role_id → sistema cria user_profiles".
   - Exemplo: "Usuário faz sign-up → escolhe organização → sistema cria user_profiles com escolha".

3. **Implementar provisionamento**:
   - Pode ser trigger, backend endpoint, ou CLI admin.
   - Deve ser rastreável e testável.

4. **Validar isolamento**:
   - Usuário de Org A não vê Org B.
   - Usuário sem `user_profiles` correto falha explicitamente, não cai em fallback.

5. **Remover fallbacks** e implementar RLS restritivo.

## Impacto Arquitetural

| Camada | Status | Ação |
|---|---|---|
| Autenticação (auth.users) | ✅ OK | Manter |
| Autorização (user_roles + roles) | ✅ OK | Manter |
| Tenant (user_profiles) | ❌ Vazio | **Auditar provisionamento** |
| RLS | ⏳ Ativo mas permissivo | **Implementar após provisionamento** |
| Fase 5.4 (UPDATE/DELETE) | ⏳ Autorização NestJS pronta | **Pode prosseguir, testar isolamento** |

## Referências

- Auditoria 2026-09-17: Queries schema, FKs, conteúdo de user_roles, user_profiles, roles.
- ADR 005 (Phase 5.1): ID Strategy para organizations.
- ADR 006 (Phase 5.3): RLS Status.
- Padrões: Multi-tenant provisioning patterns requerem decisão de negócio + design.

---

**Próximas Ações:**
1. Commit ADR 007.
2. Auditar fluxo de criação/convite (sem implementação).
3. Definir contrato de provisionamento.
4. Decidir entre trigger/backend/admin.
5. Implementar provisionamento.
6. Remover fallbacks.
7. Retomar RLS.
8. Continuar Phase 5.4 (UPDATE/DELETE).
