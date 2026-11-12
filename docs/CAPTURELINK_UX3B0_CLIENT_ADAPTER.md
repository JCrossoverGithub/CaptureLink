# CaptureLink UX3b0 — local signaling client contract (not a release)

**Base:** PR #9 squash merge, `13e427f30eb103d0a94d61c87b683459d4c56f66`.

## Scope

This stage introduces `services/signaling/src/client.mjs`, a standalone, secret-bearing Node client that **could be integrated into Electron's main process after IPC design review**. It does not change CaptureLink's UI, Electron main/preload code, Xbox Remote Play, controller or voice transports. **The existing UX2 manual invitation workflow remains authoritative and working.**

The headless adapter implements:
- Host: create broker session, present invite capability to an explicit UI callback, wait for pending guest, **ask host to approve**, send UX2 offer only after approval, wait for reply, and invoke `UnifiedSessionCoordinator.acceptResponse`.
- Guest: join using one-use code, wait for approval, receive UX2 offer, pass **explicit** local microphone-consent boolean to `UnifiedSessionCoordinator.joinInvitation`, send response.
- Event cancellation, request deadlines, read polling, sanitized API errors, no credential values in logger output, host revoke and guest leave.
- Enforced `127.0.0.1` HTTP endpoint only, no remote LAN/Internet configuration. Credentials stay in private class fields, never URLs.

## Acceptance tests

With Node 24.x in WSL Bash (no npm install required):

```sh
node --test services/signaling/test/client.test.mjs services/signaling/test/signaling.test.mjs
```

The adapter's tests use real localhost HTTP requests against the unchanged UX3a service plus mocked UX2 coordinators. They do **not** prove WebRTC connectivity. Required expected result: **29 passed, 0 failed** (12 client + 17 broker tests).

## Architecture boundary and remaining work

- **No actual Electron IPC or renderer integration in UX3b0.** Avoid passing host/guest bearer tokens or SDP/ICE into renderer DOM state, logs, telemetry, URLs, crash reports, or untrusted windows.
- UI must implement a genuine explicit host-approval affordance. An invitation's possession is not approval.
- `hostSession`'s `negotiated` result means the UX2 response was accepted. It does not imply media/audio/controller connectivity.
- UX2 voice permission remains distinct from the guest's local microphone consent; watch-only must not open a microphone.
- `clearLocal()` discards local credentials **without revoking** a broker session; normal teardown should call `end()` and also stop the underlying P2P transports. The broker cannot stop peer transport just by deleting signaling state.
- On network failure, `end()` is best-effort. Future durable brokers need stronger lifecycle/reconciliation semantics.
- The broker uses one-use 43-character secrets, not human-friendly short codes. No DNS/TLS, persistence, authentication to Xbox identity, reverse-proxy review or public deployment yet.
- Do not expose the UX3a server to the LAN or Internet. UX3b0 can be tested with the host and guest clients on one machine only.

## Next milestone: UX3b1 Electron wiring

Propose a *small, audited* Electron main-process IPC contract that passes only sanitized status and a user-shareable invite code; all role-specific bearer tokens and signaling envelope bodies stay within the trusted main process. Then wire the UX1b/UX2 Friend UI to an optional **experimental local signaling** mode with graceful fallback to manual UX2. Add explicit host approval, guest microphone consent, cancellation/revoke, and transport-state verification. Do not deploy until cross-network TLS, authorization, and abuse-risk requirements are accepted.
