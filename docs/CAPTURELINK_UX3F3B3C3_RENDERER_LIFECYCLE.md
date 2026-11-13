# CaptureLink UX3F-3B3C3 — Renderer Session Lifecycle (Offline Candidate)

**Status:** Linux and Windows Node 24 local acceptance passed (2026-11-13); staged security review and GitHub CI pending. No commit, PR, merge, public activation or deployment.

**Accepted parent:** `775bde1f3ebdf2ca45e2b954c7bc976fdc2159b5` (PR #26 squash).

**Expected worktree:** `feature/ux3f3b3c3-renderer-lifecycle`.

## Decision and scope

Reuse `installHostedSessionUx` and its existing Friends drawer and controller/voice coordinator. Do not duplicate the session UI or WebRTC transport. Keep `legacy` (local/private pilot) the selected default. In an unpackaged Windows dev process, display an explicit *Offline HTTPS prototype (.test only)* signaling selector only if trusted `onlineSessionStatus()` indicates the **code path** is enabled. This is not a reachability, Auth0-authenticated or invitation-success signal. The actual online endpoint remains pinned to `signal.capturelink.test` and the real internet workflow cannot complete.

A pure renderer mode gate freezes the chosen backend at the start of create/join, denies mode changes while active, and never silently retries on a different backend. Main's existing cross-session arbiter remains authoritative. Both backends preserve the same host approval, one-use code, anonymous unverified name, mic consent and UX2 WebRTC negotiation orchestration. Stale completions are rejected by the existing renderer epoch.

End immediately revokes renderer-side ownership, resets the existing controller/voice/media coordinator *before* any remote await, and closes only the selected IPC backend. Broker revocation remains best effort; it is not proof remote media stops. Drawer close does not revoke a live invitation. Legacy P2P/manual fallback and Xbox Remote Play session remain independent.

## Files and tests

- New pure `renderer-signaling-mode-gate.mjs` with TypeScript declaration and 4 focused offline tests.
- Updated `hosted-session-ux.ts` to add the explicit developer selector and use per-session backend adapters; no new arbitrary endpoint or credentials.
- Reconciled existing source guards and historical regression tests for the one deliberate renderer activation.
- New SHA-pinned UX3F-3B3C3 source guard and Windows offline CI workflow.

## Acceptance gates

**Operator local evidence (2026-11-13):** Pinned package SHA-256 validated and guarded installer verified exactly 12 modified and 6 new paths. Linux Node 24 signaling suite: **195/195 passed, 0 skipped**; eight source guards and five legacy smoke checks passed. Windows Node 24.19.0: `npm ci`, TypeScript and Electron build passed; signaling suite **189 passed, 6 expected platform skips, 0 failed**; cancellation/teardown suite **10/10 passed**, and the source/UX guards passed. The existing dependency audit still reports **45 advisories (41 moderate, 4 high)**. This does not establish online media connectivity or production readiness.

- [x] Exact accepted parent/branch, clean worktree and original/payload SHA hashes
- [x] Linux Node 24 full signaling tests and old/new source guards
- [x] Windows Node 24 `npm ci`, TypeScript, Electron build, full signaling tests and historical smoke/cancellation tests
- [ ] Exact staged inventory, pinned Gitleaks, independent diff and GitHub CI against the latest PR head
- [ ] No real online service activation or merge before review

## Remaining release blockers

This stage does **not** prove actual two-device connections, controller frames, Xbox voice audibility, stable staging Auth0 config, secure production identity, remote revocation, TURN, install/signing, or clearance of the known npm advisories. Offline broker approval is **not** media establishment. All remain separate user-facing release gates.
