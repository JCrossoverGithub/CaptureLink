# CaptureLink UX3c-2 — Private-pilot broker hardening handoff

**Status:** security candidate, **NOT deployment authorization**.
**Accepted baseline:** `c2bc1cbf881462dfa568023466db63b642a86432` (PR #12 squash merge).
**Scope:** opt-in server-side admission and bounds. No network deployment, secret provisioning, public DNS, or desktop origin toggle.

## Architecture and separation

`createSignalingServer()` and the existing `node services/signaling/src/server.mjs` CLI remain the **UX3b1 localhost prototype**, bound to `127.0.0.1`. It accepts the original client contract; current local tests remain unchanged.

`createPilotSignalingServer({ installations, limits?, now?, maxSessions? })` is a **separate exported, integration-only factory**. There is **no pilot CLI entry point** or environment toggle. Both factories bind to `127.0.0.1`; neither may be exposed directly to the internet. Any future TLS reverse proxy and deployment require separate security/ops approval (UX3c-3).

The pilot factory refuses startup without **at least two distinct installation IDs and 43-character base64url admission credentials**. An operator would provide these secrets through a future dedicated provisioning/deployment process; **do not put them into source code, frontend bundles, public releases, GitHub Actions, screenshots or process arguments**. Tests use new random credentials held only in process memory. The admission registry stores SHA-256 digests, not the raw input tokens. The caller remains responsible for protecting its initial plaintext configuration.

All pilot session API operations require `X-CaptureLink-Admission: Bearer <installation token>`. The independent `Authorization: Bearer <session token>` is additionally required for session-specific operations. An invitation code alone never authorizes host/guest controls. The broker binds host and guest session tokens to the installation ID that created/joined the session. Same-installation join is disallowed in the pilot. Guest display names remain unverified. `GET /healthz` returns only `{"status":"ok"}` without credential requirements.

The pilot **never trusts forwarded client IP metadata** and returns `forwarded_headers_forbidden` if sent `Forwarded`, `X-Real-IP` or any `X-Forwarded-*` header. A future reverse proxy must **strip these headers entirely** before forwarding to the private listener; relying on forwarded client IPs requires a new independently reviewed design. Authenticated quotas instead use per-install ID, not shared proxy socket IP. Invalid credential attempts are separately capped by the local socket IP; an edge must protect that public endpoint against unauthenticated traffic and distributed abuse. No CORS origins are allowlisted for the pilot (native clients only).

## Hard resource limits

| Budget | Default | Scope / notes |
|---|---:|---|
| Global active sessions | 12 | May only be reduced by constructor |
| Active sessions hosted per installation | 4 | Includes pending invitations |
| Session creation | 6/min | Per installation |
| Invitation joins | 12/min | Per installation; code guesses retain per-code cap |
| Snapshot + message polling | 300/min | Per installation, not per socket IP |
| Signaling message writes | 16/min | Per installation |
| Approvals / rejections | 24/min | Per installation |
| Leave / revoke | 24/min | Per installation |
| Other API requests | 12/min | Per installation |
| Authenticated global requests | 1,200/min | All admitted clients |
| Session-specific operations | 360/min | Shared by host and guest after role authorization |
| Failed admission attempts | 40/min | Per local socket IP; separate from admitted traffic |
| Health checks | 120/min | Per local socket IP; no session metadata |
| Retained signaling bytes | 12,000,000 | Global; additional 2 × `MAX_BODY` per session |
| Incoming JSON body | 1,200,000 bytes | Existing protocol cap |
| HTTP request / headers timeout | 15s / 10s | Pilot only |
| Concurrent TCP connections | 64 | Node server maxConnections |

All overrides for pilot rate/memory budgets are **reductions only**. Request counters and live signaling state are in memory and reset on process restart. Stale invitations are purged; message bytes are reclaimed on removal. There is no long-poll endpoint in the current protocol: clients use periodic GET requests. Do not claim a long-poll concurrency budget has been implemented.

## Revocation and failure semantics

`app.revokeInstallation(id)` is an **in-process operator method**, not an HTTP endpoint. It disables the credential and removes every session in which that installation is host or guest. Revoking a credential while an HTTP JSON body is still arriving cannot authorize the subsequent session mutation. Restarting the broker intentionally invalidates all session state. Tests verify that revoked guests cannot continue polling or exchange signaling.

**Critical limitation:** Removing a signaling session does **not** remotely terminate WebRTC peers that already exchanged SDP. A crashed/offline client may continue sending media after server-side revocation; active media teardown requires client signaling/heartbeat/lease design and live testing in UX3c-3/UX3c-4. Do not claim broker revocation immediately stops Xbox/controller/voice sharing. Server-side revocation is not yet sufficient for public use.

## Gates and tests

- `node --test services/signaling/test/pilot-server.test.mjs`: admission, identity binding, cross-install token theft, approval, exchange, same-IP polling, separate quotas, spoofed proxy headers, memory/session limits, credential revocation, partial request race, expiry, restart, malformed requests, brute-force limits, competing guests, simulated remote HTTPS client contract.
- `node scripts/ux3c2-broker-source-smoke.mjs`: separate factory, loopback-only, desktop client still local by default, CI coverage.
- Existing `signaling.test.mjs`, `client.test.mjs`, `desktop-bridge.test.mjs`, `guest-name.test.mjs`, `remote-client.test.mjs` and Windows Electron/UX/recording regression suite must still pass. Tests run against loopback and a simulated HTTPS adapter; **they do not validate a real public TLS edge or NAT traversal**.
- Reviewed PR, zero secrets in committed source, Windows CI green, and exact accepted main SHA required before UX3c-3.

**UX3c-3 outstanding:** create dedicated protected TLS deployment and credential issuance/revocation processes; pin approved DNS/TLS origin in trusted main; edge filtering and unauthenticated defense; service monitoring/privacy retention; reconnect/failure behavior; two-PC signaling tests. **UX3c-4 outstanding:** actual media, controller and microphone tests through separate networks, TURN if needed, disconnection/revocation safety.
