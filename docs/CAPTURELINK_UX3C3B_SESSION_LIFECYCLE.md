# CaptureLink UX3c-3b — Fail-closed friend-session lifecycle

Accepted source baseline: `d75116ceff434a28667ed61b633ee68c05e9401f` (main after PR #14). This patch is a **local desktop lifecycle safety candidate**. It does not activate HTTPS signaling, deploy the broker, or alter Xbox authentication/Remote Play.

## Evidence from source audit

- `hosted-session-ux.ts` polls broker snapshots on a 650 ms interval. A rejected session or any snapshot error enters `fail()`, but previously `end()` awaited `hostedEnd()` **before** resetting friend transports.
- `UnifiedSessionCoordinator.reset()` previously rejected a stop while an async controller/voice negotiation was busy. Async offer, join and answer operations could then finish after the local stop request.
- The Electron main-process bridge does best-effort broker cleanup and hides transport credentials; `HostedSignalingBridge.end()` can succeed even when network revocation fails, so IPC success alone is **not** remote revocation proof.
- The coordinator owns friend/controller and voice resources; the independent Xbox Remote Play session has separate lifecycle ownership in `main.ts`.

## Changes

1. `hosted-session-ux.ts` now invalidates its generation and calls `coordinator.reset()` **before** awaiting any IPC/network cleanup. Duplicate exit requests share the same cleanup; new host/join flows are blocked while it runs.
2. Any broker authorization loss, rejection, timeout or other signaling snapshot failure uses the existing fail-closed exit. A temporary network error causes local sharing to stop immediately; there is **no automatic grace window or reconnect** in this phase.
3. Async transport acquisition and response acceptance capture a generation; reset works during busy operations, closes in-flight resources, and repeats cleanup if a delayed promise settles after cancellation. Replacement negotiation is blocked until the canceled promise completes.
4. Late UI callbacks are ignored rather than resetting a newly established session. Reject/approve handling is generation-guarded.
5. If one transport stop throws, the other is still attempted. The UI reports shutdown as **unconfirmed** if local teardown fails. A successful `hostedEnd()` call is *not* presented as verified remote revocation.

## Tests and acceptance

- `node --test scripts/ux3c3b-session-cancellation.test.mjs` runs deterministic coordination and DOM-adapter tests for in-flight controller, voice and answer cancellation, stalled broker cleanup, late errors, and stale callback isolation.
- `node scripts/ux3c3b-session-lifecycle-source-smoke.mjs` asserts safety boundaries and ordering without executing live Xbox/WebRTC.
- Windows `npm ci`, `npm run typecheck`, `npm run build`, previous signaling/broker suites, UX/voice regression scripts and recording smoke tests remain required before PR.
- Manual Electron acceptance (host and guest, with actual active friend media/controller/voice, lose broker, revoke credential, end during negotiation, restore network, verify Xbox remains live) is not represented by these hermetic tests and must be completed before public pilot authorization.

## Known limitations / safety boundaries

- Detection is **poll-based**: a remote revocation is not pushed; until the next snapshot/error reaches the renderer, an existing P2P channel can remain active. The 650 ms poll cadence plus request latency/timeout is not a hard revocation deadline. Peer termination cannot be guaranteed for an offline, crashed or malicious client.
- An Electron process exit/crash cannot be forced to terminate a remote peer immediately; the remote peer's own liveness or WebRTC checks are a separate gate.
- Cleanup is synchronous at the coordinator boundary but underlying peer async work may still settle; the generation fence stops late settlement from reopening the session. This does not prove every third-party ICE/WebRTC callback is cancellable.
- Current Electron main-process selection is **still pinned to localhost**. The remote client candidate remains gated off; no real remote host/guest or deployment is enabled in this patch.
- Failure of a stop method triggers warning; close CaptureLink and inspect media/controller state. There is no verified remote termination acknowledgement in v1.
- Dependency advisories, TLS ingress, installation credential delivery/rotation, TURN and internet-scale availability remain separate prerequisites.

## Scope

Changes: `unified-session-core.ts`, `hosted-session-ux.ts`, Windows CI, two new test scripts, this handoff document. No changes to the signaling protocol, admission tokens, Xbox Remote Play code, proxy config, or production service.
