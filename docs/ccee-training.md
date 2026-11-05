# CCEE operational training

Versioned generic demonstration media, independent of financial approvals and CCEE transmissions.

## Rollout

1. Apply additive migration `20261276_ccee_training.sql`. It creates two private tables, service-only RPCs and a private generic-media bucket. The content starts **DRAFT**, initially scoped to `org_default`. No member/role/license grants.
2. Upload reviewed generic files to `energy-training-private/ccee/v2/`: `video.mp4`, `legendas.vtt`, `poster.png`, `guia.pdf`, `transcricao.txt`. Never place customer documents in this bucket. Upload without overwriting published versions.
3. An existing authorized platform actor publishes the reviewed duration/hash/chapters through service-only `training_publish`. It refuses missing media or repeat publication. This is content publication, not calendar-source approval.
4. Enable `CCEE_TRAINING_ENABLED=true` only after media, API and database checks. The default is off. Pausing this flag removes assignment/media access through the app without deleting progress or interrupting business workflows.
5. Verify an internal eligible account. Other organizations are not activated by this initial migration. Additional rollout must preserve effective license, membership and action permissions.

## Authorization and progress

The normal authenticated organization context is authoritative. Global sessions, platform-operation sessions and external roles cannot enroll. SQL also verifies an active internal membership, an unambiguous active license, module entitlement and role/individual permission intersection. Anonymous/authenticated users have no direct table or RPC grants.

`GET /training/ccee` returns only the caller's assignment. `POST /media` signs five allowlisted generic paths for fifteen minutes after the same authorization check. `POST /progress` accepts commands only, not actor/org/completed fields. A player lease prevents concurrent tabs from multiplying coverage. Server time bounds credit; seeks, stale intervals and direct jumps to the end do not complete the video. Completion requires coverage of all but the final two codec-tolerance seconds and reaching the ending. This is playback telemetry, **not proof of attention or learning**.

The reminder is shown once per browser login session and organization until the mandatory content version is completed. **Ver depois** preserves the assignment and does not block the business workspace. Resume and completion persist on the server; the transient reminder marker is cleared on session termination. New content is not made mandatory merely because a file changes.

Normal playback ticks update the compact progress row and are excluded from successful generic HTTP audit capture. Failed requests remain auditable. Opening, deferral, content publication and completion have audit events. No screen/audio/key capture, extra IP tracking, external analytics, new charges, OCR or SOAP calls.

## Verification

Backend: training service Jest suite; `node test/training-sql.cjs`; TypeScript. Frontend: `node test/ccee-training.cjs`; TypeScript/build. SQL tests use an isolated in-memory PGlite schema, never production identities. Media rendering/demos stay outside the application source and are not deployed as public fixture routes.

The tutorial must distinguish preparation, review, financial approval, portal publication and external CCEE confirmation. A future transmission is visibly identified as a simulation while its adapter is not homologated.
