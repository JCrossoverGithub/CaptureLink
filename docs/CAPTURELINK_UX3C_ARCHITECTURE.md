# CaptureLink UX3c — Secure Remote Invitations
## Architecture Decision, Threat Model, and Engineering Execution Charter

**Version:** 0.1 — engineering proposal, not deployment approval
**Prepared:** November 12, 2026
**Accepted source baseline:** `1a10f0d538431cd75f4eb6ba2c56e7ca069bf878` (PR #11 squash merge)
**Working branch:** `feature/ux3c-secure-remote-signaling`
**Working directory:** `C:\Users\thede\projects\CaptureLink-ux3c-hosted`
**Current status:** UX3b1 accepted and CI green. UX3c has no implementation or deployment yet.
**Scope restriction:** Do not expose the UX3a localhost broker to LAN or the public internet. Do not alter other CaptureLink worktrees.

### Basis and confidence

The user-provided Git and GitHub CLI output establishes the exact accepted merge commit, clean UX3c worktree, and post-merge CI success. The implementation review below is grounded in the available audited UX3b1 source and follow-up patch material (signaling `server.mjs`, `client.mjs`, `protocol.mjs`, Electron bridge, renderer UX, UX3a/UX3b0 docs). These source snapshots are not an independent read of the user's live UX3c worktree; the implementing engineer must verify each identified function and file at the accepted baseline before editing. Design recommendations are marked as proposals, not accepted or deployed capabilities.

## 1. Decision and purpose

**Goal:** A friend on XLAPTOPX, or another computer/network, can install CaptureLink, paste a private invitation, enter a guest-chosen name, request host approval, and—if approved—receive game video/audio and use only the controller/voice capabilities explicitly granted by the host, without either user manually starting a signaling broker.

**Decision:** Retain UX3b1 as the local/manual fallback. Add an independently selected **remote HTTPS signaling client** with a strictly defined service origin, a scoped broker admission mechanism, and a hardened remote service. Preserve the existing UX2 WebRTC transport/coordinator and permissions semantics until cross-network evidence demonstrates a need to change them. The first implementation phase is client transport/configuration work with simulated endpoints. No live service will be created in that phase.

**Non-goals of initial UX3c:** public open registration; short six-digit join codes; persistent social accounts; media transcoding; storing Xbox authentication at the broker; automatically approving guests; automatically enabling guest microphone; rewriting the streaming transport; guaranteeing NAT traversal; using a website droplet as an unreviewed shared application backend.

## 2. Verified implementation boundary (existing UX3b1 snapshot)

| Component | Observed contract | Risk for remote use |
| --- | --- | --- |
| `services/signaling/src/client.mjs` | `LocalSignalingClient` accepts only `http://127.0.0.1:<port>`; bearer tokens private in instance; redirect errors; request timeout; JSON and schema checks | Remote HTTPS must be a separate, explicitly permitted route; do not loosen localhost pinning to arbitrary endpoints |
| `services/signaling/src/server.mjs` | Node HTTP service bound to `127.0.0.1`; in-memory sessions/invitations; `req.socket.remoteAddress` rate limiting; explicit host approval; one-use invitations | Cannot simply bind `0.0.0.0`; proxy identity, abuse, availability and operations are not production-ready |
| `services/signaling/src/protocol.mjs` | Strict UX2 envelope validation; 15-minute invitation TTL; 3-hour session cap; guest name normalization | Broker may temporarily handle SDP/ICE network addresses; no public identity is verified |
| `src/main/hosted-signaling-bridge.mjs` | Bearer tokens remain in Electron main; renderer receives sanitized status and required signaling envelope | Do not move bearer credentials or remote service admission credentials into renderer IPC/DOM |
| `src/renderer/src/hosted-session-ux.ts` | Host approval, guest name, mic consent, end session, UX2 manual fallback; periodic polling | UX text and error handling must distinguish local from remote and signaling from actual P2P connectivity |
| `UnifiedSessionCoordinator` (UX2) | Controls actual controller/voice/video sessions and negotiation | Broker acceptance or SDP round-trip is not proof that media, audio, input, or microphone work |

### Important capacity and proxy observation

In the reviewed server, rate limiting uses a per-socket-address bucket of **100 requests/minute**. Two clients polling once every approximately 650 ms could generate about **185 requests/minute** before other API calls (calculation: `2 * 60 / 0.65`). This is not a measured production load, but it exposes a plausible failure even when host and guest share a NAT. Behind a TLS reverse proxy, the application may see the proxy address for all users, causing one global throttle. **This must be redesigned before remote acceptance.** A trusted proxy boundary and per-session/per-credential quotas are preferable; do not directly trust arbitrary `X-Forwarded-For` headers.

## 3. Proposed logical architecture

```text
Host CaptureLink (Electron main)                    Guest CaptureLink (Electron main)
   | private, explicitly selected HTTPS                  | private, explicitly selected HTTPS
   | bearer role + installation admission                | bearer role + installation admission
   v                                                      v
       HTTPS/TLS edge: signal.<approved-domain> (candidate, not provisioned)
           | strict host, TLS, body limits, controlled proxy headers
           v
       Remote signaling service (single-region pilot)
           | invite create / join / approval / exchange / revoke
           | role-checked tokens, bounded state and TTL
           v
       Short-lived session store (single-process pilot, fail-closed on restart)

Host  <------ WebRTC ICE/DTLS-SRTP direct or TURN relay ------>  Guest
           (separate from the signaling backend)
```

The initial managed service should be isolated from the public marketing website process, even if hosted by the same provider. Evaluate a dedicated small VPS/container/service with a TLS proxy, explicit firewall, separate unprivileged runtime and deployment pipeline. Domain choice, hosting provider and cost remain unapproved decisions.

## 4. Security invariants — required

1. **Local client remains local.** Continue rejecting non-loopback origins in `LocalSignalingClient`. A remote transport must enforce `https:` with a precise configured hostname/origin and reject embedded credentials, paths, queries, fragments, redirects, HTTP downgrade and insecure certificate validation. No "accept any URL" escape hatch in normal builds.
2. **Admission is separate from an invitation.** A bearer invite capability grants only the right to request approval; it is not a registered identity. For a limited pilot, issue unique operator-managed per-install admission credentials securely (not embedded in shipping binaries), or select and implement an equivalent audited identity mechanism before public service exposure. Revoke credentials individually. Public launch requires a defined identity/abuse strategy.
3. **Host permission authority.** Host decides `watch`, `voice`, `controller`, and `controllerMode` before creating the invitation. Guest cannot increase permissions. Approval occurs before the broker relays UX2 SDP. Guest display names remain explicitly labeled **unverified**.
4. **Secret isolation.** Session/broker/admission bearer material lives in the trusted Electron main process and in a suitable OS-secure store only if persistence is explicitly needed. No bearer material in URLs, renderer IPC, DOM, ordinary logs, telemetry or crashes. Invitation secrets are deliberately user-shareable but should never be included in diagnostic screenshots.
5. **Guest consent.** Local microphone is disabled by default and requires affirmative guest consent, independent from host voice permissions. Guest-only voice uplink must not depend on the host granting desktop microphone permission.
6. **Session and replay control.** One-use, high-entropy invitations; role-restricted API operations; expiry and revocation; bounded message count/size; offer-response session binding. Do not replace the current 256-bit invitation with a short code until a separate security design is accepted.
7. **No false connectivity.** States must distinguish invite created, guest pending, host approved, signaling exchanged, ICE connected, media flowing, input active, microphone active and stopped. Broker success does not mean Xbox video/audio works.
8. **Fail closed.** Unknown endpoints, invalid TLS, missing admission, failed authorization, stale broker, invalid session, oversized SDP or rate limit => no token forwarding or automatic fallback to insecure transport. Manual UX2 fallback remains an explicit user action.
9. **Revocation has two layers.** Broker revoke prevents further signaling, but an already connected P2P session must also be torn down by each client. Test local leave during broker outage and peer disappearance. Do not claim remote revocation is guaranteed when the guest is offline/malicious.
10. **Privacy.** Signaling payloads can contain ICE candidates and network addresses. No full SDP/ICE, host/guest tokens, name or public IP in routine logging; bound retention and redact server diagnostics. Document what the service can see before user release.

## 5. API and state design (proposal)

Preserve the current UX3a HTTP v1 payload schemas where feasible: `/v1/sessions`, `/v1/join`, `/v1/sessions/:id`, `/approve`, `/reject`, `/messages`, `/revoke`, `/leave`. Add versioned admission credentials independently of host/guest role tokens. Require the server to check **both** admission and role permissions where applicable.

**State machine:** `created -> pending -> approved -> offer_sent -> answer_sent -> negotiated` or `rejected/expired/revoked/left`. `negotiated` describes signaling only. Desktop-specific RTC/media states occur outside the broker and must be reported by the local UI, not asserted by server responses. Treat duplicates, retries, client restart and broker restart as explicit cases; don't silently auto-rejoin or auto-approve.

**Delivery model:** The existing ~650 ms repeated polling is acceptable for the local experiment but not a remote production assumption. Prefer bounded long polling with explicit authorization, request budget and timeouts for the controlled pilot; evaluate server-sent events or WebSocket only with additional lifecycle, origin and payload protections. Preserve at-most-once envelope acceptance and cursor/order semantics. Ensure network jitter and transient failures cannot duplicate an SDP offer or implicitly restore revoked access.

**Persistence:** For the first single-instance private pilot, in-memory state with clear "sessions lost on restart" UI is acceptable if deployment is non-public, capacity is capped and users can safely generate new invitations. A public/HA service needs a deliberate durable/TTL-backed design and testing; do not introduce a database merely because the localhost prototype has no persistence.

**Reverse proxy:** The edge owns public TLS and `Host` validation. Keep the Node service private to its network; trust proxy-supplied client identity only from an explicitly trusted connection and normalize it once. Do not directly expose the current listener or simply trust every `X-Forwarded-For`. Add per-install, per-role, per-session and global budget limits, plus resource caps for large envelopes and long polls.

## 6. WebRTC/TURN acceptance strategy

- Keep current completed-offer/completed-answer UX2 negotiation first. Check that all necessary candidates survive remote exchange and that the ICE gathering timeout is appropriate; do **not** assume trickle ICE is supported.
- Test actual `RTCPeerConnection.iceConnectionState`/connection-state transitions, selected candidate-pair type (`host`, `srflx`, `relay`), inbound/outbound bytes and media tracks. Record only sanitized aggregate diagnostics.
- Run host JPCMAIN and guest XLAPTOPX on distinct physical networks when practical, including one constrained/hotspot case. A LAN-only success is insufficient.
- Add TURN with time-limited issued credentials once direct/STUN testing demonstrates the need, then test relay fallback and failure. Restrict TURN allocation quotas and document bandwidth costs.
- Verify watch-only, shared controller, Player 2 controller, guest-only microphone, microphone denied, host disconnect, guest disconnect and broker outage; do not reuse a single "connected" flag for them all.

References: RFC 8445 (ICE, STUN, TURN), MDN WebRTC connectivity and ICE candidate-pair stats.

## 7. Threat model and mitigations

| Threat | Proposed prevention / acceptance evidence |
| --- | --- |
| Invitation guessing, theft, screenshots | 256-bit one-use codes, expiration, join throttling, redacted logs; never put code in URL query or telemetry |
| Malicious anonymous session creation | Per-install admission or equivalent, rate/volume quotas, global capacity ceilings, operator credential revocation |
| Host impersonation/social engineering | Host UI shows guest name as unverified; no identity claims; user manually verifies other party before approval |
| Role escalation or permission upgrade | Server checks role per operation; fixed permission snapshot; malformed request tests |
| Remote endpoint misconfiguration / HTTPS downgrade | Exact allowlisted HTTPS origin, redirect rejection, system TLS validation, no insecure fallback |
| Reverse-proxy header spoofing | Proxy-only ingress, trusted-proxy configuration, reject untrusted forwarding headers; integration tests |
| SDP/ICE/network address leakage | Redacted logs and errors; minimal transient state; no analytics with raw payload |
| Resource exhaustion / polling storm | Session quotas, admission quotas, backpressure/long-poll concurrency caps, request size/time limits |
| State loss during restart | Explicit session loss and safe re-invitation; no false active state on client |
| Revoke during active peer media | Both clients actively teardown media/controller/voice; test peer crash and offline cases |
| Different NAT/firewall environments | ICE state diagnostics; TURN with limited temporary credentials where required |
| Client/reverse-proxy compromise | Separate host from marketing site, least privilege, patched runtime, TLS, logs, deploy/rollback and incident playbook |

## 8. Implementation phases and independent acceptance gates

### UX3c-0: Architecture freeze (this document)

- [x] Confirm UX3b1 exact merge SHA and green post-merge CI from user logs.
- [x] Create isolated clean UX3c worktree at accepted baseline.
- [x] Identify current localhost endpoint and single-process backend boundaries in audited source snapshot.
- [x] Document proxy and polling budget hazards, trusted roles, identity gaps, and media gates.
- [ ] Source-owner reviews and accepts decisions about remote origin, pilot admission, deployment isolation, and failure semantics.
- [ ] On UX3c worktree, verify the latest on-disk source files match the reviewed contracts; amend discrepancies before code.

### UX3c-1: Secure remote-client transport boundary — **FIRST ENGINEERING TICKET**

**Goal:** Main process can select a *non-deployed*, precise HTTPS remote origin for hermetic tests, preserving `LocalSignalingClient` endpoint pinning and current local UX.

- [ ] Add a distinct remote client constructor/config adapter, not an arbitrary endpoint escape hatch in local client.
- [ ] Reject HTTP remote, userinfo, path/query/fragment, non-approved hostname, redirection, untrusted TLS and malformed remote JSON before any bearer is transmitted.
- [ ] Retain strict role separation, invite TTL and error sanitization. Keep bearer tokens within main; preload/renderer must not receive them.
- [ ] Add deterministic HTTP/TLS fixture tests (including redirect attempt to an attacker origin, cert failure, abort/retry and timeout), without external network calls or real credentials.
- [ ] Add feature gate OFF by default; local and manual fallback stay unchanged. No production endpoint added or enabled yet.
- [ ] All existing signing, UX/voice, typecheck, build and recording regressions pass on Windows CI.
- [ ] PR restricted to client/config/tests/docs, no server binds or deployment settings; review security-diff separately.

**Definition of done:** Tests prove remote host- and guest-side main-process client calls can exchange a signed-off HTTP v1 contract through a fixture while insecure origins are rejected. No real remote service is accessed or published.

### UX3c-2: Hardened broker in isolated integration environment

- [ ] Implement configured admission for private pilot and explicit credential revocation.
- [ ] Replace per-raw-socket-IP throttling with trustworthy proxy identity and per-install/session quotas; conduct shared-IP load test.
- [ ] Bound in-memory sessions, expiration, join requests, long-poll concurrency, payload bytes, total memory and shutdown drain.
- [ ] Add positive and abuse/malformed/unauthorized API tests. Ensure no secrets/IP/SDP in application logs or response errors.
- [ ] Prove restart, rejection, leave, revocation, expired invitations and host/guest races are safe.
- [ ] No public DNS change or external reachability until gated deployment review.

### UX3c-3: Limited remote deployment and desktop UX

- [ ] Dedicated isolated service + reviewed TLS edge + firewall/ingress + rollback path; distinct host from marketing site.
- [ ] Securely provision per-install admission for the two controlled pilot machines; no static shared key in distribution.
- [ ] Environment-specific enabled origin with configuration integrity and certificate validation.
- [ ] Clear UI copy: online invitation versus local/manual fallback, unverified guest, reconnect/lost-session behavior.
- [ ] Privacy disclosure, abuse contact and operator logs/alerts reviewed; no public rollout yet.
- [ ] Execute live two-PC signaling approval/rejection/end-session tests, including broker restart.

### UX3c-4: Actual remote WebRTC, TURN and go/no-go

- [ ] JPCMAIN <-> XLAPTOPX live video/audio across separate networks, measured by actual media/ICE counters.
- [ ] Shared Controller and Player 2 permissions verified independently.
- [ ] Guest microphone consent and guest-only uplink verified independently; no consent bypass.
- [ ] NAT-restricted test with TURN fallback if needed, plus bandwidth/cost controls.
- [ ] Post-disconnect and network-partition tests: no stale access and no misleading connected UI.
- [ ] Security review, CI green, operations/rollback review and documented deployment authorization.

## 9. Review questions requiring explicit decision before external deployment

1. **Pilot identity/admission:** How will uniquely issued installation credentials be provisioned and revoked? (Proposed: operator-managed private alpha, no baked-in universal secret.)
2. **Host name/hosting:** Which controlled HTTPS origin, isolated host and TLS operator will be used? (`signal.<approved-domain>` is illustrative only.)
3. **Session retention:** Is loss of all invitations on a pilot broker restart acceptable? If not, select a TTL state backend and idempotency rules.
4. **Transport policy:** Is direct-only first beta acceptable for validation, with TURN required before wider rollout? Define acceptance coverage.
5. **Privacy:** Which operational metadata and retention window are allowed? No raw SDP/ICE, bearer credentials or full IPs in normal logs.

## 10. Engineering change discipline

- Always start from the exact accepted SHA, not an earlier UX3b1 feature-branch commit.
- Make changes only in `CaptureLink-ux3c-hosted`; preserve experiments/other worktrees.
- Separate code review from deployment. A green test grants no permission to expose services publicly.
- Every security-relevant change needs tests demonstrating rejection as well as success.
- No tokens, ICE payloads, real invitations or Xbox secrets in patches, test fixtures or screenshots.
- Pin versions and inspect external dependencies before addition; don't run forceful dependency upgrades during this milestone.
- Preserve compatibility and give the user a safe, explicitly manual fallback on remote failure.

## Reference material

- Current available UX3b1 source snapshots: `services/signaling/src/{server,client,protocol}.mjs`; `src/main/hosted-signaling-bridge.mjs`; `src/renderer/src/hosted-session-ux.ts`; UX3a/UX3b0 engineering docs. Must be rechecked against actual UX3c worktree.
- [OWASP WebSocket Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html) — authenticated actions, origin rules, resource limits, log hygiene.
- [RFC 8445: ICE](https://www.rfc-editor.org/info/rfc8445/) — direct/STUN/TURN connectivity.
- [MDN WebRTC connectivity](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Connectivity) — candidate types and connectivity behavior.
- [MDN RTCIceCandidatePairStats](https://developer.mozilla.org/en-US/docs/Web/API/RTCIceCandidatePairStats) — selected path diagnostics.
