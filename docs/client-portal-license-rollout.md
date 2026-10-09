# Client Portal licenses and shared user capacity

The organization license remains the parent entitlement. Backoffice and Portal active memberships share its existing max_users limit. Registering a customer company does not consume a user seat. Three active people of one customer consume three seats; deactivation releases a seat under existing rules. Per-client max_users distributes parent seats, never adds capacity. No automatic billing or plan upgrade occurs.

Apply `20261009_client_portal_licenses.sql` then `20261009_portal_shared_user_capacity.sql`. The second migration supersedes the unactivated company quota, retains its columns/history for compatibility and disables new company additions. It leaves the existing member/unit/document quota triggers and organization lock intact. It does not update users, roles, parent limits, customer rows, policies or grants.

## Rollout

1. Keep CLIENT_PORTAL_LICENSES_ENABLED and NEXT_PUBLIC_CLIENT_PORTAL_LICENSES_ENABLED off while migrations and rollout are reviewed.
2. Enable the backend feature to prepare per-client conditions through Licença e módulos → Portal do cliente e usuários do plano, with organization policies still off. Only platform operation with licence update permission can write conditions. Dates, modules and user/unit limits must fit the parent license.
3. Review current exclusive external memberships and concessions before explicitly activating an organization policy. Database activation checks compatible shared quota and existing client grants.
4. Enable the frontend feature in a reviewed build. Published Portal data remains scoped to the client's exclusive binding, permissions and licensed modules. Authorization failures mount no report components. Globally disabled compatibility retains existing handlers and guards.
5. After separate real-recipient access approval, use Usuários → Inserir: first name/surname, email, Consulta role, external affiliation and the licensed exclusive customer. Portal invitations are rejected when rollout/policy/license is disabled, foreign/expired or the shared quota is full. The membership carries exclusive_customer_id in the same insert validated by parent and client quota triggers. Its binding is included in the invitation audit. Existing memberships are not rebound automatically.
6. Verify the real pilot Portal results. Keep the backend flag enabled for organizations using these conditions; turning it off restores legacy compatibility, not client suspension.

## Welcome email

New identities keep the existing Supabase inviteUserByEmail → ConfirmationURL → /auth/accept-invite flow. Supabase renders `energyos-invite-supabase.html`; configured Resend SMTP transports it. The reusable Resend design is `energyos-welcome-resend.html`, with required ACTION_URL and no fallback shared invitation. This library template does not issue tokens or replace authentication.

Existing identities retain their password and receive the branded membership notice sent through Resend with the existing membership idempotency key. Password recovery, MFA, token expiry, permissions, tenant guards and invitation compensation remain unchanged. No real welcome message, account grant or test-recipient enrollment is sent by rollout.

## Verification and limits

Backend regression tests cover invitation compensation, roles, user quotas, default-off behavior, scoped concessions, retired additions, guarded enrollment and HTML escaping. Frontend checks cover scoped grant payloads, absence of automatic writes, authorization failure and module filtering. SQL migration validation uses a rollback transaction and verifies shared counts, retained parent quota triggers and service-only ACLs. Real recipient delivery/acceptance and concurrent stress remain rollout checks. Official RAG draft chunks and financial engines are outside this change.
