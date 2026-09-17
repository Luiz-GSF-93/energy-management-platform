# Decision Brief 009 – Modelo de Identidade e Organização

**Data:** 2026-09-17  
**Fase:** Phase 5.3 – Pause para decisão arquitetural  
**Status:** Aguardando decisão de negócio  
**Tipo:** Decision Brief (não é ADR ainda)

## Propósito

Antes de implementar provisioning, RLS, e estrutura final de `user_profiles`/`user_roles`, é necessário definir o conceito fundamental de **identidade e tenancy** da plataforma.

A implementação atual opera como single-org-per-user, mas essa é uma **consequência do estado atual**, não uma decisão arquitetural formalizada.

---

## Pergunta Fundamental

**Qual é o conceito de usuário da plataforma?**

Um login/pessoa representa:

- (A) Um usuário interno de uma única organização?
- (B) Um usuário que pode trabalhar para várias organizações?
- (C) Um modelo híbrido (usuários internos + administradores de plataforma)?

---

## Contexto Atual

A plataforma atualmente possui:

- `auth.users`: Base de autenticação (Supabase Auth)
- `user_profiles`: Associação usuário → organização (atualmente 1:1)
- `user_roles`: Associação usuário → role (N:N dentro da mesma org)
- `roles`: Papéis com permissões, escopados por organização
- `admin_platform`: Papel de administrador de plataforma (permissões globais)

**Observação crítica:** A existência de `admin_platform` com permissões `PLATFORM_ORGANIZATIONS_*` indica que o sistema **já prevê usuários com escopo global**, não apenas por organização.

---

## Opções de Modelo

### Opção A: Single-Org-Per-User

**Definição:** Um usuário pertence a exatamente uma organização. Não há conceito de "trocar organização ativa".

| Aspecto | Implicação |
|--------|-----------|
| Usuário → Organização | 1:1 |
| `user_profiles.organization_id` | Campo central, NOT NULL, chave de todo contexto |
| `user_roles` | Vinculadas ao usuário; role já carrega `organization_id` |
| Trocar de organização | Não aplicável (impossível) |
| Administrador global | Caso especial: seria usuário com org = NULL ou org = "platform"? |
| RLS | Simples: baseado em `user_profiles.organization_id` |
| Provisioning | Simples: ao criar usuário, atribuir organização e role |
| JWT payload | Contém organization_id única |

**Consequências:**
- ✅ Simples de implementar e compreender
- ✅ RLS mais straightforward
- ❌ Administradores globais precisam de caso especial
- ❌ Impossível transição de usuário entre organizações sem recriação

### Opção B: Multi-Org-Per-User

**Definição:** Um usuário pode pertencer a múltiplas organizações com papéis diferentes em cada uma. O usuário seleciona qual organização é "ativa" por sessão.

| Aspecto | Implicação |
|--------|-----------|
| Usuário → Organização | N:N (via tabela de membership) |
| `user_profiles` | Torna-se apenas metadados (email, name, avatar); não carrega org |
| Tabela nova | `user_organization_memberships` (user_id, organization_id, role_id) |
| `user_roles` | Obsoleta ou reestruturada |
| Trocar de organização | Possível via API; contexto é atualizado por sessão |
| Administrador global | Papel especial com permissões globais; pode acessar todas as orgs |
| RLS | Baseado em associação usuário ↔ organização ativa (via JWT) |
| Provisioning | Complexo: criar usuário, depois criar memberships por organização |
| JWT payload | Contém user_id, organização_ativa, roles nessa org |

**Consequências:**
- ✅ Flexível para administradores globais
- ✅ Suporta transição de usuários entre orgs
- ✅ Modelo mais próximo de SaaS enterprise
- ❌ Schema mais complexo
- ❌ RLS mais sofisticado (depende de JWT + payload)
- ❌ Lógica de contexto ativo por sessão

### Opção C: Modelo Híbrido (Recomendado para investigação)

**Definição:** Usuários podem ser **organization-scoped** (single-org) OU **platform-scoped** (global admin). Decisão por usuário, não por modelo.

| Aspecto | Implicação |
|--------|-----------|
| Usuário → Organização | 1:1 OU NULL (platform-admin) |
| `user_profiles.organization_id` | NULL = admin de plataforma; texto = usuário da org |
| `user_profiles.scope` | Campo novo: "organization" \| "platform" |
| `user_roles` | Roles organizacionais OU roles de plataforma |
| Trocar de organização | Não aplicável |
| Administrador global | Nativo: org_id = NULL, role = admin_platform |
| RLS | Baseado em scope: se platform, sem restrição; se org, restringido |
| Provisioning | Bimodal: admin-only para platform; admin ou self-signup para org |
| JWT payload | Contém scope, organization_id (or NULL), role_id |

**Consequências:**
- ✅ Suporta admin_platform nativamente
- ✅ Simples para usuários comuns (single-org)
- ✅ Claro quem é global vs org-scoped
- ⚠️ Requer lógica condicional em RLS e RoleGuard
- ⚠️ Schema modesto (apenas `scope` novo)

---

## Perguntas para Decisão de Negócio

Antes de escolher a opção:

1. **Escopo de usuários:**
   - Todos os usuários são funcionários internos de uma única organização?
   - Há consultores/parceiros que trabalham para múltiplas organizações?

2. **Administração de plataforma:**
   - Como a plataforma será administrada? (e.g., suporte, onboarding)
   - Esses admins podem/devem ver/gerenciar múltiplas organizações?

3. **Evolução futura:**
   - A plataforma pode crescer para modelo SaaS multi-tenant (múltiplos clientes independentes)?
   - Haverá revendedores ou partners?

4. **Trocar de organização:**
   - Um usuário pode mudar de organização? Com que frequência?
   - Dados históricos devem ser preservados por usuário ou por organização?

5. **Caso de `admin_platform`:**
   - Como `admin_platform` deve acessar organizações? (todas, selecionadas, uma por sessão?)
   - Deve haver auditoria separada de ações globais vs ações por org?

---

## Tabela Comparativa

| Critério | Single-Org (A) | Multi-Org (B) | Híbrido (C) |
|----------|---|---|---|
| Simplicidade inicial | ⭐⭐⭐ | ⭐ | ⭐⭐ |
| Suporte a admin global | ⭐ | ⭐⭐⭐ | ⭐⭐⭐ |
| Flexibilidade futura | ⭐ | ⭐⭐⭐ | ⭐⭐ |
| Custo de implementação | Baixo | Alto | Médio |
| Custo de RLS | Baixo | Alto | Médio |
| Manutenção | Simples | Complexa | Moderada |

---

## Recomendação de Próximos Passos

1. **Responda as 5 perguntas acima** com input do negócio/product.
2. **Escolha a opção** (A, B, ou C).
3. **Transforme a escolha em ADR 009** (documentando contexto, decisão, consequências).
4. **Implemente a estrutura técnica** (migrations, FKs, schema).
5. **Provisioning e RLS** conforme o modelo.

---

## Status Atual

- ✅ Finding 008: Estado atual documentado (single-org de facto)
- ⏳ Decision Brief 009: Aguardando resposta às perguntas acima
- ❌ ADR 009: Não será criada até decisão ser formalizada
- ❌ Phase 5.4: Congelada até decisão de identidade
- ❌ Provisioning: Congelado até decisão de identidade
- ❌ RLS: Congelado até decisão de identidade

