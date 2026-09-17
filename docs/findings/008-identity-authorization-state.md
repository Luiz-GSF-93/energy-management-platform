# Finding 008 – Estado Atual: Identidade, Autorização e Permissões

**Data:** 2026-09-17  
**Fase:** Phase 5.3 – RLS Hardening / Auditoria de Identidade  
**Status:** Concluído – registro factual, não é decisão arquitetural

## Resumo

A auditoria reconciliou o estado atual de identidade, multitenancy e autorização com o histórico da Fase 2.

O sistema atualmente opera com `user_profiles.organization_id` como contexto de organização e com autorização através de: `user_roles → roles → permissions`

A implementação atual não é, por si só, uma decisão de negócio sobre se um usuário poderá pertencer a uma ou múltiplas organizações.

## Achados confirmados

### 1. Autenticação

- `auth.users` é a base de autenticação utilizada pelo Supabase.
- Foram identificados 2 usuários no estado auditado.

### 2. Contexto de organização

- `user_profiles` contém o `organization_id` utilizado pelo fluxo atual.
- Os registros auditados estão associados a `org_default`.
- O `TenantGuard` utiliza esse contexto para estabelecer o tenant da requisição.

### 3. Autorização

Fluxo: Usuário → user_roles → roles → roles.permissions (JSONB) → RoleGuard → @RequirePermission

Roles: admin_platform, admin_org, gestor, operacional, consulta

### 4. Permissões

Fase 2, commit 64c5134, mapeou 48 UUIDs reais em `backend/src/common/constants/permissions.ts`

| Role | Permissões |
|------|-----------|
| admin_platform | 48 |
| admin_org | 44 |
| gestor | 30 |
| operacional | 21 |
| consulta | 10 |

### 5. Validação histórica

Fase 2 validou: RoleGuard, TenantGuard, permissões granulares, isolamento de tenant, auditoria, autenticação, rate limiting.

## Débitos técnicos

- `user_roles.user_id` é type text
- `user_profiles.role_id` sem utilização
- `public.users` legacy
- Integridade referencial precisa revisão
- Modelo usuário ↔ organização não formalizado

## O que NÃO foi decidido

- single-org vs multi-org-per-user
- `permissions.ts` como catálogo normativo
- Provisioning strategy
- RLS como camada primária

## Próximas decisões

1. Modelo usuário ↔ organização?
2. Provisioning: trigger ou backend?
3. RLS policies
4. Limpeza técnica

## Conclusão

- 48 permissões confirmadas
- Fase 2 consistente com estado atual
- `user_profiles.organization_id` é contexto de tenant
- Autorização via `user_roles → roles → permissions`
- Comportamento atual é single-org-per-user
- NÃO é decisão de negócio, apenas implementação atual

Este Finding mantém decisões arquiteturais de identidade em aberto.
