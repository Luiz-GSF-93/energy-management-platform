# ADR 005: Estratégia de ID para Organizations

**Data**: 2026-09-17
**Status**: Aprovado
**Fase**: 5.1

## Problema

- organizations.id é text PRIMARY KEY NOT NULL sem default
- A aplicação deve fornecer o ID no momento da criação
- Não existe convenção de geração documentada nas Fases 0–4

## Decisão

**Organizations utilizará UUID v4 como identificador de novas organizações.**

### Especificação

- Tipo: text
- Geração: crypto.randomUUID() (Node.js nativo)
- Formato: 550e8400-e29b-41d4-a716-446655440000
- Schema: Sem alterações

### Justificativa

1. Precedente: customers.id e permissions.id usam UUID v4 textual
2. Sem dependências: crypto.randomUUID() é nativo do Node.js
3. Sem schema: organizations.id mantém text NOT NULL
4. Sem migration: Não requer alteração de banco
5. Preserva: org_default e organizações existentes
6. Alinhado: Com arquitetura validada (Fases 0–4)

## Escopo Fase 5.2

- POST /admin/organizations (CREATE)
- Autorização: @RequirePermission(PLATFORM_ORGANIZATIONS_CREATE)
- Sem: PUT, DELETE, RLS, schema changes
