# CaptureLink UX3F-0 — CaptureLink Online: Public Authentication & Signaling Contract

**Status:** Proposed design for owner review — **NOT** implementation approval or deployment authorization.\
**Intake baseline:** `a1a83eab69ac893a47c2a6d977e0106a2c2d34c2` (feature/ux3c3e-private-vps-deployment, private-pilot source intake).\
**Source integrity:** 17 of 17 intake files match `SOURCE_MANIFEST.json`.\
**Scope:** Official hosted signaling over `https://signal.capturelink.io`, with completely independent manual P2P fallback.\
**Excluded:** Replacing gameplay WebRTC; TURN deployment; native Xbox authentication redesign; production cutover in this phase.

## 1. Product decision and nonnegotiable boundaries

1. The **public, open-source CaptureLink desktop application** has **CaptureLink Online** as its recommended/default *friend-connection* method, using the operator's `signal.capturelink.io` service.
2. The existing **manual offer/answer P2P** workflow remains independent: it must work without contacting CaptureLink's hosted service. A user must explicitly choose manual mode; a remote authentication/certificate/security failure must **not** cause a silent downgrade.
3. The signaling server receives **connection-control data** (authentication, invitations, approval decisions, short-lived session state, SDP/ICE signaling and network metadata) but **not** gameplay media, microphone contents, or controller event streams. WebRTC carries user traffic over a direct/relayed peer connection. A later TURN server is a separate bandwidth and privacy decision.
4. There are **no reusable application-wide credentials**, private signing keys, account refresh tokens, or production admission tokens in Git or binaries. A hostname and a public OAuth client ID are not secrets.
5. The operator's public service can have its own policy, limits, or account requirements. Public repository source does not imply unrestricted use of the hosted infrastructure. Implementing a user-selectable self-hosted signaling URL is **not required** by this design.
6. Guest approval, session permissions, and local microphone consent remain independent checks. A successfully created session or broker revocation does **not** by itself prove a connected or terminated WebRTC peer.

### Recommended first public user flow (proposed product decision)

- **Host:** open CaptureLink, connect to Xbox, choose **CaptureLink Online**, and sign in to a CaptureLink Online identity provider using the system browser *only if not already authenticated*. This sign-in authorizes **hosted signaling usage**; do not submit the user's Xbox service tokens to the CaptureLink backend.
- **Guest:** install CaptureLink, select **Join**, paste an unpredictable one-use invitation code, supply an *unverified* display name, and wait for explicit host approval. **No CaptureLink account required for this initial guest path.**
- **Manual mode:** select **Manual P2P** and exchange the existing `CAPTURELINK-SESSION-V1:` offer/answer locally/out-of-band, whether or not `signal.capturelink.io` is reachable.

The owner's *host-login-required versus anonymous-hosting* choice is still an explicit product decision. The above design chooses authenticated hosts provisionally because unrestricted anonymous session creation on an operator-funded server is abusable. Anonymous guests are deliberately narrower: a one-use, 256-bit invitation alone authorizes a **pending** join request, not viewing or control.

## 2. Verified source baseline — preserve these seams

| Current source | Evidence and implication |
| --- | --- |
| `services/signaling/src/pilot-admission.mjs` | `createPilotAdmission()` accepts **2–64** pre-issued installation credentials with 43-char bearer tokens; digest registry and revocation are in memory. **No automatic enrollment.** |
| `services/signaling/src/pilot-runtime.mjs` | Private Linux runtime loads a protected, static config and binds only to `127.0.0.1`; operator-run pilot is not a public-auth service. |
| `services/signaling/src/server.mjs` | Pilot checks `X-CaptureLink-Admission` on every non-health route, including `POST /v1/join`; separate role-specific host/guest session bearer tokens guard sessions. One-use invite, pending join and host approval already exist. |
| `services/signaling/src/client.mjs` | Main-process `RemoteSignalingClient` pins HTTPS origin and rejects redirects; it always attaches the pre-issued 43-char installation admission credential for remote requests. |
| `src/main/ux3c3d-pilot-enrollment.mjs` | Windows `safeStorage` protects the manually imported long-lived token, pinned to `https://signal.capturelink.io`; there is no automatic identity flow. |
| `src/main/index.ts` and `src/main/hosted-signaling-bridge.mjs` | Main-only client selection and IPC boundary exist; renderer gets safe `local/remote/unavailable` mode, invitation codes and SDP envelopes, **not admission/session bearer secrets**. |
| `src/renderer/src/hosted-session-ux.ts` | The original manual UX2 flow is moved intact into a fallback `<details>` element; some copy still incorrectly says 'local' for the remote pilot. |
| `services/signaling/src/protocol.mjs` | Existing `CAPTURELINK-SESSION-V1:` WebRTC envelope validation and permission schema should be reused, not rewritten. |
| `docs/CAPTURELINK_UX3C2_PILOT_BROKER_SECURITY.md` | The pilot's server-side credential revocation cannot force an established media peer to disconnect; online public release needs a separate stop-sharing safety gate. |

**Source-evidence limitation:** The 17-file intake excludes complete signaling/desktop test suites, `package-lock.json`, Windows CI workflow, deployed Caddy configuration, production service unit and the running VPS configuration. Those must be included in the next implementation audit. User-provided live two-computer acceptance is valuable, but does **not** replace those missing artifacts or unperformed different-network/media-regression gates.

## 3. Transport and trust boundaries

```text
Public CaptureLink Electron app (trusted main process)
  |-- System-browser OAuth Authorization Code + PKCE (host only)
  |      -> chosen identity provider; no shared client secret
  |
  |-- HTTPS /v2 authenticated hosted signaling (default)
  |      -> operator TLS edge -> independently deployable V2 auth/signaling service
  |      -> identity validation, invitation approval, SDP/ICE handoff
  |      -> does NOT carry gameplay/video/voice/controller payloads
  |
  |-- Manual UX2 offer/answer (user-selected fallback)
  |      -> no CaptureLink Online authentication or network dependency
  |
  +-- existing WebRTC coordinator (same in both modes)
         -> peer-to-peer media/control when possible; separate TURN if needed

Existing accepted /v1 private-pilot broker and credential files:
  preserved, pinned, and deployed separately until explicit migration/retirement.
```

Avoid conflating **Xbox sign-in** with **CaptureLink Online sign-in**. Authorization to use the operator's service must be issued by an appropriate identity provider/server, never inferred from possession of an arbitrary client-generated device ID or reusing an Xbox resource token for the wrong audience.

### Token classification

| Credential | Issuer / use | Storage | Sharing |
| --- | --- | --- | --- |
| OAuth public client ID | Registered with auth provider | In public code is acceptable | Public |
| OAuth code verifier, state, nonce | Generated per login in main process | Memory during flow | Never renderer/backend except required token exchange |
| Host access token | Trusted identity provider or backend, scoped to Online API | Main memory; refresh material OS protected if provider supports it | HTTPS to approved audience only |
| Installation identifier | Backend after authenticated registration | Local metadata | **Not** an authentication secret |
| Session host/guest bearer tokens | Versioned signaling backend | Main process, session memory | Never logs, renderer, URLs or screenshots |
| Invitation code | Backend, random 256-bit, one use | Main UI displays it for deliberate sharing | Only intended friend; no telemetry/query strings |
| Server signing key / OAuth confidential secret | Server or managed identity provider | Operator secret store | **Never** in public repo/client |

Use system-browser login and PKCE S256; exact registered callback URI, state/nonce transaction validation, short access lifetime, validation of issuer/audience/expiry, account and device revocation policy, and secure refresh rotation where supported. These controls follow RFC 8252 and RFC 9700. Do not invent a bespoke password system merely to avoid an identity provider.

## 4. Proposed API v2 — independent of the accepted v1 pilot

**All routes are proposals, not implemented endpoints.** Preserve the existing binary-compatible `/v1` protocol until a separate deployment gate approves retirement. New `/v2` service must be offline-testable in a private loopback test harness; exposing it through Caddy is a separate change.

### Authenticated installation registration (optional public profile bookkeeping)

`POST /v2/installations` — requires a validated host **user** access token.

Request example (public metadata only):

```json
{"clientVersion":"0.2.x","installationPublicId":"UUID generated once per app install"}
```

Response example:

```json
{"installationId":"opaque server-issued id","status":"active"}
```

**Policy:** `installationId` is an index/metadata handle and is never sufficient to authenticate. Registration must require authenticated user context, unique ownership, bounded installs per account, and a revocation path. Server-side source of truth is persistent and not the in-memory pilot digest registry. Installation registration is not necessary to allow a guest to redeem a private invitation.

### Create an invitation — authenticated host only

`POST /v2/sessions`, `Authorization: Bearer <scoped host access token>`

```json
{"permissions":{"watch":true,"voice":false,"controller":false,"controllerMode":"shared"}}
```

Server: validate **issuer, audience, expiry, account status and permissions**, apply owner/session quotas, create one random 256-bit code and a session-scoped host capability. Never accept a public app-embedded shared secret. Response (illustrative):

```json
{"version":2,"sessionId":"<uuid>","hostSessionToken":"<opaque 256-bit secret>","inviteCode":"<opaque 256-bit secret>","inviteExpiresAt":0,"sessionExpiresAt":0}
```

Actual expiry values are timestamps, not zero; token strings above are placeholders only. Preserve the pilot's starting limits of **15-minute invite TTL**, **3-hour max session lifetime**, **one guest**, and **host-approved media permissions** unless the product owner changes them in a reviewed policy.

### Request to join — invited guest, no CaptureLink account

`POST /v2/join`, no account credential, HTTPS only, body:

```json
{"inviteCode":"<opaque 256-bit secret>","displayName":"Unverified Guest"}
```

Response: bounded pending state with `sessionId`, `guestId`, **guestSessionToken** and status `pending`. The guest token grants permission to **poll pending/approved/rejected state only** until the host approves; no SDP/ICE payload and no media before approval. The server must rate-limit unauthenticated joining at the trusted edge and per invitation fingerprint, not only the proxy's shared socket IP. Return uniform invitation error responses to reduce probing signals; keep codes out of logs.

### Session operations — role-bound capabilities

Keep equivalent validated actions under `/v2/sessions/{uuid}`:

- `GET` status (host or guest session capability; guest sees only its own state).
- `POST /approve` and `/reject` (host only, matching pending `guestId`, expiry checked).
- `POST /messages` and `GET /messages?after=n` (after approval; direction `invite` host -> guest, `response` guest -> host; existing `CAPTURELINK-SESSION-V1:` envelope schema remains unless deliberately versioned).
- `POST /revoke` host, `POST /leave` guest, short-lived session capabilities on every call.

Server must bind the host session to the authenticated owner and enforce current account/installation revocation on **every state-changing operation**, not just creation. It must remove server-side session state when access is revoked or expires. **This does not terminate an already-negotiated peer connection**: local session end and peer teardown must be verified independently prior to release.

Prohibit publicly writable session creation, arbitrary role claims, sending media payloads through signaling, signing-server selectors provided by renderer, or guest approval without host action.

### Illustrative error policy

- `401`: invalid/expired host identity or session capability; never downgrade silently.
- `403`: valid credential, wrong role, disabled/revoked account or permission.
- `404` (uniform invitation message): invalid/expired/reused invitation, as applicable.
- `409`: conflicting pending join/approval replay/double send.
- `413`: payload too large; `429`: rate limit/quota; `503`: service temporarily unavailable.
- No OAuth token, raw exception, SDP/ICE payload or IP address in **error responses or logs**; the authorized signaling messages endpoint must still return the intended SDP/ICE envelope to the approved peer.

## 5. Abuse prevention and privacy gates

1. **Public v2 edge:** TLS, exact Host routing, no universal CORS, validated Content-Type/size/timeouts, anti-bot and rate limiting for anonymous join. The pilot expressly rejects forwarded headers; any new trusted-client-IP normalization must be reviewed *separately*, only from the private reverse proxy, and must not inherit a client's arbitrary forwarded claims.
2. **Resource budgets:** per verified account, installation, session, invitation and global concurrency/request/memory quotas. Do not blindly lift the v1 12-session cap/64-credential bound and declare production capacity.
3. **Identity and session lifetime:** short-lived access tokens, revocation and refresh lifecycle, strict account scopes, expiring one-use invitations, session replay resistance, persistent account/installation state and recoverable outages. Server process restart may terminate transient invitations under an explicitly documented policy.
4. **Transport integrity:** canonical HTTPS origin, no redirects carrying credentials, normal certificate checks, no HTTP downgrade, no renderer-provided endpoint, bounded JSON and read-timeouts.
5. **Data minimization:** signaling service may see SDP/ICE and network metadata; hold it transiently, suppress payload logging, do not collect media/controller traffic, define logs/retention/privacy notice before production.
6. **Shutdown safety:** best-effort broker close is not proof the remote WebRTC peer stopped receiving gameplay. Local stop and stale-permission behaviors require separate acceptance.
7. **Supply chain and license:** npm reported 45 advisories (41 moderate, 4 high) in the pilot environment; review actual dependency paths/severity before a public release, not an unreviewed force-upgrade. Confirm an appropriate public repository `LICENSE` and third-party obligations in the complete repo; `package.json` setting `"private": true` only prevents npm publishing and does not itself grant an open-source license.

## 6. UI behavior — deliberate choice, no secret-bearing IPC

**In regular installation:**

- Friend screen presents **CaptureLink Online — Recommended** and **Manual P2P — No CaptureLink server**.
- Online host with no valid account: `Sign in to use CaptureLink Online` (system browser). Guest can redeem an invitation without account signup.
- A service outage: `CaptureLink Online is unavailable. Try again or choose Manual P2P.` No silent fallback, and don't erase valid local sign-in state because of a transient outage.
- Auth failure, invalid TLS, revoked account: explicit relevant error and explicit manual option; do not misrepresent `local`/`remote` or reuse generic 'Local signaling unavailable' copy.
- The manual UX2 offer/answer flow continues to use the existing WebRTC coordinator and needs neither the app's hosted API nor an Xbox account for spectators.
- Renderer receives status, safe error code, invite code intended to be shared and SDP envelope when necessary. It never receives OAuth refresh/access tokens, admission tokens or session bearer credentials.

The currently enrolled `/v1` pilot stays in operator/test-only mode until a tested migration path retires it.

## 7. Migration and rollback (ordered gates)

| Gate | Change | Rollback | Must be demonstrated |
| --- | --- | --- | --- |
| G0: Document/source review | This RFC and exact intake baseline only | No executable change | Source/manifest clean, owner accepts auth model |
| G1: Hermetic contract | Add *new* public auth policy module, mock identity verifier, tests (no listener/ports) | Revert new files | Reject forged/expired/wrong-audience host credentials; guest cannot create |
| G2: Offline v2 broker | New v2 routing/service in isolated harness; v1 untouched | Disable v2 fixture | Invite single-use, host approval, replay/rate-limit/revoke/cross-user abuse tests |
| G3: Windows main adapter | Feature-gated Online provider with OS-protected auth; fallback explicit | Turn feature gate OFF | No secrets through renderer/CLI; manual unmodified; failures fail closed |
| G4: Private staging | Separate process/port, private test auth provider, HTTPS staging origin, scoped operator test accounts | Stop staging v2 only | End-to-end host/guest, TLS, broker restarts, revoke safe semantics |
| G5: Limited public beta | Explicit reviewed v2 TLS routing + auth service, quotas, monitoring/privacy | Route off /v2, leave /v1 pilot unchanged | Security review, public-onboarding and abuse test evidence |

**Not approved here:** changing VPS, opening ports, modifying `/v1` pilot credentials or deleting `CAPTURELINK-SESSION-V1` handling, choosing an IdP unilaterally, or claiming cross-network/TURN/media-revocation gates passed.

## 8. Minimum acceptance test matrix

**Identity/security:** unauthenticated host creation denied; forged signature denied; expired access denied; wrong issuer/audience denied; untrusted redirect/TLS denied; registration spoofing/duplicate owner denied; account revocation blocks new and existing host-side mutations; no application-wide secret anywhere.

**Guest:** unknown/reused/expired invitation denied uniformly; concurrent joins produce exactly one pending guest; guest cannot approve or write host offer; no SDP before approval; guest can join without CaptureLink account; IP/proxy spoof cannot lift anonymous quota.

**Roles/permissions:** only host approval can change pending to approved; guest attempts to escalate controller/voice denied; fixed permissions; only correct direction of offer/answer; stale session tokens denied; no cross-session or cross-account actions.

**Resources/operations:** bounded bodies/responses, active-session quota, message memory, request timeouts, backend restarts, cancellation, rate-limit isolation, no credential/SDP logs, degraded auth provider and broker do not silently route to insecure/local alternatives.

**UX/regressions:** existing UX2 manual offer/answer works without an online server; localhost dev mode still works for explicit dev tests; Xbox token storage and installed app profile untouched; Windows `safeStorage` failure does not persist plaintext; host watches before enabling controller/voice; status reflects actual mode.

**External live tests:** authenticated host and invite-only guest on separate installations, independent invite/approve/media tests, disconnect and media-teardown safety, network/TURN where applicable. These are not satisfied by contract tests.

## 9. Next exact task

Execute **UX3F-1: provider-neutral offline authentication-policy seam**, scoped by `CAPTURELINK_UX3F1_ENGINEERING_TICKET.md`. Do not make a live deployment change in that ticket.

## External standards (design reference, not implementation evidence)

- [RFC 8252 — OAuth 2.0 for Native Apps](https://www.rfc-editor.org/rfc/rfc8252): system-browser native login, public client and PKCE.
- [RFC 9700 — OAuth 2.0 Security Best Current Practice](https://www.rfc-editor.org/rfc/rfc9700): modern token/authorization flow safeguards.
