# User invitations and welcome

Customer contact email is for contact information. Saving it never grants access or sends an invitation. To invite a Portal user, open Users, choose Consulta and external affiliation, and explicitly select the licensed exclusive customer. Existing authorization, capacity, tenant isolation and audit checks remain authoritative.

New identities use Supabase `inviteUserByEmail` and the secure `ConfirmationURL` for personal password setup. Informational `energyos_audience`, `energyos_organization`, `energyos_role` and optional `energyos_customer` metadata describe the server-verified invitation. They never grant permissions. Apply `backend/src/modules/admin/users/templates/energyos-invite-supabase.html` to the production Invite user template; deploying source alone does not update Supabase configuration.

Existing identities retain their password and receive the Resend membership notice after successful membership audit. Portal welcome includes the exclusive company and use instructions; Backoffice welcome includes role and guidance about administrator-defined designations. Resends and reactivation resolve the current active membership and company within the organization; a mismatched scope suppresses sending. Notification failure never rolls back a successfully audited membership.

Provider acceptance is not proof of inbox delivery. Inspect provider logs for rejection, bounce or delivery and use the existing explicit notice action when appropriate. No new automatic retries or duplicate sends are introduced. Password recovery remains a separate explicit action. Do not send passwords in email or change another organization's membership when granting this access.

The reusable Resend design is not an authentication token issuer. New-identity password setup remains with Supabase Auth and its configured SMTP transport. Official template variables: https://supabase.com/docs/guides/auth/auth-email-templates
