-- Aplicar em um projeto Supabase dedicado a PEE, após revisão da equipe.
-- Tabelas comerciais privadas: nenhum acesso direto por usuários do navegador.
create table if not exists public.pee_license_requests (
 id uuid primary key,
 principal text not null,
 idempotency_key text not null,
 revision integer not null default 0,
 payload jsonb not null,
 created_at timestamptz not null default now(),
 unique(principal,idempotency_key)
);
create table if not exists public.pee_core_events (
 id text primary key,
 digest text not null,
 "requestId" uuid not null references public.pee_license_requests(id),
 created_at timestamptz not null default now()
);
alter table public.pee_license_requests enable row level security;
alter table public.pee_core_events enable row level security;
revoke all on public.pee_license_requests, public.pee_core_events from public, anon, authenticated;
grant select,insert,update on public.pee_license_requests to service_role;
grant select,insert on public.pee_core_events to service_role;
-- Sem política permissiva para anon/authenticated. A API valida identidade,
-- propriedade e escopos antes de cada operação. service_role só no servidor.
-- Projetos e anexos necessitam tabelas próprias com tenant_id e RLS:
-- esse módulo NÃO cria acesso a projetos técnicos nem substitui suas políticas.
