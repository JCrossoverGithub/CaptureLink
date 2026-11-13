# CaptureLink UX3F-2 — Offline `/v2` Broker: Implementation and Acceptance

**Status:** Implementation candidate for code review; not production authorization.\
**Source baseline:** `c0382024eeac5c4b3771f543ac9e07c7bad69d09` (PR #18 merged).\
**Source intake:** `CaptureLink_UX3F2_Source_Intake.zip`; 44 entries; SHA-256 `c2fbcde2b80afcae7270fd72c1a8a0de9cf143c3b59117822274895149c8ab1b`.\
**Goal:** G2 from `CAPTURELINK_UX3F0_PUBLIC_ONBOARDING_RFC.md`: add a hermetic HTTP broker while preserving existing `/v1` and desktop/manual P2P source unchanged.

## Decision / intended user experience

The Open Source CaptureLink desktop app will eventually offer **CaptureLink Online** (operator-hosted signaling at `signal.capturelink.io`) plus a fully independent **Manual P2P** alternative. Neither option sends gameplay media/audio/controller traffic to this signaling API; the broker exchanges authentication, invitation/approval data, bounded WebRTC offer/answer envelopes and network metadata. A TURN relay, if later enabled, is a separate transport decision.

The owner has **not** selected a production identity provider or approved a public login requirement. This offline prototype uses injected trusted *test* host verifiers because the current RFC provisionally favors authenticated hosts. It does not require creating an account for guests. It does not provision user accounts, register devices, or implement system-browser PKCE.

## Changed files

| Path | Change |
| --- | --- |
| `services/signaling/src/public-v2-server.mjs` | New isolated, loopback-only HTTP v2 factory; no CLI startup/exported raw HTTP listener |
| `services/signaling/test/public-v2-server.test.mjs` | Hermetic tests of authorization, atomic single-use invitation, concurrency, roles, SDP envelope constraints, quotas, expiry/revocation, and failures |
| `scripts/ux3f2-source-boundary.mjs` | SHA-256 guard against changes to accepted `/v1`, existing policy, desktop main, renderer and manual UX source |
| `docs/CAPTURELINK_UX3F2_OFFLINE_V2_BROKER.md` | This implementation contract and acceptance record |
| `.github/workflows/ci.yml` | Add v2 tests and boundary checks to both Windows and Linux CI |

The earlier authorization policy (`createPublicAuthorizationPolicy`) and v1 pilot are **imported as-is**, not modified. No VPS files, Caddy routes, user-data files, credentials, production environment variables or desktop feature flags are part of G2.

## Trust and server lifecycle

Use only `createPublicV2SignalingServer({ verifyHostAccessToken, isHostActive, expectedIssuer, expectedAudience, now?, limits? })`. The two callbacks are trusted server-side dependencies, never request/renderer data. `verifyHostAccessToken` must verify signatures/issuer/audience/time/scopes appropriately; **this prototype does not implement that verification**. The trusted callback can be async; failures/timeouts fail closed. `isHostActive` is the authoritative host-account revocation check. The server factory does not read environment variables or credentials and exposes no production CLI entry point.

`await broker.listen()` binds only `127.0.0.1` on a generated ephemeral port; its public API does not expose the raw Node HTTP server for accidental outside binding. `await broker.close()` closes the test listener. `await broker.revokeAccount(subject)` is a trusted **in-process operator method**, not an HTTP route. The basic `GET /healthz` response is minimal; a future public edge needs its own health exposure decision.

All invitations, guest approvals, session hashes, messages, counters and session capabilities live **in RAM**. **A process restart invalidates every invitation and every host/guest session capability.** No attempt at persistence or resumption is claimed. Account identity and revocation state are obtained from injected external trusted dependencies; persistent account/device state is deliberately out of scope for G2. A later staging gate must decide durable storage and process-loss behavior, including unclean restarts and multi-instance transactions. Do not cluster this service: the in-process single-queue transaction boundary is not distributed.

Every mutable request and its authority check are serialized through one process-local transaction queue. This makes simultaneous invitation redemption, approval/rejection, message writes, revocations and quota changes atomic **within this one server process only**. Authentication and account state are still external: if an account is observed as inactive, the broker invalidates its session; an actual revocation event should invoke `revokeAccount` immediately. Neither broker revocation nor broker restart proves an established media peer disconnected; desktop teardown remains G3/G4 work.

## HTTP contract (v2 only)

- `POST /v2/sessions`: `Authorization: Bearer <trusted host token>`, JSON `{ "permissions": { watch,voice,controller,controllerMode } }`. Must pass UX3F-1 issuer/audience/expiry/scope and active-account policy. Returns HTTP 201 `{version:2,sessionId,hostSessionToken,inviteCode,inviteExpiresAt,sessionExpiresAt}`.
- `POST /v2/join`: no host account required, no authorization header; JSON `{inviteCode,displayName}`. Consumes a random 32-byte base64url invitation exactly once; returns HTTP 202 `{version:2,sessionId,guestId,guestSessionToken,status:'pending'}`. An unverified display name grants no authority.
- `GET /v2/sessions/{id}`: host/guest bearer capability, returns role-scoped state. Only the host sees pending guest ID/display name; guest sees their own `pending`, `approved`, or `rejected` state.
- `POST /v2/sessions/{id}/approve|reject`: host bearer and exact `{guestId}`; pending guest only, before invitation expiry. Host approval is never automatic.
- `GET /v2/sessions/{id}/messages?after=n`: host/guest bearer; returns only role-addressed messages, only after explicit approval.
- `POST /v2/sessions/{id}/messages`: exact `{kind,payload}` after approval; host writes one `invite` envelope; guest writes one `response` envelope tied to the same inner WebRTC session UUID. `inspectEnvelope` validates current `CAPTURELINK-SESSION-V1:` schema, immutable permissions and bounded payloads. This is **signaling**, not a media relay.
- `POST /v2/sessions/{id}/revoke|leave`: role-specific host revoke/guest leave; erases in-memory session authority. No request body.

No `/v2/installations` registration, OAuth redirect/token route, browser CORS exposure, refresh token storage, or production endpoint selection is implemented. All v2 requests are served only by this new factory in tests, never by the existing `/v1` runtime.

## Default budgets / security boundary

- Invite 15 minutes; session 3 hours; one guest; immutable permissions.
- Default maximum 12 sessions; 2 sessions per authenticated host; 4.8 MB aggregate cached signaling; at most two role-specific messages per session.
- Socket request budget 600/minute; anonymous joins 24/minute per socket and 3/minute per invitation digest; verified-host create 10/minute; session operations 300/minute. Bounded tracking maps and max 64 connections. Budgets are conservative **local harness settings, not approved public rates**.
- Read no more than `MAX_BODY` bytes (1.2 MB) per POST and require JSON where applicable. Session capabilities and invitations are 32 cryptographically random bytes, compared by SHA-256 digests and constant-time equality, and never logged by application code.
- Reject `Origin`, `Forwarded`, `X-Forwarded-*`, `X-Real-IP` and similar claims in this local adapter; accept only a loopback Host header, no URL query secrets, no arbitrary routes. Client-IP quotas are based on **socket IP only**; behind Caddy this will generally be the shared proxy IP and is **not production-ready**. Trusting proxy headers requires an explicit edge design and tests in G4.
- No TLS listener is provided; loopback HTTP for offline tests only. TLS terminates at a separately reviewed reverse proxy for staging/public operations. No HTTPS downgrade or fallback is implemented.
- Error responses contain bounded public codes only; no credential, IP, user identity, SDP/ICE payload, or upstream exception details. The intended signaling endpoint intentionally returns the peer-authorized envelope after approval.

## Local acceptance procedure

1. Verify worktree HEAD equals `c0382024eeac5c4b3771f543ac9e07c7bad69d09`; only the five intended files are altered/added.
2. Run `node --test services/signaling/test/public-authorization-policy.test.mjs services/signaling/test/public-v2-server.test.mjs` and `node scripts/ux3f2-source-boundary.mjs`.
3. Run **the entire** existing signaling test directory, including `pilot-runtime.test.mjs`, on **JPCMAIN WSL Node >=24.19.0**, which has the scripts omitted from the archived intake.
4. Run `npm ci`, `npm run typecheck`, `npm run build` on JPCMAIN Windows. Check Git status and `git diff --check`.
5. Run Windows and Linux GitHub CI, staged diff/secret scan with a positive-control detection, owner review of the five-file patch, and only then consider a PR. No deployment is authorized.

**Off-machine preliminary verification:** the uploaded 44-entry archive was verified against the above digest. The generated v2 module passed 28 dedicated hermetic HTTP tests, and 117 tests passed in the available archive snapshot excluding `pilot-runtime.test.mjs`. That runtime test requires `scripts/ux3c3a-provision.mjs` which is **not present in the 44-entry intake**; a failed full-suite run in the partial snapshot therefore cannot be interpreted as a real repo failure. All tests were run under container Node v22.16.0; JPCMAIN must rerun under the supported Node 24.

## Remaining release blockers after G2

The design is **not** a public authentication system yet. G3/G4 must address: production identity-provider selection, system-browser PKCE and refresh lifecycle, robust trusted token verification, account and installation persistence/revocation, durable or documented ephemeral session recovery, distributed transaction/locking if scaled, trusted-proxy IP model and abuse controls, HTTPS staging/origin pinning, a public v2 client adapter, Windows OS secret storage, invitation-level idempotent retry experience, peer-teardown validation, monitoring and privacy notice, dependency audit (45 npm advisories in prior builds), and independent network/TURN decisions. The operator must explicitly approve any change to `signal.capturelink.io` or VPS service configuration.

**Rollback:** because this patch adds a separate offline factory and CI tests only, revert the five-file PR or disable its test invocation. `/v1` and the installed desktop are unaffected.
