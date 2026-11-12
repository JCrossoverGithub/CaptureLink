# CaptureLink UX3F-1 — Offline Authorization Policy Interface

**Status:** implementation candidate, offline-only; no `/v2` router or production deployment.\
**Baseline:** `a1a83eab69ac893a47c2a6d977e0106a2c2d34c2`.\
**Scope:** `services/signaling/src/public-authorization-policy.mjs`; tests and source guard.\
**Approvals still required:** owner decision on host account sign-in, provider selection, the v2 durable store, and a separate staged-rollout gate.

## Trust assumptions and call contract

`createPublicAuthorizationPolicy(config)` accepts **only trusted server-provided callbacks**. Never create its callbacks from client JSON, untrusted headers, a renderer IPC object, or a user-supplied URL. The new policy module has no listener, storage, fetch, account database, credential files, operator configuration, or deployment side effects.

Required arguments:

| Argument | Server-side contract |
| --- | --- |
| `expectedIssuer`, `expectedAudience` | Exact expected host identity token claims. Nonempty public strings (not secrets). |
| `verifyHostAccessToken(token)` | Authenticate signature/issuer/expiry and return trusted `{iss,aud,sub,exp,scope,nbf?}` or null; `exp`/`nbf` UTC seconds; required scope `sessions:create`. This provider adapter is **not implemented** by UX3F-1. |
| `verifySessionCapability({sessionId,token})` | Constant-time lookup of server-issued opaque capability against persisted digest and revocation state. Returns `{role:'host',sessionId,ownerSubject,expiresAt}` or `{role:'guest',sessionId,guestId,expiresAt}`, where `expiresAt` is **UTC milliseconds**, or null. Never take `role` from request body. |
| `redeemInvitation(inviteCode,guestName)` | Atomically check and consume a one-use invitation and persist a **pending** guest; return `{sessionId,guestId,expiresAt}` (milliseconds) or null. The future service must also issue a separate guest bearer credential. **This offline module does not mint bearer secrets.** |
| `loadSession(sessionId)` | Returns current authoritative snapshot `{id,ownerSubject,expiresAt,inviteExpiresAt,revoked,guest:{id,status}? ,sentInvite,sentResponse}` (timestamps milliseconds) or null. The snapshot must come from trusted persistence, not the client. |
| `isHostActive(subject)` | Returns exactly `true` only for currently authorized account; fail closed on unavailable/exception. Revoked hosts invalidate guest's access as well. |
| `now()` | UTC epoch milliseconds (injectable for hermetic tests). |

The policy doesn't attempt OAuth JWT signature verification or specify an identity provider. **A successful fake verifier in tests is not proof of real production authentication.** Real verifier adapters require strict signature and algorithm validation, issuer/audience binding, token lifetime, revocation and appropriate caching. The source-of-truth persistence and atomic invitation redemption arrive under **G2**, not this ticket.

### Principal formation

- `policy.anonymous`: an opaque, unprivileged principal.
- `await policy.authenticateHost(accessToken)`: returns an opaque `verified-host` principal only after the trusted verifier and exact issuer/audience/expiry checks pass. Token is neither stored nor returned.
- `await policy.authenticateSession(sessionId, bearer)`: returns opaque `session-host` or `session-guest` from the **trusted capability verifier**, never a role submitted by a caller. Session capability bearer isn't stored in the principal.
- `await policy.requestPendingJoin({principal:policy.anonymous,inviteCode,displayName})`: calls the injected *atomic* redeemer, checks resulting authoritative state is pending, and issues an opaque `session-guest` principal for this request. It never approves the guest. An unverified name is a display label, not an identity claim.

The returned principal object contains only a public `kind` string; actual bindings live in a private per-factory `WeakMap`. A copied, forged, or cross-policy principal is denied. This is **in-process authority separation**, not a substitute for validating network tokens or secure HTTP transport. The policy instance must be bound to one trusted v2 server adapter.

### Authorization

`await policy.authorize({principal,operation,sessionId?,guestId?,kind?})` returns `{allowed,status,code}`; no exception text, credential, session payload, SDP or IP is included. The router must re-read server-side state before each operation and apply **HTTP parsing, body size/timeout limits, quotas, CSRF/origin rules where relevant, message envelope validation, and atomic state updates** separately.

| Operation | Verified host | Session host | Session guest | Anonymous |
| --- | --- | --- | --- | --- |
| `create` | Yes, `sessions:create`, active account | No | No | No |
| `requestPendingJoin` | No | No | No | Valid, one-use invite only; stays pending |
| `snapshot` | No | Yes | Yes, own session | No |
| `approve`, `reject` | No | Matching pending guest before invite expiry only | No | No |
| `read-messages` | No | After guest approval | After guest approval | No |
| `write-message` | No | Once, `kind:invite`, after approval | Once, `kind:response`, after host invite | No |
| `revoke` | No | Yes | No | No |
| `leave` | No | No | Yes | No |

All session operations check current session expiry, revocation and active host ownership. Guest authority is bound to exact session and guest ID. Revocation of an *already running WebRTC peer connection* still needs desktop-side teardown; this module does not control media.

### Error categories (safe to expose)

| Code | HTTP status | Meaning |
| --- | --- | --- |
| `unauthorized` | 401 | Unknown, stale, forged, cross-session, expired or revoked principal |
| `forbidden`, `host_only`, `guest_only`, `wrong_direction` | 403 | Authenticated but not authorized for requested role/action |
| `insufficient_scope`, `account_inactive`, `not_approved` | 403 | Missing scope, inactive host account, or guest not approved |
| `invitation_unavailable` | 404 | Invalid, expired, consumed or unavailable invite; same response for all |
| `invalid_display_name` | 400 | Display name fails normalization/length rules |
| `no_matching_pending_guest`, `message_already_sent`, `awaiting_host_invite` | 409 | Stale approval, replay or signaling sequence violation |
| `allowed` | 200 | Authorized operation; perform atomic mutation in service adapter |
| `pending` | 202 | Invitation atomically consumed; guest remains pending until host approves |

A policy `allowed` decision **is not a transaction**. If another request mutates or revokes the session between checking and committing, the production adapter must abort rather than act on stale authorization (lock or compare-and-swap). Invitation redemption and approval must be atomic; retries must not turn denied guests into approved peers. Timing, body parsing, SDP direction, media-control payload restrictions, anti-enumeration, per-account rate limits, capability secret hashing, and encrypted token handling are G2/G3 concerns.

## UX3F-1 verification

Run from new worktree on Node **>=24.19.0**:

```bash
node --test services/signaling/test/public-authorization-policy.test.mjs
node scripts/ux3f1-boundary-source-smoke.mjs
node --test services/signaling/test/ux3c3d-enrollment.test.mjs services/signaling/test/pilot-server.test.mjs services/signaling/test/remote-client.test.mjs
npm run typecheck
npm run build
git diff --check
git status --short
```

Also run the repository's **complete** signaling, desktop smoke and Windows/Linux CI suites before PR. The static boundary smoke compares file hashes from the verified UX3F-0 source intake; it is intentionally scoped to this exact baseline and must not be removed to hide a change.

**No deployment or externally accessible public registration is authorized by this ticket.**
